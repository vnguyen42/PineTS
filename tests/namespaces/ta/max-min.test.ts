// SPDX-License-Identifier: AGPL-3.0-only

// ta.max / ta.min — all-time running max/min from the first bar.
// TV reference (Pine Script v6 Reference, ta.max / ta.min):
//   "Returns the all-time high/low value of source from the beginning of the
//   chart up to the current bar." Remarks: "na occurrences of source are
//   ignored." — an na bar leaves the running value unchanged; before the first
//   non-na value the result is na.
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Indicator } from '../../../src/Indicator';

// Hand-crafted 1D series: closes 10, 20, 5, 15, na, 30, 25, 12.
// Hand-computed expectations:
//   ta.max(close) = [10, 20, 20, 20, 20, 30, 30, 30]   (bar 5 na ignored)
//   ta.min(close) = [10, 10,  5,  5,  5,  5,  5,  5]   (bar 5 na ignored)
function makeSeries(closes: number[]) {
    const DAY = 86_400_000;
    const t0 = new Date('2024-01-01T00:00:00Z').getTime();
    return closes.map((close, i) => ({
        openTime: t0 + i * DAY,
        open: close, // open == close so hlc3/hl2 stay finite for other probes
        high: close,
        low: close,
        close,
        volume: 1000,
        closeTime: t0 + (i + 1) * DAY - 1,
    }));
}

const CLOSES = [10, 20, 5, 15, NaN, 30, 25, 12];
const EXPECTED_MAX = [10, 20, 20, 20, 20, 30, 30, 30];
const EXPECTED_MIN = [10, 10, 5, 5, 5, 5, 5, 5];

describe('Technical Analysis - ta.max / ta.min', () => {
    it('runtime form: cumulative all-time max/min, na occurrences ignored', async () => {
        const pineTS = new PineTS(makeSeries(CLOSES), 'TEST', '1D');

        const { plots } = await pineTS.run(($) => {
            const { close } = $.data;
            const { ta, plotchar } = $.pine;

            const max = ta.max(close);
            const min = ta.min(close);
            plotchar(max, 'max');
            plotchar(min, 'min');
        });

        const maxValues = (plots['max']?.data ?? []).map((p) => p.value);
        const minValues = (plots['min']?.data ?? []).map((p) => p.value);
        expect(maxValues).toHaveLength(CLOSES.length);
        expect(minValues).toHaveLength(CLOSES.length);

        for (let i = 0; i < CLOSES.length; i++) {
            expect(maxValues[i]).toBe(EXPECTED_MAX[i]);
            expect(minValues[i]).toBe(EXPECTED_MIN[i]);
        }
    });

    it('runtime form: leading na bars stay na until the first non-na value', async () => {
        const pineTS = new PineTS(makeSeries([NaN, NaN, 10, 5, 12]), 'TEST', '1D');

        const { plots } = await pineTS.run(($) => {
            const { close } = $.data;
            const { ta, plotchar } = $.pine;

            plotchar(ta.max(close), 'max');
            plotchar(ta.min(close), 'min');
        });

        const maxValues = (plots['max']?.data ?? []).map((p) => p.value);
        const minValues = (plots['min']?.data ?? []).map((p) => p.value);
        expect(maxValues.map((v: number) => (Number.isNaN(v) ? 'na' : v))).toEqual(['na', 'na', 10, 10, 12]);
        expect(minValues.map((v: number) => (Number.isNaN(v) ? 'na' : v))).toEqual(['na', 'na', 10, 5, 5]);
    });

    it('transpile path: raw Pine `ta.max(close)` / `ta.min(close)` (script 1956 shape)', async () => {
        const source = `//@version=5
indicator("maxmin-repro", overlay=true)
plot(ta.max(close), "max")
plot(ta.min(close), "min")
`;
        const ind = Indicator.from(source);
        const engine = new PineTS(makeSeries(CLOSES), 'TEST', '1D');
        const { plots } = await engine.run(ind);

        const maxValues = (plots['max']?.data ?? []).map((p) => p.value);
        const minValues = (plots['min']?.data ?? []).map((p) => p.value);
        expect(maxValues).toHaveLength(CLOSES.length);
        expect(minValues).toHaveLength(CLOSES.length);

        for (let i = 0; i < CLOSES.length; i++) {
            expect(maxValues[i]).toBe(EXPECTED_MAX[i]);
            expect(minValues[i]).toBe(EXPECTED_MIN[i]);
        }
    });

    it('runtime form: per-call-site state isolation (two max calls on different sources)', async () => {
        const pineTS = new PineTS(makeSeries([10, 20, 5, 15]), 'TEST', '1D');

        const { plots } = await pineTS.run(($) => {
            const { close, high } = $.data;
            const { ta, plotchar } = $.pine;

            // Two call sites on the same bar must not share state: a
            // hypothetical shared accumulator would let maxA pollute maxB.
            const maxA = ta.max(close);
            const maxB = ta.max(high);
            plotchar(maxA, 'maxA');
            plotchar(maxB, 'maxB');
        });

        expect((plots['maxA']?.data ?? []).map((p) => p.value)).toEqual([10, 20, 20, 20]);
        // high === close in the fixture, so maxB is the identical series —
        // the point is the two call sites each keep their own accumulator.
        expect((plots['maxB']?.data ?? []).map((p) => p.value)).toEqual([10, 20, 20, 20]);
    });
});
