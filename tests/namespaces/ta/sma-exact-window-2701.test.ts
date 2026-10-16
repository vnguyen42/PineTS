// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * SMA_EXACT_WINDOW — revealing scripts 2701 (OKX:CROUSDT 240) and 2673
 * (BINANCE:ICPUSDT 60).
 *
 * ta.sma returns the window mean from a compensated sum, unrounded. The
 * engine kept a rolling sum (sum + current − popped, drifting by float
 * residue) and rounded the mean to 10 dp through context.precision.
 *  - 2701 enters on `ta.crossover(ohlc4, ta.sma(ohlc4, 1)[3])`: on
 *    2020-05-04 12:00 the current ohlc4 and the one three bars earlier are
 *    both 0.059500000000000004 — no TradingView trade; the rounded 0.0595
 *    fabricated a long entry 2020-05-04 16:00.
 *  - 2673 crosses ta.sma(close, 50) and ta.sma(close, 200): on 2025-10-25
 *    04:00 both are 3.072 and TradingView does not cross; a plain
 *    left-to-right sum of the 200 closes below gives 3.0719999999999983 and
 *    fabricates the cross one bar early.
 *
 * RED on the parent (0.0595 instead of the raw source), GREEN after; the
 * 2673 case is the guard against an uncompensated window sum.
 */

import { describe, it, expect } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const H1 = 3_600_000;
const RAW = 0.059500000000000004;

// BINANCE:ICPUSDT 60 closes 2025-10-16 21:00 → 2025-10-25 04:00 (200 bars).
const ICP_CLOSES = [
    3.156, 3.127, 3.141, 3.15, 3.134, 3.115, 3.139, 3.123, 3.123, 3.031, 2.94, 2.923, 2.985, 3.008, 3.059, 3.014, 3.022, 3.006, 3.007, 2.933,
    2.95, 2.97, 2.975, 3.01, 3.025, 3.006, 3.009, 3.035, 3.067, 3.054, 3.055, 3.027, 3.051, 3.053, 3.059, 3.041, 3.066, 3.077, 3.085, 3.066,
    3.038, 3.052, 3.048, 3.034, 3.063, 3.053, 3.06, 3.056, 3.067, 3.053, 3.048, 3.025, 3.037, 3.03, 3.061, 3.037, 3.03, 3.019, 3.03, 3.013,
    3.053, 3.087, 3.073, 3.063, 3.111, 3.123, 3.107, 3.103, 3.088, 3.094, 3.099, 3.113, 3.093, 3.098, 3.069, 3.044, 3.038, 3.046, 3.12, 3.131,
    3.138, 3.181, 3.17, 3.162, 3.155, 3.158, 3.174, 3.167, 3.188, 3.18, 3.144, 3.136, 3.13, 3.14, 3.175, 3.215, 3.182, 3.189, 3.189, 3.175,
    3.149, 3.12, 3.103, 3.07, 3.068, 3.074, 3.072, 3.052, 3.049, 3.085, 3.081, 3.089, 3.099, 3.219, 3.255, 3.229, 3.23, 3.212, 3.184, 3.148,
    3.15, 3.082, 3.045, 3.048, 3.055, 3.048, 3.05, 3.059, 3.029, 3.014, 3.047, 3.027, 2.993, 2.989, 3.014, 3.022, 3.051, 3.04, 3.01, 2.997,
    2.966, 2.976, 2.981, 2.954, 2.913, 2.91, 2.977, 2.998, 2.997, 2.998, 2.993, 2.996, 2.999, 3.042, 3.028, 3.026, 3.014, 3.019, 2.999, 3.002,
    3.006, 2.994, 3.031, 3.063, 3.076, 3.046, 3.039, 3.002, 3.005, 3.023, 3.04, 3.058, 3.062, 3.059, 3.056, 3.103, 3.109, 3.121, 3.113, 3.119,
    3.108, 3.091, 3.102, 3.12, 3.105, 3.076, 3.066, 3.059, 3.075, 3.093, 3.113, 3.151, 3.154, 3.147, 3.145, 3.164, 3.16, 3.159, 3.133, 3.136,
];

async function run(closes: number[], script: string) {
    const T0 = Date.parse('2025-10-16T21:00:00Z');
    const candles = closes.map((c, i) => ({
        openTime: T0 + i * H1, closeTime: T0 + (i + 1) * H1, open: c, high: c, low: c, close: c, volume: 1,
    }));
    const engine = new PineTS(candles, 'TEST', '60', null, T0, T0 + (closes.length - 1) * H1);
    const { plots } = await engine.run(script);
    return plots;
}

const values = (plots: Record<string, { data: Array<{ value: unknown }> }>, name: string) =>
    plots[name].data.map((p) => p.value);

describe('ta.sma exact window mean (SMA_EXACT_WINDOW, 2701/2673)', () => {
    it('returns the raw source for length 1 (no 10 dp rounding)', async () => {
        const plots = await run([0.0599, RAW, 0.0592], `//@version=5
indicator("sma-exact")
plot(ta.sma(close, 1), title="s")
`);
        expect(Object.is(values(plots, 's')[1], RAW)).toBe(true);
    });

    it('gives 3.072 for both the 50- and 200-bar means of the 2673 closes', async () => {
        const plots = await run(ICP_CLOSES, `//@version=5
indicator("sma-2673")
plot(ta.sma(close, 50), title="fast")
plot(ta.sma(close, 200), title="slow")
`);
        const last = ICP_CLOSES.length - 1;
        expect(Object.is(values(plots, 'fast')[last], 3.072)).toBe(true);
        expect(Object.is(values(plots, 'slow')[last], 3.072)).toBe(true);
    });
});
