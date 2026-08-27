// SPDX-License-Identifier: AGPL-3.0-only

/**
 * builtin timenow (corpus 2540, 2176; fork fix 511c2b1).
 *
 * TradingView exposes timenow as wall-clock UNIX milliseconds, not as the
 * current bar's timestamp. The test compares the returned series with the
 * wall clock observed around the run.
 */

import { describe, expect, it } from 'vitest';
import PineTS from '../../src/PineTS.class';
type PlotPoint = { value: unknown };

const candles = [
    {
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
        openTime: Date.UTC(2020, 0, 1),
        closeTime: Date.UTC(2020, 0, 2),
    },
    {
        open: 100,
        high: 102,
        low: 98,
        close: 101,
        volume: 1,
        openTime: Date.UTC(2020, 0, 2),
        closeTime: Date.UTC(2020, 0, 3),
    },
];

describe('builtin timenow', () => {
    it('returns wall-clock UNIX milliseconds for every bar', async () => {
        const pineTS = new PineTS(candles, 'TEST', 'D');
        const source = `
//@version=5
indicator("timenow")
plot(timenow, "now")
`;
        const startedAt = Date.now();
        const { plots } = await pineTS.run(source);
        const finishedAt = Date.now();
        const values = plots.now.data.map((point: PlotPoint) => point.value);

        expect(values).toHaveLength(candles.length);
        expect(values.every((value: unknown) =>
            typeof value === 'number'
            && Number.isFinite(value)
            && value >= startedAt
            && value <= finishedAt,
        )).toBe(true);
    });
});
