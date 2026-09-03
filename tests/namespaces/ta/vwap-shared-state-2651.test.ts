import { describe, expect, it } from 'vitest';
import { PineTS, Provider } from 'index';

/**
 * VIN-2651 — ta.vwap shares ONE session accumulator per source (TV semantics).
 *
 * Root cause: vwap state was keyed by the per-callsite `_callId` the
 * transpiler injects. In `long = close > ta.vwap and close[1] < ta.vwap`
 * (corpus 2651, BYBIT:USTCUSDT 120) the transpiled `&&` short-circuits the
 * second call site, so its accumulator only aggregates the bars where the
 * first site fired and resets its session on its first EVALUATED bar of a
 * new day — a partial-session VWAP that differs from the first site and
 * produces phantom signals (structurel 216/220 on the engine vs 222/222 TV).
 *
 * TV semantics: ta.vwap(source) is ONE series per (source, symbol); two call
 * sites with the same source receive the same series values. The fix keys the
 * accumulator by the identity of the source data buffer (+ history offset:
 * close vs close[1] are distinct sources in TV) instead of the callId.
 *
 * VIN-2651 F1 (revue L1) — the buffer-identity key must ONLY apply to sources
 * that really carry a shared buffer. A scalar source in conditional position
 * (e.g. `plot(hidePDHCL ? na : ta.vwap(close))`, corpus 1584) compiles to
 * `ta.vwap($.get(param, 0))`: a NUMBER per bar, wrapped in a FRESH array at
 * every call. Under the plain buffer key (pre-F1) the accumulator is
 * recreated on every bar — VWAP degrades to the current close (corpus 1584:
 * 52/1107 structurel vs 1107/1107 parent) and the state Map grows by one
 * entry per bar. F1: only Series/Array/__value-of-Series sources take the
 * buffer branch; scalars fall back to the per-callsite `_callId` key (one
 * session accumulator per site). The na-guarded anchored form (corpus 2770,
 * `vwap = na(anchorPrice) ? na : ta.vwap(anchorPrice)`) keeps its Series
 * source on the buffer branch (shared accumulator, bounded Map).
 */
describe('VIN-2651: ta.vwap shared state per source', () => {
    // Mock data file BTCUSDC-1h-1704067200000-1763683199000.json
    const SYMBOL = 'BTCUSDC';
    const TF = '1h';
    const START = new Date('2025-08-01').getTime();
    const END = new Date('2025-11-01').getTime();

    async function run(code: string) {
        const pineTS = new PineTS(Provider.Mock, SYMBOL, TF, null, START, END);
        const context = await pineTS.run(code);
        return { pineTS, context };
    }

    function plotValues(plots: any, name: string): number[] {
        const data = plots[name]?.data;
        expect(data, `plot '${name}' should exist`).toBeDefined();
        return data.map((d: any) => d.value);
    }

    it('(2651 scenario) short-circuited second call site returns the first site series', async () => {
        const { context } = await run(`
//@version=5
indicator("vwap 2651")
long = close > ta.vwap and close[1] < ta.vwap
plot(ta.vwap, "v1")
plot(close > ta.vwap ? ta.vwap : na, "v2")
plot(long ? 1 : 0, "sig")
plot(close, "cl")
`);
        const v1 = plotValues(context.plots, 'v1');
        const v2 = plotValues(context.plots, 'v2');
        const sig = plotValues(context.plots, 'sig');
        const cl = plotValues(context.plots, 'cl');

        // The second site must genuinely be short-circuited on a subset of bars
        // (otherwise the scenario is not exercising the `and` semantics), and
        // it must fire at least once to be observable.
        let secondFired = 0;
        let mismatches = 0;
        const firstMismatches: number[] = [];
        for (let i = 0; i < v1.length; i++) {
            if (Number.isNaN(v2[i])) continue;
            secondFired++;
            if (v1[i] !== v2[i]) {
                mismatches++;
                if (firstMismatches.length < 5) firstMismatches.push(i);
            }
        }
        expect(secondFired, 'short-circuited site should fire on some bars').toBeGreaterThan(0);
        expect(secondFired, 'short-circuited site must NOT fire on every bar').toBeLessThan(v1.length);
        expect(mismatches, 'bars where the short-circuited site diverges from the full site: ' + firstMismatches.join(',')).toBe(0);
    }, 60000);

    it('two call sites with the same explicit source produce identical series', async () => {
        const { context } = await run(`
//@version=5
indicator("vwap same source")
a = ta.vwap(close)
b = ta.vwap(close)
plot(a, "a")
plot(b, "b")
`);
        const a = plotValues(context.plots, 'a');
        const b = plotValues(context.plots, 'b');
        let mismatches = 0;
        const firstMismatches: number[] = [];
        for (let i = 0; i < a.length; i++) {
            if (Number.isNaN(a[i])) continue;
            if (a[i] !== b[i]) {
                mismatches++;
                if (firstMismatches.length < 5) firstMismatches.push(i);
            }
        }
        expect(mismatches, 'same-source sites diverged at bars: ' + firstMismatches.join(',')).toBe(0);
    }, 60000);

    it('two different sources (close vs hlc3) keep distinct series', async () => {
        const { context } = await run(`
//@version=5
indicator("vwap distinct sources")
a = ta.vwap(close)
c = ta.vwap(hlc3)
plot(a, "a")
plot(c, "c")
`);
        const a = plotValues(context.plots, 'a');
        const c = plotValues(context.plots, 'c');
        let maxRelDiff = 0;
        let finitePairs = 0;
        for (let i = 0; i < a.length; i++) {
            if (Number.isNaN(a[i]) || Number.isNaN(c[i])) continue;
            finitePairs++;
            maxRelDiff = Math.max(maxRelDiff, Math.abs(a[i] - c[i]) / Math.abs(a[i]));
        }
        expect(finitePairs, 'no comparable bars').toBeGreaterThan(0);
        expect(maxRelDiff, 'close and hlc3 vwap should diverge (distinct sources)').toBeGreaterThan(1e-6);
    }, 60000);

    it('(2651 F1) scalar source in a plot ternary keeps ONE session accumulator (corpus 1584 form)', async () => {
        const { pineTS, context } = await run(`
//@version=5
indicator("vwap 1584")
hidePDHCL = input.bool(false)
plot(hidePDHCL ? na : ta.vwap(close), "vw")
plot(close, "cl")
`);
        const vw = plotValues(context.plots, 'vw');
        const cl = plotValues(context.plots, 'cl');

        // The ternary compiles the vwap source to a per-bar scalar
        // ($.get(param, 0)). Pre-F1 the buffer-identity key sees a fresh
        // wrapper array at every call: the accumulator is recreated on each
        // bar, VWAP degrades to the current close, and the state Map grows by
        // one entry per bar. F1 routes the scalar to the _callId key, so the
        // site keeps a single session accumulator.
        let equalsClose = 0;
        let finite = 0;
        for (let i = 0; i < vw.length; i++) {
            if (Number.isNaN(vw[i])) continue;
            finite++;
            if (vw[i] === cl[i]) equalsClose++;
        }
        expect(finite, 'no bars').toBeGreaterThan(0);
        expect(
            equalsClose / finite,
            'degraded vwap equals the current close on (almost) every bar — the accumulator was recreated per bar'
        ).toBeLessThan(0.1);

        // Bounded Map: per-bar wrapper arrays must never accumulate under the
        // buffer key (2209 entries for one site pre-F1).
        const mapSize: number | undefined = (context.taState as any)?.__vwapByBuffer?.size;
        expect(mapSize ?? 0, 'state Map grew per bar for a scalar source').toBeLessThanOrEqual(4);

        // And the values must be the session VWAP (independent oracle).
        let cumPV = 0;
        let cumVol = 0;
        let lastDay: string | null = null;
        let worstRel = 0;
        let checked = 0;
        for (let i = 0; i < pineTS.close.length; i++) {
            const day = new Date(pineTS.openTime[i]).toISOString().slice(0, 10);
            if (day !== lastDay) {
                cumPV = 0;
                cumVol = 0;
                lastDay = day;
            }
            cumPV += pineTS.close[i] * pineTS.volume[i];
            cumVol += pineTS.volume[i];
            const expected = Math.round((cumPV / cumVol) * 1e10) / 1e10;
            const got = vw[i];
            if (Number.isNaN(got)) continue;
            const rel = Math.abs(got - expected) / Math.abs(expected);
            worstRel = Math.max(worstRel, rel);
            checked++;
        }
        expect(checked, 'no bars checked').toBeGreaterThan(0);
        expect(worstRel, 'ternary-scalar vwap diverged from the cumulative session formula').toBeLessThan(1e-9);
    }, 60000);

    it('(2651 F1) na-guarded anchored series source keeps the shared buffer accumulator (corpus 2770 form)', async () => {
        const { pineTS, context } = await run(`
//@version=6
indicator("vwap 2770")
anchorPrice = bar_index >= 3 ? close[3] : na
vwap = na(anchorPrice) ? na : ta.vwap(anchorPrice)
plot(vwap, "vw")
`);
        const vw = plotValues(context.plots, 'vw');

        // 2770-like: the source passing through ta.param is the anchored
        // SERIES itself (data buffer), so F1's hasSharedBuffer routes it to
        // the buffer key — ONE accumulator shared by every call of this call
        // site, never recreated. The na guard only selects the plotted value.
        // Oracle: per-UTC-day cumulative Σ(anchor×volume)/Σ(volume); the
        // anchor is na only during the 3-bar warmup (skipped like the plot).
        // NaN-source handling beyond the warmup is pre-existing engine
        // behavior, out of F1 scope.
        let cumPV = 0;
        let cumVol = 0;
        let lastDay: string | null = null;
        let worstRel = 0;
        let checked = 0;
        for (let i = 0; i < pineTS.close.length; i++) {
            const day = new Date(pineTS.openTime[i]).toISOString().slice(0, 10);
            if (day !== lastDay) {
                cumPV = 0;
                cumVol = 0;
                lastDay = day;
            }
            if (i >= 3) {
                cumPV += pineTS.close[i - 3] * pineTS.volume[i];
                cumVol += pineTS.volume[i];
            }
            const expected = cumVol > 0 ? Math.round((cumPV / cumVol) * 1e10) / 1e10 : NaN;
            const got = vw[i];
            if (Number.isNaN(got)) continue;
            const rel = Math.abs(got - expected) / Math.abs(expected);
            worstRel = Math.max(worstRel, rel);
            checked++;
        }
        expect(checked, 'no checked bars').toBeGreaterThan(100);
        expect(worstRel, 'anchored-series vwap diverged from the cumulative formula').toBeLessThan(1e-9);
    }, 60000);

    it('mono-site vwap remains correct against an independent session oracle', async () => {
        const { pineTS, context } = await run(`
//@version=5
indicator("vwap mono")
plot(ta.vwap(close), "v")
`);
        const v = plotValues(context.plots, 'v');
        // Independent oracle: per-UTC-day cumulative Σ(close×volume)/Σ(volume),
        // rounded to the engine's 10-decimal display precision.
        let cumPV = 0;
        let cumVol = 0;
        let lastDay: string | null = null;
        let worstRel = 0;
        let checked = 0;
        for (let i = 0; i < pineTS.close.length; i++) {
            const day = new Date(pineTS.openTime[i]).toISOString().slice(0, 10);
            if (day !== lastDay) {
                cumPV = 0;
                cumVol = 0;
                lastDay = day;
            }
            cumPV += pineTS.close[i] * pineTS.volume[i];
            cumVol += pineTS.volume[i];
            const expected = Math.round((cumPV / cumVol) * 1e10) / 1e10;
            const got = v[i];
            if (Number.isNaN(got)) continue;
            const rel = Math.abs(got - expected) / Math.abs(expected);
            worstRel = Math.max(worstRel, rel);
            checked++;
        }
        expect(checked, 'no bars checked').toBeGreaterThan(0);
        expect(worstRel, 'single-site vwap diverged from the cumulative formula').toBeLessThan(1e-9);
    }, 60000);
});