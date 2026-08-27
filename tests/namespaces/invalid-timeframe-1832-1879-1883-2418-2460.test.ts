// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Invalid timeframe (corpus 1832, 1879, 1883, 2418, 2460; fork fix 3e011b1).
 *
 * The corpus uses servable intraday multipliers outside the original frozen
 * whitelist: 360 (6h), 480 (8h), and 720 (12h). request.security must accept
 * those values and return the requested series rather than throwing
 * `Invalid timeframe`.
 */

import { describe, expect, it } from 'vitest';
import PineTS from '../../src/PineTS.class';

type Candle = {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    openTime: number;
    closeTime: number;
};

type PlotPoint = { value: unknown };

const candles: Candle[] = Array.from({ length: 8 }, (_, index) => {
    const openTime = Date.UTC(2024, 0, 1) + index * 60 * 60 * 1000;
    return {
        open: 100 + index,
        high: 101 + index,
        low: 99 + index,
        close: 100.5 + index,
        volume: 1,
        openTime,
        closeTime: openTime + 60 * 60 * 1000,
    };
});

describe('request.security invalid timeframe validation', () => {
    it.each(['360', '480', '720'])('serves the observed %s-minute timeframe', async (timeframe) => {
        const pineTS = new PineTS(candles, 'TEST', '60');
        const source = `
//@version=5
indicator("servable intraday timeframe")
wide = request.security("", "${timeframe}", close)
plot(wide, "wide")
`;

        const { plots } = await pineTS.run(source);
        const values = (plots.wide.data as PlotPoint[]).map((point) => point.value);

        expect(values).toHaveLength(candles.length);
        expect(values.every((value): value is number => typeof value === 'number' && Number.isFinite(value))).toBe(true);
    });
});
