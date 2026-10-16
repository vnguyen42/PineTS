// Famille : short-reentry-buy-exit-spared — target 1825 (NASDAQ:COIN 120,
// "Gap Filling Strategy", v4). On a new-session gap the script calls
// strategy.close_all() then strategy.entry() in the SAME direction and
// strategy.exit(limit=lim) for that entry: the old lot is closed and the new
// one opened at the next bar's open. TV ledger (capture tv-vin95/1825):
//   - 72 short re-entries: none exits on its entry bar, although the buy limit
//     is crossed on that bar 20 times (bar 136: open 241.67, low 238.98, limit
//     240.94 → TV exits on bar 137 at its 239.75 open);
//   - 71 long re-entries: the sell limit is crossed on the entry bar 13 times and
//     TV exits there every time (bar 742: limit 234, exit 234).
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Kline } from '../../../src/marketData/types';

const HOUR = 3_600_000;

function candle(index: number, open: number, high: number, low: number, close: number): Kline {
    return {
        openTime: index * HOUR,
        open,
        high,
        low,
        close,
        volume: 1000,
        closeTime: (index + 1) * HOUR - 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

function script(side: 'long' | 'short', limit: number) {
    const id = side === 'long' ? 'Buy' : 'Sell';
    return `
//@version=5
strategy('1825 same-side re-entry', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('${id}', strategy.${side})
if bar_index == 2
    strategy.close_all()
    strategy.entry('${id}', strategy.${side})
if bar_index >= 2
    strategy.exit('X${id}', '${id}', limit=${limit})`;
}

describe('1825 — same-side re-entry after close_all at the same open', () => {
    it('short: the buy limit crossed on the re-entry bar fills on the next bar (bar 136)', async () => {
        const candles = [
            candle(0, 240, 241, 239, 240),
            candle(1, 240, 241, 239, 240.5),
            candle(2, 241.53, 243.8, 240.31, 241.32), // signal bar: close_all + Sell, limit 240.94
            candle(3, 241.67, 242.68, 238.98, 239.41), // re-entry at 241.67, low crosses 240.94
            candle(4, 239.75, 240.38, 239.01, 239.98), // opens below the limit
        ];
        const context = await new PineTS(candles).run(script('short', 240.94));
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        const trades = strategy.closedtrades.map((t: { entry_bar_index: number; entry_price: number; exit_bar_index: number; exit_price: number }) =>
            [t.entry_bar_index, t.entry_price, t.exit_bar_index, t.exit_price]);
        expect(trades).toEqual([[1, 240, 3, 241.67], [3, 241.67, 4, 239.75]]);
    });

    it('long: the sell limit crossed on the re-entry bar fills on that bar (bar 742)', async () => {
        const candles = [
            candle(0, 230, 231, 229, 230),
            candle(1, 230, 231, 229, 230.5),
            candle(2, 236.5, 237.51, 235.9, 237.51), // signal bar: close_all + Buy, limit 234
            candle(3, 232.63, 235.4, 231.11, 232.39), // re-entry at 232.63, high crosses 234
            candle(4, 232.39, 233, 231, 232),
        ];
        const context = await new PineTS(candles).run(script('long', 234));
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        const trades = strategy.closedtrades.map((t: { entry_bar_index: number; entry_price: number; exit_bar_index: number; exit_price: number }) =>
            [t.entry_bar_index, t.entry_price, t.exit_bar_index, t.exit_price]);
        expect(trades).toEqual([[1, 230, 3, 232.63], [3, 232.63, 3, 234]]);
    });

    it('short from flat: the buy limit still fills on the entry bar', async () => {
        const candles = [
            candle(0, 240, 241, 239, 240),
            candle(1, 241.67, 242.68, 238.98, 239.41),
            candle(2, 239.75, 240.38, 239.01, 239.98),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('1825 fresh short', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('Sell', strategy.short)
strategy.exit('XSell', 'Sell', limit=240.94)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        expect(strategy.closedtrades).toHaveLength(1);
        expect([strategy.closedtrades[0].exit_bar_index, strategy.closedtrades[0].exit_price]).toEqual([1, 240.94]);
    });

    it('short: a buy STOP crossed on the re-entry bar still fills there (no evidence for sparing stops)', async () => {
        const candles = [
            candle(0, 240, 241, 239, 240),
            candle(1, 240, 241, 239, 240.5),
            candle(2, 241.53, 243.8, 240.31, 241.32),
            candle(3, 241.67, 242.68, 238.98, 239.41), // re-entry at 241.67, high crosses the 242.5 stop
            candle(4, 239.75, 240.38, 239.01, 239.98),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('1825 re-entry stop', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('Sell', strategy.short)
if bar_index == 2
    strategy.close_all()
    strategy.entry('Sell', strategy.short)
if bar_index >= 2
    strategy.exit('XSell', 'Sell', stop=242.5)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        const last = strategy.closedtrades[strategy.closedtrades.length - 1];
        expect([last.entry_bar_index, last.exit_bar_index, last.exit_price]).toEqual([3, 3, 242.5]);
    });

    it('short added inside the bar by a stop entry keeps its buy limit (not filled at the open)', async () => {
        const candles = [
            candle(0, 240, 241, 239, 240),
            candle(1, 240, 241, 239, 240.5),
            candle(2, 241.53, 243.8, 240.31, 241.32),
            candle(3, 241.67, 242.68, 238.98, 239.41), // Sell stop 240 fills on the way down; limit 239.5 below
            candle(4, 239.75, 240.38, 239.01, 239.98),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('1825 stop re-entry', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('Sell', strategy.short)
if bar_index == 2
    strategy.close_all()
    strategy.entry('Sell', strategy.short, stop=240)
if bar_index >= 2
    strategy.exit('XSell', 'Sell', limit=239.5)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        const last = strategy.closedtrades[strategy.closedtrades.length - 1];
        expect([last.entry_bar_index, last.entry_price, last.exit_bar_index, last.exit_price]).toEqual([3, 240, 3, 239.5]);
    });
});
