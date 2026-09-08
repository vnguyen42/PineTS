import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { Series } from '../../../src/Series';

// VIN-161, real UNI 2841: the former pre-snap gate compensated for a
// missing 0.001 quantity step. All ten previously restored TV entries
// fit at the snapped price once their actual quantities are used.
// 2021-01-18: capital 125.6307663, qty 13.766, 9.1256 -> 9.126.
// The original UNI admission probe rejects 2020-10-04: qty 27.378 at
// snapped 3.653 costs 100.011834, exceeding capital 100.
function makeContext(capital = 125.6307663, margin = 100) {
    const context = new Context({ marketData: [], source: [], tickerId: 'BINANCE:UNIUSDT', timeframe: '240' });
    context.idx = 0;
    context.pine = { qtyStep: 0.001, syminfo: { mintick: 0.001, pointvalue: 1, type: 'crypto' } };
    initializeStrategy(context, {
        initial_capital: capital, margin_long: margin, margin_short: margin, process_orders_on_close: true,
    });
    return context;
}
function setBar(context: Context, index: number, price: number) {
    context.idx = index;
    for (const field of ['open', 'high', 'low', 'close']) context.data[field] = new Series([price, price]);
    context.data.openTime = new Series([index * 14_400_000, index * 14_400_000]);
}

describe('VIN-161 margin admission at the execution price with a known quantity step', () => {
    it('rejects the real UNI order whose rounded notional exceeds capital', () => {
        const context = makeContext(100);
        setBar(context, 1, 3.6525);
        entry(context)('S', 'short', 1 / (3.6525 * 0.01));
        expect(context.strategy.pending_orders[0].qty).toBeCloseTo(27.378, 9);
        expect(processStrategyOrders(context, 'close')).toBe(0);
        expect(context.strategy.opentrades).toHaveLength(0);
        expect(context.strategy.pending_orders).toHaveLength(0);
    });

    it.each(['open', 'close'] as const)('preserves a real restored entry in the %s phase', (phase) => {
        const context = makeContext();
        setBar(context, 0, 9.1256);
        entry(context)('L', 'long', 125.6307663 / 9.1256);
        if (phase === 'open') setBar(context, 1, 9.1256);
        expect(processStrategyOrders(context, phase === 'close' ? 'close' : 'intrabar')).toBe(1);
        expect(context.strategy.opentrades[0].size).toBeCloseTo(13.766, 9);
        expect(context.strategy.opentrades[0].entry_price).toBe(9.126);
    });

    it('still rejects an order exceeding capital before and after price rounding', () => {
        const context = makeContext(100);
        setBar(context, 1, 9.1256);
        entry(context)('L', 'long', 11);
        expect(processStrategyOrders(context, 'close')).toBe(0);
        expect(context.strategy.opentrades).toHaveLength(0);
    });

    it('keeps margin zero unrestricted', () => {
        const context = makeContext(100, 0);
        setBar(context, 1, 3.6525);
        entry(context)('S', 'short', 1 / (3.6525 * 0.01));
        expect(processStrategyOrders(context, 'close')).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(3.653);
    });
});
