// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * FN_PARAM_HISTORY_SHORTCIRCUIT — revealing script 1622 (BINANCE:SANDUSDT D,
 * Pine v4, divergence fractals `f_top_fractal(src) => src[4] < src[2] and
 * src[3] < src[2] and src[2] > src[1] and src[2] > src[0]`).
 *
 * A function argument has one history per call. Each `src[k]` read inside a
 * user function went through its own per-site series, recorded only when
 * that site ran: behind a short-circuit `and`, a ternary branch or an `if`,
 * a skipped site kept a stale value and `src[k]` read the wrong bar. On 1622
 * the engine saw wt2 fractal tops on a strictly rising wt2 (2021-03-07,
 * 52.2 → 57.8 → 62.5 → 70.0) and closed five TradingView trades early
 * (structurel 413/423 → 418/418 after the fix).
 *
 * RED on the parent (no top found at bar 4), GREEN after.
 */

import { describe, it, expect } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

const DAY = 86_400_000;
const CLOSES = [1, 2, 5, 3, 2, 6, 7, 8, 9, 10, 11, 12];

async function run(script: string) {
    const candles = CLOSES.map((c, i) => ({
        openTime: i * DAY, closeTime: (i + 1) * DAY - 1, open: c, high: c + 1, low: c - 1, close: c, volume: 1,
    }));
    const { plots } = await new PineTS(candles, 'T', 'D', null, 0, (CLOSES.length - 1) * DAY).run(script);
    return (name: string) => plots[name].data.map((p: { value: unknown }) => Number(p.value));
}

describe('function argument history under short-circuit (FN_PARAM_HISTORY_SHORTCIRCUIT, 1622)', () => {
    it('reads src[k] of the argument even when an `and` operand was skipped on earlier bars', async () => {
        const plot = await run(`//@version=5
indicator("t")
f_top(src) => src[4] < src[2] and src[3] < src[2] and src[2] > src[1] and src[2] > src[0]
plot(f_top(close) ? 1 : 0, "top")
plot(close[4] < close[2] and close[3] < close[2] and close[2] > close[1] and close[2] > close[0] ? 1 : 0, "inline")
`);
        expect(plot('inline')).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
        expect(plot('top')).toEqual(plot('inline'));
    });

    it('keeps the argument history behind a ternary branch (1622 f_fractalize shape)', async () => {
        const plot = await run(`//@version=5
indicator("t")
f_top(src) => src[4] < src[2] and src[3] < src[2] and src[2] > src[1] and src[2] > src[0]
f_bot(src) => src[4] > src[2] and src[3] > src[2] and src[2] < src[1] and src[2] < src[0]
f_fractalize(src) => f_top(src) ? 1 : f_bot(src) ? -1 : 0
plot(f_fractalize(close), "f")
`);
        expect(plot('f')).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
    });
});
