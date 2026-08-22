// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// VIN-90: arithmetic on context-bound data vars (close, open, …) inside
// IIFE-branch returns of nested if-expressions emitted the RAW Series object
// (`close * (1 - p)` → NaN), because the main transformation walk left
// context-bound identifiers bare in non-argument positions while
// transformAssignmentExpression wrapped `:=` RHS operands. The whole
// short-side trail chain of strategy 2386 (Joker Trailing TP Bot) collapsed
// to `na`. Regression: the branch-1 value must be the scalar
// `$.get(close, 0) * (1 - p)` — real and equal to close * 0.995 on every
// branch-1 bar (pre-fix it was NaN).

import { describe, it, expect } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '@pinets/marketData/Provider.class';

const CODE = `
//@version=5
indicator("VIN90 nested-if close arithmetic")
float tp = na
bool active = close > open
bool sig = close > open and close > close[1]
bool inner = sig and not (close < close[1])
tp := if active
    if sig and not (close < close[1])
        close * (1 - 0.005)
    else
        nz(tp[1], close * (1 - 0.005))
else
    na
plot(tp, title='tp')
plot(close, title='close')
plot(active, title='active')
plot(inner, title='inner')
`;

describe('VIN-90 — context-bound data vars in IIFE-branch arithmetic', () => {
    it('nested if-expression branch returns must unwrap close to a scalar (not a raw Series → NaN)', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', '1h', null, new Date('2024-01-01').getTime(), new Date('2024-01-10').getTime());
        const { plots } = await pineTS.run(CODE);
        const g = (title: string) => plots[title].data.map((d: any) => d.value);
        const tp = g('tp');
        const close = g('close');
        const active = g('active');
        const inner = g('inner');
        expect(tp.length).toBeGreaterThan(0);
        expect(close.length).toBe(tp.length);

        // Discriminating assertion (fails pre-fix): every branch-1 bar
        // (`inner === true`) must carry the scalar close * 0.995. Pre-fix,
        // the raw Series coerced to NaN in JS arithmetic.
        const branch1 = tp.map((_: any, i: number) => i).filter((i: number) => inner[i] === true);
        expect(branch1.length).toBeGreaterThan(0);
        for (const i of branch1) {
            expect(typeof tp[i]).toBe('number');
            expect(Number.isNaN(tp[i])).toBe(false);
            expect(tp[i]).toBeCloseTo((close[i] as number) * 0.995, 9);
        }

        // Every ACTIVE bar (branch-1 or carry/fallback) must be a finite
        // scalar — pre-fix the chain was NaN wherever the branch ran.
        const activeBars = tp.map((_: any, i: number) => i).filter((i: number) => active[i] === true);
        expect(activeBars.length).toBeGreaterThan(0);
        for (const i of activeBars) {
            expect(typeof tp[i]).toBe('number');
            expect(Number.isNaN(tp[i])).toBe(false);
            expect(tp[i]).toBeGreaterThan(0);
        }

        // INACTIVE bars: `na` (represented as NaN in this runtime) or null —
        // never a real number.
        const inactiveBars = tp.map((_: any, i: number) => i).filter((i: number) => active[i] === false);
        for (const i of inactiveBars) {
            expect(tp[i] === null || tp[i] === undefined || (typeof tp[i] === 'number' && Number.isNaN(tp[i]))).toBe(true);
        }
    });

    it('negatives: ta.sma(close, …) keeps the raw Series arg; loop vars and native globals in nested-IIFE returns stay bare (no $.get wrap)', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDT', '1h', null, new Date('2024-01-01').getTime(), new Date('2024-01-10').getTime());
        const code = `
//@version=5
indicator("VIN90 negatives")
float x = na
m = ta.sma(close, 3)
for i = 0 to 3
    x := if close > open
        if close > close[1]
            i + 1
        else
            Infinity + 1
    else
        na
plot(x)
plot(m)
`;
        const result = await pineTS.run(code);
        const js = pineTS.transpiledCode.toString();

        // 1. ta.sma(close, 3): `close` must reach ta.param as the RAW Series
        //    (function-argument position — never unwrapped).
        expect(js).toMatch(/ta\.param\(close,/);

        // 2. Loop variable `i` inside a nested-IIFE return: byte-invariant vs
        //    HEAD — `return i + 1`, NOT `return $.get(i, 0) + 1`.
        expect(js).toContain('return i + 1');
        expect(js).not.toMatch(/return \$\.get\(i, 0\) \+ 1/);

        // 3. Native global `Infinity` in arithmetic inside a nested-IIFE
        //    return: stays bare — `return Infinity + 1`, NOT
        //    `return $.get(Infinity, 0) + 1`.
        expect(js).toContain('return Infinity + 1');
        expect(js).not.toMatch(/return \$\.get\(Infinity, 0\) \+ 1/);
    });
});
