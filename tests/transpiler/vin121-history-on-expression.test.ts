// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * VIN-121 — Pine history-of-history: `(EXPR[N])[M]` where the INNER `EXPR[N]`
 * is itself a series access.
 *
 * Root cause (2475): the walker visits the OUTER `[M]` while the inner is
 * still a MemberExpression, so none of transformMemberExpression's branches
 * fire — the outer subscript is later left as a raw JS index on the `$.get`
 * scalar (→ undefined/NaN in expressions) or folded into `$.init`'s ignored
 * `lookbehind` arg in declarations. Pine semantics: `[]` is ALWAYS the history
 * operator, so `(close[ta.barssince(cond)])[1]` reads the `close[N]` series
 * one bar ago. The fix materializes the inner expression as a per-bar series
 * with the same `$.param` machinery as call-result history.
 *
 * The "history-of-expression" blocks were RED on the parent fork state
 * (whole-init returned the CURRENT expression value instead of the previous
 * bar's; in-expression forms produced NaN) and GREEN after the fix.
 * The "alias" blocks (VIN-94 family, fork 9730ceb) are regression guards that
 * must stay green: `c = close; m = c[2]` and `m = c[n]` with a computed `n`.
 */

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

// deterministic bars with a cond that TOGGLES so `barssince(cond)` varies
// and the expression `close[barssince(cond)]` is NOT constant
function makeBars(n: number) {
    const DAY = 86_400_000;
    const t0 = Date.UTC(2020, 0, 1);
    const bars = [];
    for (let i = 0; i < n; i++) {
        const base = 100 + 10 * Math.sin(i / 2) + i * 0.7;
        const close = base + Math.cos(i / 3) * 3;
        const open = base;
        bars.push({
            openTime: t0 + i * DAY,
            open,
            high: Math.max(open, close) + 2 + (i % 3),
            low: Math.min(open, close) - 2 - (i % 2),
            close,
            volume: 1000 + i,
        });
    }
    return bars;
}

function dedent(s: string): string {
    const lines = s.replace(/^\n/, '').replace(/\n\s*$/, '').split('\n');
    const widths = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length);
    const indent = Math.min(...widths);
    return lines.map((l) => l.slice(indent)).join('\n');
}

async function runPine(src: string) {
    const pine = new PineTS(makeBars(40), 'TEST', 'D');
    return pine.run(dedent(src));
}

function series(ctx: any, title: string): number[] {
    return (ctx.plots[title]?.data ?? []).map((d: any) => (d == null ? NaN : d.value));
}

// `actual` must match `expected` element-wise wherever expected is finite
function expectSeriesClose(actual: number[], expected: number[], fromIdx = 3) {
    let compared = 0;
    for (let i = fromIdx; i < expected.length; i++) {
        const e = expected[i];
        if (e == null || Number.isNaN(e)) continue;
        expect(actual[i]).toBeCloseTo(e, 6);
        compared++;
    }
    expect(compared).toBeGreaterThan(5);
}

// `(close[barssince(cond)])[M]` must equal the materialized-reference series
// `ref = close[barssince(cond)]; ref[M]`.
function withRef(calc: string, lookback = 1) {
    return `
        //@version=6
        indicator("t")
        cond = bar_index % 3 == 0
        ref = close[ta.barssince(cond)]
        refPrev = ref[${lookback}]
        ${calc}
        plot(refPrev, "refPrev")
        plot(u, "u")
    `;
}

describe('VIN-121: history of a series EXPRESSION (BUG — red on parent, green after fix)', () => {
    it('whole-init: u = (close[ta.barssince(cond)])[1]', async () => {
        const ctx = await runPine(withRef(`u = (close[ta.barssince(cond)])[1]`));
        expectSeriesClose(series(ctx, 'u'), series(ctx, 'refPrev'));
    });

    it('in-expression: u = (close[ta.barssince(cond)])[1] + 0.0', async () => {
        const ctx = await runPine(withRef(`u = (close[ta.barssince(cond)])[1] + 0.0`));
        expectSeriesClose(series(ctx, 'u'), series(ctx, 'refPrev'));
    });

    it('lookback M=2: u = (close[ta.barssince(cond)])[2]', async () => {
        const ctx = await runPine(withRef(`u = (close[ta.barssince(cond)])[2]`, 2));
        expectSeriesClose(series(ctx, 'u'), series(ctx, 'refPrev'), 4);
    });

    it('constant offset inner: u = (close[2])[1] equals close[3]', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            u = (close[2])[1]
            ref = close[3]
            plot(ref, "ref")
            plot(u, "u")
        `);
        expectSeriesClose(series(ctx, 'u'), series(ctx, 'ref'));
    });

    it('function local: f() => (close[ta.barssince(cond)])[1] inside a function', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            cond = bar_index % 3 == 0
            ref = close[ta.barssince(cond)]
            refPrev = ref[1]
            f() =>
                u = (close[ta.barssince(cond)])[1]
                u
            u = f()
            plot(refPrev, "refPrev")
            plot(u, "u")
        `);
        expectSeriesClose(series(ctx, 'u'), series(ctx, 'refPrev'));
    });

    it('function direct return: g() => (close[ta.barssince(cond)])[1]', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            cond = bar_index % 3 == 0
            ref = close[ta.barssince(cond)]
            refPrev = ref[1]
            g() =>
                (close[ta.barssince(cond)])[1]
            u = g()
            plot(refPrev, "refPrev")
            plot(u, "u")
        `);
        expectSeriesClose(series(ctx, 'u'), series(ctx, 'refPrev'));
    });

    it('inside if-block firing on consecutive bars: u := (close[ta.barssince(cond)])[1]', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            cond = bar_index % 3 == 0
            ref = close[ta.barssince(cond)]
            refPrev = ref[1]
            u = 0.0
            if bar_index > 5
                u := (close[ta.barssince(cond)])[1]
            plot(refPrev, "refPrev")
            plot(u, "u")
        `);
        // The $.param materialization buffer is written per call-site execution;
        // with the if firing on every bar after 5 the per-bar semantics are exact.
        expectSeriesClose(series(ctx, 'u'), series(ctx, 'refPrev'), 8);
    });

    it('alias of a computed expression: c = close[ta.barssince(cond)]; u = c[1]', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            cond = bar_index % 3 == 0
            c = close[ta.barssince(cond)]
            refPrev = c[1]
            u = c[1]
            plot(refPrev, "refPrev")
            plot(u, "u")
        `);
        expectSeriesClose(series(ctx, 'u'), series(ctx, 'refPrev'));
    });
});

describe('VIN-121 regression guards (must STAY green on parent and after fix)', () => {
    it('alias const offset: c = close; m = c[2] equals close[2]', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            c = close
            m = c[2]
            ref = close[2]
            plot(m, "m")
            plot(ref, "ref")
        `);
        expectSeriesClose(series(ctx, 'm'), series(ctx, 'ref'));
    });

    it('alias computed offset: c = close; n = ta.barssince(cond); m = c[n] equals close[n]', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            cond = bar_index % 3 == 0
            c = close
            n = ta.barssince(cond)
            m = c[n]
            ref = close[n]
            plot(m, "m")
            plot(ref, "ref")
        `);
        expectSeriesClose(series(ctx, 'm'), series(ctx, 'ref'));
    });

    it('fn-local alias: f() => c = close; c[2]', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            ref = close[2]
            f() =>
                c = close
                c[2]
            u = f()
            plot(ref, "ref")
            plot(u, "u")
        `);
        expectSeriesClose(series(ctx, 'u'), series(ctx, 'ref'));
    });

    it('v4 fn-local alias with input offset (2617 pv() pattern): c = close; m = c[ln]', async () => {
        const ctx = await runPine(`
            //@version=4
            strategy("t", overlay=true)
            ln = input(1, title="Pivot Length", type=input.integer)
            pv() =>
                c = close
                m = c[ln]
                m
            p = pv()
            ref = close[1]
            plot(p, "p")
            plot(ref, "ref")
        `);
        expectSeriesClose(series(ctx, 'p'), series(ctx, 'ref'));
    });

    it('call-result history untouched: u = ta.sma(close, 3)[1]', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            ref = ta.sma(close, 3)
            refPrev = ref[1]
            u = ta.sma(close, 3)[1]
            plot(refPrev, "refPrev")
            plot(u, "u")
        `);
        expectSeriesClose(series(ctx, 'u'), series(ctx, 'refPrev'));
    });
});
