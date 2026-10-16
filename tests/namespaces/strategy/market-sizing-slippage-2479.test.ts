// Famille : market-sizing-slippage — target 2479 (AMEX:SPY 60, "VIDYA Trend
// Strategy", percent_of_equity 4, slippage 1, process_orders_on_close).
// TradingView sizes a DEFAULT price-sized MARKET entry on the signal close
// moved by the configured slippage, on every symbol class (VIN-B proved it on
// crypto/spot only). On the raw close the engine bought one share too many
// on 22 of 4519 SPY entries (bar 369: TV 189, engine 190), 4519/4519
// quantities with the slippage; NASDAQ:RENT 1786 (slippage 2) goes from 135
// to 142/142 full keys.
import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { initializeStrategy } from '../../../src/namespaces/strategy/utils';

function sizedQty(type: 'stock' | 'fund' | 'futures' | 'forex', direction: 'long' | 'short', config: Record<string, unknown>, qtyStep = 1): number {
    const context = new Context({ marketData: [], source: [], tickerId: 'AMEX:SPY', timeframe: '60' });
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([100]);
    context.data.low = new Series([100]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick: 0.01, pointvalue: 1, type, prefix: 'AMEX' };
    context.pine.qtyStep = qtyStep;
    initializeStrategy(context, {
        initial_capital: 10_000,
        default_qty_type: 'percent_of_equity',
        default_qty_value: 100,
        ...config,
    });
    entry(context)('E', direction);
    const order = context.strategy!.pending_orders[0];
    return order.qty;
}

describe('2479 — market entry sized on close + slippage', () => {
    it('long: 10 000 / (100 + 1 tick) = 99 shares, not 100', () => {
        expect(sizedQty('fund', 'long', { slippage: 1 })).toBe(99);
        expect(sizedQty('stock', 'long', { slippage: 1 })).toBe(99);
    });

    it('short: the slippage is directional (100 − 2 ticks)', () => {
        // Fractional step 0.001: 10 000 / 99.98 = 100.020 (raw close: 100);
        // long 10 000 / 100.02 = 99.980.
        expect(sizedQty('fund', 'short', { slippage: 2 }, 0.001)).toBe(100.02);
        expect(sizedQty('fund', 'long', { slippage: 2 }, 0.001)).toBe(99.98);
    });

    it('keeps futures and forex on the raw close (no capture proves the reserve there)', () => {
        expect(sizedQty('futures', 'long', { slippage: 1 }, 0.001)).toBe(100);
        expect(sizedQty('forex', 'long', { slippage: 1 }, 0.001)).toBe(100);
    });

    it('without slippage the raw close stays the sizing price', () => {
        expect(sizedQty('fund', 'long', {})).toBe(100);
    });
});
