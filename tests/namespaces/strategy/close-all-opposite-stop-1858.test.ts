import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// Family: close-all projection for opposite price-based entries (1858).
// TradingView 1858 evidence: close_all at the bar open, then a short stop
// followed by a long stop on the same OHLC path; the long stop closes the new
// short and does not open a long lot.

type Bar = { open: number; high: number; low: number; close: number };

const BARS = [
    { open: 100, high: 100, low: 100, close: 100 },
    { open: 100, high: 100, low: 100, close: 100 },
    { open: 100, high: 110, low: 90, close: 100 },
    { open: 100, high: 100, low: 100, close: 100 },
].map((bar: Bar, index) => ({
    ...bar,
    openTime: index * 14_400_000,
    closeTime: (index + 1) * 14_400_000 - 1,
    volume: 1,
    quoteAssetVolume: 0,
    numberOfTrades: 0,
    takerBuyBaseAssetVolume: 0,
    takerBuyQuoteAssetVolume: 0,
    ignore: 0,
}));

const SOURCE = `//@version=5
strategy('1858 close-all opposite stop', pyramiding=1, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('seed', strategy.short)
if bar_index == 1
    strategy.close_all()
if bar_index >= 1
    strategy.entry('long-stop', strategy.long, stop=109)
    strategy.entry('short-stop', strategy.short, stop=91)
`;

describe('1858 close-all opposite stop projection', () => {
    it('closes the post-close short without opening a stale opposite lot', async () => {
        const context = await new PineTS(BARS, 'TEST:1858', '240').run(SOURCE);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy was not initialized');

        expect(strategy.closedtrades).toHaveLength(2);
        expect(strategy.closedtrades.map((trade) => trade.entry_id)).toEqual(['seed', 'short-stop']);
        expect(strategy.closedtrades[1]).toMatchObject({ entry_price: 91, exit_price: 109 });
        expect(strategy.opentrades).toHaveLength(0);
        expect(strategy.position_size).toBe(0);
    });
});
