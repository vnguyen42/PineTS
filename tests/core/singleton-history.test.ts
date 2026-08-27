// SPDX-License-Identifier: AGPL-3.0-only

/**
 * singletons historisés (corpus ids 1744 1778 2372, fork 741400d) — les
 * builtins singleton sont des SÉRIES Pine : `barstate.isfirst[1]` vaut
 * [na, true, false, …] et `dayofmonth[1]`/`hour[1]` rendent le composant de
 * la barre précédente. Couvre aussi le contrat lazy (premier accès
 * conditionnel tardif, 503 barres) et le passage en fonction utilisateur.
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

const candles: Candle[] = [
    { open: 9, high: 10, low: 8, close: 10, volume: 1, openTime: Date.UTC(2020, 0, 1, 23), closeTime: Date.UTC(2020, 0, 2, 0) },
    { open: 10, high: 11, low: 9, close: 11, volume: 1, openTime: Date.UTC(2020, 0, 2, 0), closeTime: Date.UTC(2020, 0, 2, 1) },
    { open: 11, high: 12, low: 10, close: 12, volume: 1, openTime: Date.UTC(2020, 0, 2, 1), closeTime: Date.UTC(2020, 0, 2, 2) },
];

async function run(sourceCode: string) {
    const pineTS = new PineTS(candles, 'TEST', '1h');
    return pineTS.run(sourceCode);
}

function values(plot: { data: Array<{ value: number | null }> }) {
    return plot.data.map((point) => point.value);
}

describe('singleton builtin history', () => {
    it('materializes barstate.isfirst as a historical series', async () => {
        const { plots } = await run(`
//@version=5
indicator("barstate history")
plot(barstate.isfirst ? 1 : 0, "bare")
plot(barstate.isfirst[1] ? 1 : 0, "history")
plot(barstate.isfirst[1], "raw")
`);

        expect(values(plots.bare)).toEqual([1, 0, 0]);
        expect(values(plots.history)).toEqual([0, 1, 0]);
        expect(values(plots.raw).slice(1)).toEqual([true, false]);
        expect(values(plots.raw)[0]).toBeNaN();
    });

    it('materializes time components as historical series in function arguments', async () => {
        const { plots } = await run(`
//@version=5
indicator("time component history")
plot(dayofmonth, "day")
plot(dayofmonth[1], "day1")
plot(hour, "hour")
plot(hour[1], "hour1")
plot(close[1], "close1")
`);

        expect(values(plots.day)).toEqual([1, 2, 2]);
        expect(values(plots.day1).slice(1)).toEqual([1, 2]);
        expect(values(plots.day1)[0]).toBeNaN();
        expect(values(plots.hour)).toEqual([23, 0, 1]);
        expect(values(plots.hour1).slice(1)).toEqual([23, 0]);
        expect(values(plots.hour1)[0]).toBeNaN();
        expect(values(plots.close1).slice(1)).toEqual([10, 11]);
        expect(values(plots.close1)[0]).toBeNaN();
    });
    it('materializes history on the first late conditional access', async () => {
        const lazyCandles: Candle[] = Array.from({ length: 503 }, (_, index) => {
            const openTime = Date.UTC(2020, 0, 1) + index * 60 * 60 * 1000;
            return {
                open: 1,
                high: 2,
                low: 0,
                close: 1,
                volume: 1,
                openTime,
                closeTime: openTime + 60 * 60 * 1000,
            };
        });
        const pineTS = new PineTS(lazyCandles, 'TEST', '1h');
        const { plots } = await pineTS.run(`
//@version=5
indicator("late singleton history")
plot(bar_index >= 500 ? barstate.isfirst[1] : na, "lazyBar")
plot(bar_index >= 500 ? dayofmonth[1] : na, "lazyDay")
`);

        const lazyBar = values(plots.lazyBar).slice(499, 503);
        expect(lazyBar[0]).toBeNaN();
        expect(lazyBar.slice(1)).toEqual([false, false, false]);

        const lazyDay = values(plots.lazyDay).slice(499, 503);
        expect(lazyDay[0]).toBeNaN();
        expect(lazyDay.slice(1)).toEqual([21, 21, 21]);
    });

    it('preserves singleton history when passed to a user function', async () => {
        const { plots } = await run(`
//@version=5
indicator("singleton function history")
identity(value) => value
plot(identity(barstate.isfirst[1]), "bar")
plot(identity(dayofmonth[1]), "day")
`);

        expect(values(plots.bar).slice(1)).toEqual([true, false]);
        expect(values(plots.bar)[0]).toBeNaN();
        expect(values(plots.day).slice(1)).toEqual([1, 2]);
        expect(values(plots.day)[0]).toBeNaN();
    });
});

