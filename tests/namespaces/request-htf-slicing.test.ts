// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * `request.security` (HTF) slow-path slicing — Phase 4.
 *
 * Phase 4 extends the slicing optimization to the HTF runtime:
 * `security_lower_tf` and `security` share the same transpile-time
 * slice walker (driven by `SLICING_TARGETS`) and the same runtime
 * lookup pattern (`context._ltfTruncatedBodies[sliceKey]` →
 * `pineTS.runPretranspiled(slice)`).
 *
 * These tests focus on the Phase 4-specific bits that wouldn't be
 * caught by the LTF tests:
 *
 *   - Slices are emitted for `request.security` (not just
 *     `request.security_lower_tf`).
 *   - The runtime slow path in `security.ts` engages the slice when
 *     present.
 *   - Phase 2 + 3 walkers also fire for HTF call sites.
 *
 * Output-equivalence (Phase 4 vs full-script slow path) is covered by
 * the `request-htf-pre-phase4.test.ts` suite.
 */

import { describe, it, expect } from 'vitest';
import { PineTS, Provider } from 'index';
import { transpile } from '../../src/transpiler/index';

const chartStart = new Date('2018-12-15').getTime();
const chartEnd = new Date('2019-02-15').getTime();
const ltfChartStart = new Date('2024-01-01').getTime();
const ltfChartEnd = new Date('2024-03-01').getTime();
const HTF = 'W';

const makePineTS = (tf: string = 'D') =>
    new PineTS(Provider.Mock, 'BTCUSDC', tf, null, chartStart, chartEnd);

describe('request.security (HTF) slicing — Phase 4', () => {
    // ─────────────────────────────────────────────────────────────────────
    // Codegen: slices ARE emitted for request.security calls
    // ─────────────────────────────────────────────────────────────────────
    it('emits a slice for a top-level `request.security` call (Phase 1 shape)', () => {
        const code = `
//@version=5
indicator("htf top")
htf = request.security(syminfo.tickerid, "${HTF}", ta.sma(close, 5))
plot(htf, "htf")
`;
        const fn = transpile(code) as any;
        expect(fn._ltfSlices).toBeDefined();
        const keys = Object.keys(fn._ltfSlices);
        expect(keys.length).toBeGreaterThan(0);
        for (const k of keys) expect(/^p\d+$/.test(k)).toBe(true);
        // The slice must mention request.security and DROP the post-call
        // plot.
        const sliceFn = Object.values(fn._ltfSlices)[0] as Function;
        const src = sliceFn.toString();
        expect(src).toMatch(/request\.security/);
        expect(src).not.toMatch(/'htf'/);
    });

    it('emits a slice for a `request.security` call inside an if-block (Phase 2 shape)', () => {
        const code = `
//@version=5
indicator("htf if")
var float captured = na
if bar_index % 2 == 0
    captured := request.security(syminfo.tickerid, "${HTF}", ta.sma(close, 3))
plot(captured, "captured")
`;
        const fn = transpile(code) as any;
        const sliceFn = Object.values(fn._ltfSlices ?? {})[0] as Function;
        expect(sliceFn).toBeDefined();
        const src = sliceFn.toString();
        expect(src).toMatch(/request\.security/);
        // The if-cond must survive the slice.
        expect(src).toMatch(/if\s*\(/);
        // The post-if `plot` must NOT survive.
        expect(src).not.toMatch(/'captured'/);
    });

    it('emits a slice for a `request.security` call inside a user fn (Phase 3 shape)', () => {
        const code = `
//@version=5
indicator("htf fn")
fetch(float src) =>
    request.security(syminfo.tickerid, "${HTF}", ta.sma(src, 4))
htf = fetch(close)
plot(htf, "htf")
`;
        const fn = transpile(code) as any;
        const sliceFn = Object.values(fn._ltfSlices ?? {})[0] as Function;
        expect(sliceFn).toBeDefined();
        const src = sliceFn.toString();
        expect(src).toMatch(/function\s+fetch/);
        expect(src).toMatch(/\$\.call\(fetch/);
        expect(src).toMatch(/request\.security/);
        // Post-call plot dropped.
        expect(src).not.toMatch(/'htf'/);
    });

    it('emits independent slices for an HTF + LTF call in the same script', () => {
        const code = `
//@version=5
indicator("mixed")
htf = request.security(syminfo.tickerid, "${HTF}", ta.sma(close, 3))
ltf = request.security_lower_tf(syminfo.tickerid, "60", ta.rsi(close, 7))
plot(htf, "htf")
plot(ltf.size(), "ltfSz")
`;
        const fn = transpile(code) as any;
        const slices = fn._ltfSlices ?? {};
        const keys = Object.keys(slices);
        expect(keys.length).toBe(2);
        // Each slice has a different key (different pN per call site).
        const [first, second] = keys.map((k) => (slices[k] as Function).toString());
        // first slice covers only request.security (not request.security_lower_tf yet).
        expect(first).toMatch(/request\.security\(/);
        expect(first).not.toMatch(/request\.security_lower_tf/);
        // second slice covers both calls (its prefix includes the first).
        expect(second).toMatch(/request\.security\(/);
        expect(second).toMatch(/request\.security_lower_tf/);
    });

    // ─────────────────────────────────────────────────────────────────────
    // Runtime: secondary uses the slice instead of the full script
    // ─────────────────────────────────────────────────────────────────────
    it('runtime: HTF secondary context uses the slice (not a full-script run)', async () => {
        const pineTS = makePineTS();
        const code = `
//@version=5
indicator("htf runtime")
htf = request.security(syminfo.tickerid, "${HTF}", ta.sma(close, 3))
plot(htf, "htf")
`;
        const ctx: any = await pineTS.run(code);
        // Slice present.
        expect(ctx._ltfTruncatedBodies).toBeDefined();
        expect(Object.keys(ctx._ltfTruncatedBodies).length).toBeGreaterThan(0);
        // The HTF cache entry's secondary uses the slice as its
        // transpiled function — `runPretranspiled` reuses the slice
        // function for `_transpiledCode`.
        const cacheKey = Object.keys(ctx.cache).find((k) => k.includes('BTCUSDC') && !k.includes('_lower'))!;
        const cached = ctx.cache[cacheKey];
        expect(cached.pineTS).not.toBeNull();
        const secTranspiled = (cached.pineTS as any).transpiledCode;
        const sliceFn = Object.values(ctx._ltfTruncatedBodies)[0];
        expect(secTranspiled).toBe(sliceFn);
    });

    it('runtime: HTF fn-nested call uses the slice (Phase 3 + Phase 4 composition)', async () => {
        const pineTS = makePineTS();
        const code = `
//@version=5
indicator("htf fn runtime")
fetch(float src) =>
    request.security(syminfo.tickerid, "${HTF}", ta.sma(src, 4))
htf = fetch(close)
plot(htf, "htf")
`;
        const ctx: any = await pineTS.run(code);
        expect(ctx._ltfTruncatedBodies).toBeDefined();
        const sliceFn = Object.values(ctx._ltfTruncatedBodies)[0];
        const cacheKey = Object.keys(ctx.cache).find((k) => k.includes('BTCUSDC') && !k.includes('_lower'))!;
        const cached = ctx.cache[cacheKey];
        // Path-prefix stripping: at runtime _expression_name is
        // `${$$.id}p3`, but the slice is keyed by `p3`. The hook strips
        // the prefix → the lookup hits → the slice fires.
        const secTranspiled = (cached.pineTS as any).transpiledCode;
        expect(secTranspiled).toBe(sliceFn);
    });

    // ─────────────────────────────────────────────────────────────────────
    // Phase 3: post-call consumers of a truncated fn's return value
    // (corpus 1746 — TypeError `Cannot read properties of undefined
    // (reading '0')` in the p157 slice's tuple destructuring).
    // ─────────────────────────────────────────────────────────────────────
    it('Phase 3: multi-security fn with a top-level tuple destructure — each slice keeps ONLY the invocation, dropping the post-call consumers', () => {
        const code = `
//@version=5
indicator("tuple destructured fn")
setDMI() =>
    float diplus = 0.0
    float diminus = 0.0
    [d1, m1] = request.security(syminfo.tickerid, "D", ta.dmi(14, 14))
    [d2, m2] = request.security(syminfo.tickerid, "60", ta.dmi(14, 14))
    diplus := d1 + d2
    diminus := m1 + m2
    [diplus, diminus]
[a, b] = setDMI()
plot(a, "a")
plot(b, "b")
`;
        const fn = transpile(code) as any;
        const slices = fn._ltfSlices ?? {};
        // One slice per request call site inside setDMI.
        const keys = Object.keys(slices);
        expect(keys.length).toBe(2);

        for (const k of keys) {
            const src = (slices[k] as Function).toString();
            // The truncated fn definition AND the top-level invocation
            // must survive — the invocation is what executes the target
            // request and captures its params.
            expect(src).toMatch(/function\s+setDMI/);
            expect(src).toMatch(/\$\.call\(setDMI/);
            expect(src).toMatch(/request\.security/);
            // The top-level tuple destructuring `[a, b] = setDMI()` must
            // NOT keep its post-call consumers: `$.get($.let.glb1_a, 0)[0]`
            // reads the truncated fn's undefined return and throws.
            expect(src).not.toMatch(/glb1_a/);
            expect(src).not.toMatch(/glb1_b/);
        }
    });

    it('Phase 3 runtime: multi-security fn with a top-level tuple destructure produces finite output (no TypeError in the secondary)', async () => {
        // Chart "W", requests to "D" (both lower) — the same
        // LTF-via-request.security tuple shape as corpus 1746.
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, chartStart, chartEnd);
        const code = `
//@version=5
indicator("tuple destructured fn runtime")
setDMI() =>
    float diplus = 0.0
    float diminus = 0.0
    [d1, m1] = request.security(syminfo.tickerid, "D", ta.dmi(14, 14))
    [d2, m2] = request.security(syminfo.tickerid, "D", ta.dmi(14, 14))
    diplus := d1 + d2
    diminus := m1 + m2
    [diplus, diminus]
[a, b] = setDMI()
plot(a, "a")
plot(b, "b")
`;
        const ctx: any = await pineTS.run(code);
        // Slices present and engaged (one per request call site).
        expect(ctx._ltfTruncatedBodies).toBeDefined();
        expect(Object.keys(ctx._ltfTruncatedBodies).length).toBe(2);
        // The full-script run produced the plots with finite values —
        // the secondary slice executions must not throw.
        const aData = ctx.plots['a']?.data ?? [];
        expect(aData.length).toBeGreaterThan(0);
        const finite = aData.filter((d: any) => typeof d.value === 'number' && Number.isFinite(d.value));
        expect(finite.length).toBeGreaterThan(0);
    });

    it('Phase 3: reaching call nested in an if preserves the test and non-consuming else branch', () => {
        const code = `
//@version=5
indicator("if-nested reaching call")
reso(int p) =>
    request.security(syminfo.tickerid, "${HTF}", ta.sma(close, p))
var float alt = 0.0
if close > open
    alt := reso(3)
else
    alt := alt[1]
    plot(123, "elseOnly")
plot(alt, "alt")
`;
        const fn = transpile(code) as any;
        const sliceFn = Object.values(fn._ltfSlices ?? {})[0] as Function;
        expect(sliceFn).toBeDefined();
        const src = sliceFn.toString();
        // The invocation and the actual comparison in the if-test survive.
        expect(src).toMatch(/function\s+reso/);
        expect(src).toMatch(/\$\.call\(reso/);
        expect(src).toMatch(/request\.security/);
        expect(src).toMatch(/\$\.pine\.math\.__gt\(\$\.get\(close, 0\), \$\.get\(open, 0\)\)/);
        // The else branch does not consume the truncated return, so it stays.
        expect(src).toMatch(/'elseOnly'/);
    });

    it('Phase 3 runtime: else mutation feeding request stays value-parity with the full script', async () => {
        const code = `
//@version=5
indicator("else mutation parity")
var float seed = 1.0
reso(int p) =>
    request.security(syminfo.tickerid, "60", ta.sma(close, p) * seed)
var float alt = 0.0
if bar_index % 2 == 0
    alt := reso(3)
else
    seed := seed + 1
plot(alt, "alt")
plot(seed, "seed")
`;
        const previous = process.env.PINETS_DISABLE_LTF_SLICING;
        const restore = () => {
            if (previous === undefined) delete process.env.PINETS_DISABLE_LTF_SLICING;
            else process.env.PINETS_DISABLE_LTF_SLICING = previous;
        };

        let reference: any;
        let sliced: any;
        try {
            process.env.PINETS_DISABLE_LTF_SLICING = '1';
            reference = await new PineTS(
                Provider.Mock,
                'BTCUSDC',
                '4h',
                null,
                ltfChartStart,
                ltfChartEnd,
            ).run(code);

            restore();
            sliced = await new PineTS(
                Provider.Mock,
                'BTCUSDC',
                '4h',
                null,
                ltfChartStart,
                ltfChartEnd,
            ).run(code);
        } finally {
            restore();
        }

        expect(Object.keys(sliced._ltfTruncatedBodies ?? {})).not.toHaveLength(0);
        for (const plotName of ['alt', 'seed']) {
            const expected = reference.plots[plotName]?.data ?? [];
            const actual = sliced.plots[plotName]?.data ?? [];
            expect(actual).toHaveLength(expected.length);
            for (let i = 0; i < expected.length; i++) {
                expect(actual[i].time).toBe(expected[i].time);
                expect(actual[i].value).toEqual(expected[i].value);
            }
        }
    });

    it('Phase 3: nested fn destructuring the truncated fn return — dead temp reads removed inside kept function bodies', () => {
        // Probe C (F1): `outer` is kept because it (transitively) invokes
        // `inner`, whose request.security return is truncated in the slice.
        // The tuple destructure inside `outer` used to survive the consumer
        // removal (the recursion switch had no function cases), leaving
        // `$.get($$.let.fn2_temp_2, 0)[0]` — `undefined[0]` → TypeError in
        // the secondary slice run.
        const code = `
//@version=5
indicator("nested fn destructure")
inner() =>
    [d1, m1] = request.security(syminfo.tickerid, "D", ta.dmi(14, 14))
    [d1, m1]
outer() =>
    [o1, o2] = inner()
    o1 + o2
[a, b] = inner()
plot(a, "a")
plot(outer(), "o")
`;
        const fn = transpile(code) as any;
        const sliceFn = Object.values(fn._ltfSlices ?? {})[0] as Function;
        expect(sliceFn).toBeDefined();
        const src = sliceFn.toString();
        // outer survives (its invocation captures inner's request params)…
        expect(src).toMatch(/function\s+outer/);
        // …but its dead temp reads of inner's truncated return are gone.
        expect(src).not.toMatch(/\$\.get\(\$\$\.let\.fn2_temp_2, 0\)/);
    });

    it('Phase 3 runtime: nested fn destructuring the truncated fn return produces finite output equal to the full script', async () => {
        // Chart "W", requests to "D" — the reviewer probe C shape on the
        // LTF-via-request.security path. The slice must no longer throw
        // `Cannot read properties of undefined (reading '0')` inside the
        // kept `outer` function, and its plots must equal the full script.
        const code = `
//@version=5
indicator("nested fn destructure runtime")
inner() =>
    [d1, m1] = request.security(syminfo.tickerid, "D", ta.dmi(14, 14))
    [d1, m1]
outer() =>
    [o1, o2] = inner()
    o1 + o2
[a, b] = inner()
plot(a, "a")
plot(outer(), "o")
`;
        const previous = process.env.PINETS_DISABLE_LTF_SLICING;
        const restore = () => {
            if (previous === undefined) delete process.env.PINETS_DISABLE_LTF_SLICING;
            else process.env.PINETS_DISABLE_LTF_SLICING = previous;
        };

        let reference: any;
        let sliced: any;
        try {
            process.env.PINETS_DISABLE_LTF_SLICING = '1';
            reference = await new PineTS(
                Provider.Mock,
                'BTCUSDC',
                'W',
                null,
                ltfChartStart,
                ltfChartEnd,
            ).run(code);

            restore();
            sliced = await new PineTS(
                Provider.Mock,
                'BTCUSDC',
                'W',
                null,
                ltfChartStart,
                ltfChartEnd,
            ).run(code);
        } finally {
            restore();
        }

        expect(Object.keys(sliced._ltfTruncatedBodies ?? {})).not.toHaveLength(0);
        for (const plotName of ['a', 'o']) {
            const expected = reference.plots[plotName]?.data ?? [];
            const actual = sliced.plots[plotName]?.data ?? [];
            expect(actual).toHaveLength(expected.length);
            for (let i = 0; i < expected.length; i++) {
                expect(actual[i].time).toBe(expected[i].time);
                expect(actual[i].value).toEqual(expected[i].value);
            }
        }
    });
});
