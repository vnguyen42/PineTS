// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * OHLC4_OPERAND_ORDER — revealing script 2701 (OKX:CROUSDT 240).
 *
 * TradingView sums ohlc4 as (open + high + low + close) / 4. The engine
 * summed high + low + open + close, which differs at the last ulp on real
 * bars. On 2701 the long entry is `ta.crossover(ohlc4, ohlc4 three bars
 * ago)`: bar 2020-05-04 00:00 (OHLC 0.0601/0.0603/0.0582/0.0594) and bar
 * 2020-05-04 12:00 (0.0585/0.0609/0.0584/0.0602) are both
 * 0.059500000000000004 in TV order — no cross, no TV trade — while the old
 * order made the first one 0.0595 and fabricated a cross.
 *
 * RED on the parent (bar 1 is 0.0595), GREEN after.
 */

import { describe, it, expect } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const T0 = Date.parse('2020-05-03T08:00:00Z');
const H4 = 4 * 3_600_000;

const BARS = [
    { open: 0.06, high: 0.06, low: 0.06, close: 0.06 },
    { open: 0.0601, high: 0.0603, low: 0.0582, close: 0.0594 },
    { open: 0.0585, high: 0.0609, low: 0.0584, close: 0.0602 },
];

async function run() {
    const candles = BARS.map((b, i) => ({ ...b, openTime: T0 + i * H4, closeTime: T0 + (i + 1) * H4, volume: 1 }));
    const engine = new PineTS(candles, 'CROUSDT', '240', null, T0, T0 + (BARS.length - 1) * H4);
    const { plots } = await engine.run(`//@version=5
indicator("ohlc4-order")
plot(ohlc4, title="o4")
`);
    return {
        o4: plots.o4.data.map((p: { value: unknown }) => p.value),
    };
}

describe('ohlc4 operand order (OHLC4_OPERAND_ORDER, 2701)', () => {
    it('sums open + high + low + close like TradingView', async () => {
        const { o4 } = await run();
        expect(Object.is(o4[1], 0.059500000000000004)).toBe(true);
        expect(Object.is(o4[2], 0.059500000000000004)).toBe(true);
    });
});
