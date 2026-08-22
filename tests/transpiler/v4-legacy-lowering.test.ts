// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// V4 legacy builtin lowering — targeted tests for the version-4 pipeline.
// Convention: same as the other pineToJS transpiler tests (codegen-level
// assertions on pineToJS output), plus one end-to-end engine run for the
// runtime `iff` helper (both-branches-evaluated semantics).

import { describe, it, expect } from 'vitest';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';
import { transpile } from '../../src/transpiler';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';

const v4 = (body: string) => `//@version=4\n${body}`;

function codeOf(body: string): string {
    const result = pineToJS(v4(body));
    if (!result.success) throw new Error(result.error);
    return result.code;
}

describe('V4 legacy builtin lowering (call position → v5 namespaces)', () => {
    it('maps ta.* indicators', () => {
        const code = codeOf('a = rsi(close, 14)\nb = sma(close, 10)\nc = ema(close, 20)\nd = atr(14)\nplot(a)');
        expect(code).toContain('ta.rsi(close, 14)');
        expect(code).toContain('ta.sma(close, 10)');
        expect(code).toContain('ta.ema(close, 20)');
        expect(code).toContain('ta.atr(14)');
        expect(code).not.toMatch(/(?<!\.)\brsi\(/);
    });

    it('maps math.* helpers', () => {
        const code = codeOf('a = abs(close)\nb = max(high, low)\nc = log(close)\nd = round(close, 2)\nplot(a)');
        expect(code).toContain('math.abs(close)');
        expect(code).toContain('math.max(high, low)');
        expect(code).toContain('math.log(close)');
        expect(code).toContain('math.round(close, 2)');
    });

    it('maps str.* formatting', () => {
        const code = codeOf('a = tostring(close, "#.##")\nb = tonumber("1.5")\nplot(close)');
        expect(code).toContain('str.tostring(close, \'#.##\')');
        expect(code).toContain('str.tonumber(\'1.5\')');
    });

    it('maps request.* security', () => {
        const code = codeOf('a = security(syminfo.tickerid, "D", close)\nplot(a)');
        expect(code).toContain('request.security(syminfo.tickerid, \'D\', close)');
        expect(code).not.toMatch(/(?<!\.)\bsecurity\(/);
    });
    it('maps v4 security resolution= to the v5 timeframe= slot', () => {
        const code = codeOf('a = security(symbol=syminfo.tickerid, resolution="D", expression=close)\nplot(a)');
        expect(code).toContain('timeframe: \'D\'');
        expect(code).not.toContain('resolution:');
    });

    it('keeps a user ln variable while lowering the v4 ln() builtin', () => {
        const code = codeOf('ln = input(1)\nx = ln(close)\nplot(x)');
        expect(code).toContain('math.log(close)');
        expect(code).not.toContain('ln(close)');
    });

    it('lowers v4 offset() despite a same-name user variable', () => {
        const code = codeOf(`
offset = input(0)
off(s, o) =>
    shifted = offset(s, o)
    shifted
x = off(close, 1)
plot(x)
`);
        expect(code).toContain('s[o]');
        expect(code).not.toContain('offset(s, o)');
    });

    it('keeps a USER FUNCTION named offset untouched (no builtin lowering)', () => {
        const code = codeOf(`
offset(s, o) => s + o
x = offset(close, 1)
plot(x)`);
        expect(code).toContain('function offset(s, o)');
        expect(code).toContain('offset(close, 1)');
        expect(code).not.toContain('close[1]');
    });

    it('v5 sources keep security resolution= untouched (v4-only lowering)', () => {
        const result = pineToJS('//@version=5\nx = request.security(syminfo.tickerid, resolution="D", close)\nplot(x)');
        expect(result.success).toBe(true);
        expect(result.code).toContain("resolution: 'D'");
        expect(result.code).not.toContain('timeframe:');
    });

    it('maps the v4 heikinashi ticker modifier to ticker.heikinashi', () => {
        const code = codeOf('a = heikinashi(syminfo.tickerid)\nplot(close)');
        expect(code).toContain('ticker.heikinashi(syminfo.tickerid)');
        expect(code).not.toMatch(/(?<!\.)\bheikinashi\(/);
    });

    it('keeps v4 single-argument forms (highest/change) — engine handles the callId swap', () => {
        const code = codeOf('a = highest(20)\nb = lowest(5)\nc = change(close)\nplot(a)');
        expect(code).toContain('ta.highest(20)');
        expect(code).toContain('ta.lowest(5)');
        expect(code).toContain('ta.change(close)');
    });

    it('does not rewrite namespaced callees (ta.rsi stays ta.rsi)', () => {
        const code = codeOf('a = ta.rsi(close, 14)\nplot(a)');
        expect(code).toContain('ta.rsi(close, 14)');
        expect(code).not.toContain('ta.ta.rsi');
    });

    it('collision x = x(...) : variable binding kept, callee namespaced', () => {
        const code = codeOf('rsi = rsi(close, 14)\nplot(rsi)');
        expect(code).toContain('rsi = ta.rsi(close, 14)');
        expect(code).not.toContain('rsi = rsi(close, 14)');
    });

    it('user function shadowing : calls to a user-declared function are NOT rewritten', () => {
        const code = codeOf('sma(a, b) => a + b\nx = sma(1, 2)\ny = sma(close, 10)\nplot(x)');
        // The user function declaration stays a bare function…
        expect(code).toContain('function sma');
        // …and its call sites are NOT namespaced (user function wins).
        expect(code).toContain('sma(1, 2)');
        expect(code).not.toContain('ta.sma');
    });

    it('iff stays a bare call (both branches evaluated) and resolves via $.pine', () => {
        const code = codeOf('x = iff(close > open, 1.0, 2.0)\nplot(x)');
        // No ternary rewrite — the call shape is preserved.
        expect(code).not.toContain('?');
        const fn = transpile(v4('x = iff(close > open, 1.0, 2.0)\nplot(x)'));
        const emitted = fn.toString();
        // The runtime helper is destructured from the pine context and the
        // call receives already-evaluated arguments.
        expect(emitted).toMatch(/const \{[^}]*\biff\b[^}]*\} = \$\.pine/);
        expect(emitted).toMatch(/iff\(p\d+, p\d+, p\d+\)/);
    });

    it('keeps the v4 RSI overload: simple integer uses ta.rsi, series length uses the legacy ratio', async () => {
        const source = v4(`
simple = rsi(close, 3)
integerLiteral = rsi(close, 14)
floatLiteral = rsi(close, 14.0)
floatInputLength = input(14.0)
floatInput = rsi(close, floatInputLength)
legacy = rsi(abs(close - open), high - low)
formula = 100 - 100 / (1 + abs(close - open) / (high - low))
plot(simple, "simple")
plot(integerLiteral, "integerLiteral")
plot(floatLiteral, "floatLiteral")
plot(floatInput, "floatInput")
plot(legacy, "legacy")
plot(formula, "formula")
`);
        const engine = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2019-01-01').getTime(), new Date('2019-02-01').getTime());
        const context = await engine.run(source);
        const values = (name: string) => context.plots[name].data.map((point: { value: unknown }) => point.value);
        expect(values('simple').some((value: unknown) => typeof value === 'number' && Number.isFinite(value))).toBe(true);
        expect(values('integerLiteral').every((value: unknown) => typeof value === 'number' && isNaN(value))).toBe(true);
        const expectedFloat = [99.6026351, 99.6056105, 99.6051177, 99.5915343];
        for (const name of ['floatLiteral', 'floatInput']) {
            values(name).forEach((value: unknown, index: number) => {
                expect(value).toBeCloseTo(expectedFloat[index], 7);
            });
        }
        const legacyValues = values('legacy');
        const formulaValues = values('formula');
        expect(legacyValues.length).toBe(formulaValues.length);
        legacyValues.forEach((value: unknown, index: number) => {
            const expected = formulaValues[index];
            if (typeof value === 'number' && typeof expected === 'number') {
                expect(value).toBeCloseTo(expected, 9);
            } else {
                expect(value).toEqual(expected);
            }
        });
    });

    it('statically resolves RSI lengths from literals and input defaults, rejecting indeterminate series', () => {
        const inputLength = pineToJS(v4('length = input(14)\nx = rsi(close, length)\nplot(x)'));
        const literalLength = pineToJS(v4('length = 14\nx = rsi(close, length)\nplot(x)'));
        expect(inputLength.success).toBe(true);
        expect(inputLength.code).toContain('ta.rsi(close, length)');
        expect(literalLength.success).toBe(true);
        expect(literalLength.code).toContain('ta.rsi(close, length)');

        const indeterminate = pineToJS(v4('length = unknownLength\nx = rsi(close, length)\nplot(x)'));
        expect(indeterminate.success).toBe(false);
        expect(indeterminate.error).toContain('v4 rsi(series, series) overload: cannot statically resolve second argument');
    });

    it('v5 sources are NOT rewritten (variable named rsi untouched)', () => {
        const result = pineToJS('//@version=5\nrsi = close * 2\nplot(rsi)');
        expect(result.success).toBe(true);
        const code = result.code;
        expect(code).toContain('rsi = close * 2');
        expect(code).not.toContain('ta.rsi');
    });

    it('version 4 is accepted (no Unsupported version error)', () => {
        const result = pineToJS(v4('a = sma(close, 10)\nplot(a)'));
        expect(result.success).toBe(true);
        expect(result.version).toBe(4);
    });
});

describe('V4 runtime iff helper (end-to-end)', () => {
    const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2019-01-01').getTime(), new Date('2019-02-01').getTime());
    it('iff uses the same na conditional semantics as the ternary', async () => {
        const source = `//@version=4
y = iff(na, 1.0, 2.0)
z = na ? 1.0 : 2.0
plot(y, "y")
plot(z, "z")
`;
        const context = await pineTS.run(source);
        const values = (name: string) => context.plots[name].data.map((point: { value: unknown }) => point.value);
        expect(values('y')).toEqual(values('z'));
    });

    it('does not inject iff into v5; the historical runtime error remains', async () => {
        const engine = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2019-01-01').getTime(), new Date('2019-02-01').getTime());
        await expect(engine.run('//@version=5\nx = iff(true, 1, 2)\nplot(x)')).rejects.toThrow(/iff/);
    });

    it('matches v5 runtime calls for v4 value builtins tr, obv, and vwap', async () => {
        const v4Source = v4(`
trValue = tr
obvValue = obv
vwapValue = vwap
plot(trValue, "tr")
plot(obvValue, "obv")
plot(vwapValue, "vwap")
`);
        const v5Source = `//@version=5
trValue = ta.tr()
obvValue = ta.obv()
vwapValue = ta.vwap(hlc3)
plot(trValue, "tr")
plot(obvValue, "obv")
plot(vwapValue, "vwap")
`;
        const run = async (source: string) => {
            const engine = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2019-01-01').getTime(), new Date('2019-02-01').getTime());
            return engine.run(source);
        };
        const [v4Context, v5Context] = await Promise.all([run(v4Source), run(v5Source)]);
        for (const name of ['tr', 'obv', 'vwap']) {
            expect(v4Context.plots[name].data).toEqual(v5Context.plots[name].data);
        }
    });
});
