import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import {
    calculateOrderQty,
    initializeStrategy,
    processStrategyOrders,
} from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { order } from '../../../src/namespaces/strategy/methods/order';

type StrategyContext = Context & { strategy: NonNullable<Context['strategy']> };

function assertStrategy(context: Context): asserts context is StrategyContext {
    if (!context.strategy) throw new Error('strategy test context was not initialized');
}

function makeContext(config: Record<string, unknown> = {}): StrategyContext {
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
    context.pine.syminfo = { mintick: 0.01, pointvalue: 1 };
    initializeStrategy(context, {
        default_qty_type: 'fixed',
        default_qty_value: 1,
        ...config,
    });
    assertStrategy(context);
    return context;
}

describe('strategy percent_of_equity quantity sizing (VIN-89)', () => {
    it('uses the five-decimal truncation boundary for exact, above, below, and fractional values', () => {
        const exact = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 10 });
        exact.strategy.equity = 1000;
        expect(calculateOrderQty(exact, undefined, 1, 25)).toBe(4);

        const justAbove = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 100 });
        justAbove.strategy.equity = 123.4561;
        expect(calculateOrderQty(justAbove, undefined, 1, 100)).toBe(1.23456);

        const justBelow = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 100 });
        justBelow.strategy.equity = 123.4559;
        expect(calculateOrderQty(justBelow, undefined, 1, 100)).toBe(1.23455);

        const fractional = makeContext({
            default_qty_type: 'percent_of_equity',
            default_qty_value: 37.5,
            commission_type: 'percent',
            commission_value: 0.11,
        });
        fractional.strategy.equity = 10000;
        expect(calculateOrderQty(fractional, undefined, 1, 83.17)).toBe(45.03883);
    });

    it('does not reserve anything when percent commission is zero', () => {
        const context = makeContext({
            default_qty_type: 'percent_of_equity',
            default_qty_value: 10,
            commission_type: 'percent',
            commission_value: 0,
        });
        context.strategy.equity = 1000;
        expect(calculateOrderQty(context, undefined, 1, 83.17)).toBe(1.20235);
    });

    it('uses the signal close for market orders and the declared stop/limit level for price orders', () => {
        const market = makeContext({
            default_qty_type: 'percent_of_equity',
            default_qty_value: 10,
            commission_type: 'percent',
            commission_value: 0.02,
        });
        market.strategy.equity = 10000;
        entry(market)('market', 'long');
        expect(market.strategy.pending_orders[0].qty).toBe(9.998);

        const stop = makeContext({
            default_qty_type: 'percent_of_equity',
            default_qty_value: 10,
            commission_type: 'percent',
            commission_value: 0.02,
        });
        stop.strategy.equity = 10000;
        entry(stop)('stop', 'long', { stop: 120 });
        expect(stop.strategy.pending_orders[0].qty).toBe(8.33166);

        const limit = makeContext({
            default_qty_type: 'percent_of_equity',
            default_qty_value: 10,
            commission_type: 'percent',
            commission_value: 0.02,
        });
        limit.strategy.equity = 10000;
        entry(limit)('limit', 'long', { limit: 80 });
        expect(limit.strategy.pending_orders[0].qty).toBe(12.4975);
    });

    it('keeps fixed and cash quantities on the six-decimal path', () => {
        const fixed = makeContext({ default_qty_type: 'fixed', default_qty_value: 1.23456789 });
        fixed.strategy.equity = 1000;
        expect(calculateOrderQty(fixed, undefined, 1, 100)).toBe(1.234567);

        const cash = makeContext({ default_qty_type: 'cash', default_qty_value: 123.456789 });
        cash.strategy.equity = 1000;
        expect(calculateOrderQty(cash, undefined, 1, 7.89)).toBe(15.647248);
    });
});

describe('strategy percent_of_equity quantity sizing with calc_on_order_fills', () => {
    it('recomputes the fill quantity with the same reserve and five-decimal formula', () => {
        const context = makeContext({
            initial_capital: 10000,
            calc_on_order_fills: true,
            default_qty_type: 'percent_of_equity',
            default_qty_value: 10,
            commission_type: 'percent',
            commission_value: 0.02,
        });
        context.strategy.equity = 10000;
        entry(context)('L', 'long');
        expect(context.strategy.pending_orders[0].qty).toBe(9.998);

        context.idx = 1;
        context.data.open = new Series([100, 120]);
        context.data.high = new Series([101, 121]);
        context.data.low = new Series([99, 119]);
        context.data.close = new Series([100, 120]);
        context.data.openTime = new Series([0, 86_400_000]);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].size).toBe(8.33166);
    });
});

describe('strategy qty=0 orders are never submitted (VIN-103)', () => {
    it('minimal repro: percent_of_equity sizing that truncates to 0 leaves NO pending order and NO zero-size lot', () => {
        const context = makeContext({
            initial_capital: 100,
            calc_on_order_fills: true,
            default_qty_type: 'percent_of_equity',
            default_qty_value: 0.000001,
        });
        // equity 100 × 0.000001% = 1e-6 → qty = 1e-6 / 100 ≈ 1e-8 →
        // five-decimal truncation → 0.
        entry(context)('L', 'long');
        expect(context.strategy.pending_orders).toHaveLength(0);

        // No pending order survives to the fill phase either.
        context.idx = 1;
        context.data.open = new Series([100, 100]);
        context.data.high = new Series([101, 101]);
        context.data.low = new Series([99, 99]);
        context.data.close = new Series([100, 100]);
        context.data.openTime = new Series([0, 86_400_000]);
        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.opentrades).toHaveLength(0);
        expect(context.strategy.position_size).toBe(0);
    });

    it('an explicit qty=0 entry is refused the same way (strategy.entry and strategy.order)', () => {
        const context = makeContext();
        entry(context)('L', 'long', { qty: 0 });
        expect(context.strategy.pending_orders).toHaveLength(0);

        const orderContext = makeContext();
        orderContext.strategy.pending_orders = [];
        order(orderContext)('O', 'long', { qty: 0 });
        expect(orderContext.strategy.pending_orders).toHaveLength(0);
    });

    it('a COF percent_of_equity RESIZE that shrinks the fill qty to 0 cancels the order instead of opening a zero-size lot', () => {
        const context = makeContext({
            initial_capital: 10000,
            calc_on_order_fills: true,
            default_qty_type: 'percent_of_equity',
            default_qty_value: 10,
        });
        // Placement-time qty > 0 (equity 10000 at close 100).
        entry(context)('L', 'long');
        expect(context.strategy.pending_orders[0].qty).toBe(10);

        // By fill time the account has collapsed (realized losses) so the
        // five-decimal equity sizing truncates to 0: equity = 10000 +
        // netprofit(-9999.995) = 0.005 → baseQty = floor5(0.005×10% / 100)
        // = 0. TV books no such fill; the order must be cancelled, not
        // opened as a size-0 lot.
        context.idx = 1;
        context.data.open = new Series([100, 100]);
        context.data.high = new Series([101, 101]);
        context.data.low = new Series([99, 99]);
        context.data.close = new Series([100, 100]);
        context.data.openTime = new Series([0, 86_400_000]);
        context.strategy.netprofit = -9999.995;

        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.opentrades).toHaveLength(0);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.pending_orders).toHaveLength(0);
    });
});
