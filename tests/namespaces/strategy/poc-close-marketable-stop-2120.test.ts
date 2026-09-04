// Famille : POC_CLOSE_MARKETABLE_STOP — target 2120 (NASDAQ:DOCU, 60m).
// Under process_orders_on_close, a stop entry emitted on a bar whose close is
// already at/through the trigger fills on that bar at the close.
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Kline } from '../../../src/marketData/types';

function candle(openTime: number, open: number, high: number, low: number, close: number): Kline {
    return {
        openTime,
        open,
        high,
        low,
        close,
        volume: 1000,
        closeTime: openTime + 3_599_999,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

const HOUR = 3_600_000;

describe('2120 — close-marketable stop entry under process_orders_on_close', () => {
    it('fills a current-bar long stop at the signal bar close even when the high is above the trigger', async () => {
        const candles = [
            candle(0, 100, 102, 98, 101),
            candle(HOUR, 100, 110, 90, 105),
            candle(2 * HOUR, 105, 108, 103, 106),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('2120 POC close-marketable stop distinct close', process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 1 and close[1] < high and close == 105
    strategy.entry('Long', strategy.long, stop=105)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        // Proves the fill price is the signal close (105), not the bar high (110).
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_bar_index).toBe(1);
        expect(strategy.opentrades[0].entry_price).toBe(105);
    });

    it('fills a current-bar long stop at the signal bar close when close equals high', async () => {
        const candles = [
            candle(0, 60, 61, 59, 60),
            candle(HOUR, 61.87, 63.97, 61.87, 63.97),
            candle(2 * HOUR, 63.97, 64.5, 63.5, 64),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('2120 POC close-marketable stop', process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 1 and close[1] < high and close == high
    strategy.entry('Long', strategy.long, stop=high)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_bar_index).toBe(1);
        expect(strategy.opentrades[0].entry_price).toBe(63.97);
    });
});
