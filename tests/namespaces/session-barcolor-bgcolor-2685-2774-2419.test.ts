// SPDX-License-Identifier: AGPL-3.0-only

/**
 * singletons session + barcolor/bgcolor (corpus 2685, 2774, 2419;
 * fork fix 965cdcb).
 *
 * The corpus uses session.isfirstbar/islastbar for day boundaries and also
 * declares variables named barcolor/bgcolor before calling the corresponding
 * builtins. These are separate observable contracts, so each has its own test.
 */

import { describe, expect, it } from 'vitest';
import PineTS from '../../src/PineTS.class';

type PlotPoint = { value: unknown; options?: { color?: unknown } };

type Candle = {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    openTime: number;
    closeTime: number;
};

const candles: Candle[] = [
    {
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 1,
        openTime: Date.UTC(2024, 0, 1, 23),
        closeTime: Date.UTC(2024, 0, 2, 0),
    },
    {
        open: 10.5,
        high: 12,
        low: 10,
        close: 11.5,
        volume: 1,
        openTime: Date.UTC(2024, 0, 2, 0),
        closeTime: Date.UTC(2024, 0, 2, 1),
    },
    {
        open: 11.5,
        high: 13,
        low: 11,
        close: 11,
        volume: 1,
        openTime: Date.UTC(2024, 0, 2, 1),
        closeTime: Date.UTC(2024, 0, 2, 2),
    },
    {
        open: 11,
        high: 12,
        low: 10,
        close: 11.25,
        volume: 1,
        openTime: Date.UTC(2024, 0, 3, 0),
        closeTime: Date.UTC(2024, 0, 3, 1),
    },
];


describe('singletons session + barcolor/bgcolor', () => {
    it('marks the first and last bar of each UTC session day', async () => {
        const pineTS = new PineTS(candles, 'TEST', '60');
        const source = `
//@version=5
indicator("session boundaries")
plot(session.isfirstbar ? 1 : 0, "first")
plot(session.islastbar ? 1 : 0, "last")
`;

        const { plots } = await pineTS.run(source);

        expect(plots.first.data.map((point: PlotPoint) => point.value)).toEqual([1, 1, 0, 1]);
        expect(plots.last.data.map((point: PlotPoint) => point.value)).toEqual([1, 0, 1, 1]);
    });

    it('keeps barcolor builtin callable after a barcolor variable declaration', async () => {
        const pineTS = new PineTS(candles, 'TEST', '60');
        const source = `
//@version=5
indicator("barcolor shadow")
barcolor = close > open ? color.green : color.red
barcolor(barcolor, title="bars")
`;

        const { plots } = await pineTS.run(source);
        const points = plots.bars.data as PlotPoint[];

        expect(points.map((point) => point.options?.color)).toEqual([
            '#4CAF50',
            '#4CAF50',
            '#F23645',
            '#4CAF50',
        ]);
    });

    it('keeps bgcolor builtin callable after a bgcolor variable declaration', async () => {
        const pineTS = new PineTS(candles, 'TEST', '60');
        const source = `
//@version=5
indicator("bgcolor shadow")
bgcolor = close > open ? color.green : color.red
bgcolor(bgcolor, title="background")
`;

        const { plots } = await pineTS.run(source);
        const points = plots.background.data as PlotPoint[];

        expect(points.map((point) => point.options?.color)).toEqual([
            '#4CAF50',
            '#4CAF50',
            '#F23645',
            '#4CAF50',
        ]);
    });
});
