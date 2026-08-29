import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processExitOrders, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { Series } from '../../../src/Series';

// Mechanism: crypto-market-fill-mintick-snap (revealing id 1592).
// TradingView records a crypto market fill on the nearest mintick after
// slippage. The display/OHLC path remains independent from this execution
// snap, so non-market/non-gap fills and non-crypto/non-stock assets retain
// their existing behavior.
function makeContext(type = 'crypto') {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'BINANCE:JASMYUSDT',
        timeframe: '240',
    });
    context.idx = 0;
    context.data.open = new Series([0.0056]);
    context.data.high = new Series([0.0056]);
    context.data.low = new Series([0.00559]);
    context.data.close = new Series([0.0056]);
    context.data.openTime = new Series([0]);
    context.pine = { syminfo: { mintick: 0.00001, pointvalue: 1, type } };
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
    return context;
}

function setBar(context: Context, idx: number, open: number, high = open, low = open, close = open) {
    context.idx = idx;
    context.data.open = new Series([open, open]);
    context.data.high = new Series([high, high]);
    context.data.low = new Series([low, low]);
    context.data.close = new Series([close, close]);
    context.data.openTime = new Series([idx * 86_400_000, idx * 86_400_000]);
}

describe('crypto-market-fill-mintick-snap (1592)', () => {
    it('snaps an off-grid crypto market entry to the nearest tick, half up', () => {
        const context = makeContext();
        entry(context)('M', 'long');
        // 0.0056051 is just above the 0.005605 half-tick boundary and must
        // resolve to 0.00561, as TV does for the 1592 JASMYUSDT fill.
        setBar(context, 1, 0.0056051, 0.0056051, 0.0056, 0.0056);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(0.00561);
    });

    it('snaps a spot/crypto market exit and preserves an already-grid entry', () => {
        const context = makeContext('spot');
        entry(context)('M', 'long');
        setBar(context, 1, 0.00561);
        expect(processStrategyOrders(context)).toBe(1);

        context.strategy.pending_orders.push({
            id: 'close', direction: 0, qty: 0, type: 'market', category: 'exit',
            from_entry: '', status: 'pending', bar: 1, time: 86_400_000,
        });
        setBar(context, 2, 0.0056051, 0.0056051, 0.0056, 0.0056);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy.closedtrades[0].exit_price).toBe(0.00561);
    });

    it('does not snap a market fill for a non-crypto, non-stock asset', () => {
        const context = makeContext('forex');
        entry(context)('M', 'long');
        setBar(context, 1, 0.0056051, 0.0056051, 0.0056, 0.0056);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(0.0056051);
    });
});
