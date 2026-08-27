import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { order } from '../../../src/namespaces/strategy/methods/order';
import { Series } from '../../../src/Series';

// Famille : STOP_ENTRY_QUANTIZATION_REFERENCE_POST_SLIPPAGE — ids 1665, 1828,
// 2454, 2118, 2097, fix d50ccaa. A pure stop that is already beyond the
// submission close is triggered, but keeps its order level for sizing; its
// next admissible fill is the bar open, then slippage is applied. A stop that
// crosses intrabar still fills at the stop level before slippage.
function makeContext(config: Record<string, unknown> = {}) {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'BTCUSDT',
        timeframe: 'D',
    });
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick: 0.01, pointvalue: 1, type: 'crypto' };
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, ...config });
    return context;
}

function setBar(context: Context, open: number, high: number, low: number, close: number) {
    context.idx = 1;
    context.data.open = new Series([100, open]);
    context.data.high = new Series([101, high]);
    context.data.low = new Series([99, low]);
    context.data.close = new Series([100, close]);
    context.data.openTime = new Series([0, 86_400_000]);
}

describe('STOP_ENTRY_QUANTIZATION_REFERENCE_POST_SLIPPAGE (d50ccaa)', () => {
    it('fills a marketable strategy.entry stop at the next open, then applies long slippage', () => {
        const context = makeContext({ slippage: 2 });
        entry(context)('L', 'long', { stop: 98 }); // strictly below the signal close
        setBar(context, 97, 99, 96, 98);

        expect(processStrategyOrders(context)).toBe(1);
        const filled = context.strategy.opentrades[0];
        expect(filled.entry_price).toBe(97.02); // open 97 + 2 ticks, not stop 98.02
        expect(context.strategy.pending_orders).toHaveLength(0);
    });

    it('fills a marketable strategy.order short stop at the next open, then applies short slippage', () => {
        const context = makeContext({ slippage: 2 });
        order(context)({ id: 'S', direction: -1, qty: 1, stop: 102 }); // above close
        setBar(context, 103, 104, 101, 103);

        expect(processStrategyOrders(context)).toBe(1);
        const filled = context.strategy.opentrades[0];
        expect(filled.entry_price).toBe(102.98); // open 103 − 2 ticks, not stop 101.98
        expect(filled.size).toBe(-1);
        expect(context.strategy.pending_orders).toHaveLength(0);
    });

    it('keeps a genuinely intrabar LONG stop at its trigger before slippage', () => {
        const context = makeContext({ slippage: 2 });
        entry(context)('L', 'long', { stop: 102 }); // above the signal close
        setBar(context, 100, 103, 99, 101);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(102.02);
    });

    it('keeps a stop equal to the signal close as an ordinary crossing', () => {
        const context = makeContext({ slippage: 2 });
        entry(context)('L', 'long', { stop: 100 }); // equality is not marketable
        setBar(context, 99, 101, 98, 99);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(100.02);
    });
});
