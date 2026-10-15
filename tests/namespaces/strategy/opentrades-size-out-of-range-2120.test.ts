// Famille : opentrades-size-out-of-range — target 2120 (NASDAQ:DOCU, 60m).
// The script gates its flat-time exit on
// `strategy.opentrades.size(strategy.opentrades - 1) <= 0`. TradingView answers
// 0 for a trade number with no open trade: it fills the exit placed on the
// flat signal bar 8640 (stop 57.09) on bar 8641. With `na` the gate is false
// and the exit is never placed.
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Kline } from '../../../src/marketData/types';

const HOUR = 3_600_000;

function candle(openTime: number, open: number, high: number, low: number, close: number): Kline {
    return {
        openTime,
        open,
        high,
        low,
        close,
        volume: 1000,
        closeTime: openTime + HOUR - 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

describe('2120 — strategy.opentrades.size() without an open trade', () => {
    it('is 0 while flat, so the flat-time entry/exit gate of 2120 opens', async () => {
        // 2120 bars 8640-8642: signal on 8640, gap open at 58.77 on 8641,
        // low 56.98 crosses the stop placed on 8640.
        const candles = [
            candle(0, 57.35, 57.76, 57.3, 57.76),
            candle(HOUR, 57.79, 58.44, 57.64, 58.01),
            candle(2 * HOUR, 58.77, 58.77, 56.98, 57.64),
            candle(3 * HOUR, 57.64, 57.66, 56.8, 56.84),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('2120 opentrades.size gate', process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=5)
signal = bar_index == 1
valid = signal and strategy.opentrades.size(strategy.opentrades - 1) <= 0
active = valid or strategy.opentrades.size(strategy.opentrades - 1) > 0
if signal
    strategy.entry('Long Entry', strategy.long, stop=high)
if not signal
    strategy.cancel('Long Entry')
if active
    strategy.exit('Long Exit', stop=bar_index == 1 ? 57.09 : 57.16)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        expect(strategy.closedtrades).toHaveLength(1);
        const trade = strategy.closedtrades[0];
        expect(trade.entry_bar_index).toBe(2);
        expect(trade.entry_price).toBe(58.77);
        expect(trade.exit_bar_index).toBe(2);
        expect(trade.exit_price).toBe(57.09);
    });

    it('still reports the size of an existing open trade', async () => {
        const candles = [
            candle(0, 100, 101, 99, 100),
            candle(HOUR, 100, 101, 99, 100),
            candle(2 * HOUR, 100, 101, 99, 100),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('opentrades.size in range', default_qty_type=strategy.fixed, default_qty_value=3)
if bar_index == 0
    strategy.entry('S', strategy.short)
plot(strategy.opentrades.size(strategy.opentrades - 1), 'size')`);
        const size = context.plots['size'].data.map((point: { value: number }) => point.value);
        expect(size).toEqual([0, -3, -3]);
    });
});
