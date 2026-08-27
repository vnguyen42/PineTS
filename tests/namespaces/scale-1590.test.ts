// SPDX-License-Identifier: AGPL-3.0-only

/**
 * namespace scale (corpus 1590; fork fix cf4eff6).
 *
 * `scale` is a display-only enum, but it must still be available while the
 * declaration is evaluated. A valid strategy declaration must therefore run
 * and expose its plotted series instead of failing with `scale is not defined`.
 */

import { describe, expect, it } from 'vitest';
import PineTS from '../../src/PineTS.class';
type PlotPoint = { value: unknown };

const candles = [
    {
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 1,
        openTime: Date.UTC(2024, 0, 1),
        closeTime: Date.UTC(2024, 0, 2),
    },
    {
        open: 10.5,
        high: 12,
        low: 10,
        close: 11.5,
        volume: 1,
        openTime: Date.UTC(2024, 0, 2),
        closeTime: Date.UTC(2024, 0, 3),
    },
];

describe('namespace scale', () => {
    it('accepts scale.none in a strategy declaration', async () => {
        const pineTS = new PineTS(candles, 'TEST', 'D');
        const source = `
//@version=5
strategy("scale enum", overlay=true, scale=scale.none)
plot(close, "close")
`;

        const { plots } = await pineTS.run(source);
        const values = plots.close.data.map((point: PlotPoint) => point.value);
        expect(values).toEqual([10.5, 11.5]);

    });
});
