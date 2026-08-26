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
import { default_entry_qty } from '../../../src/namespaces/strategy/methods/default_entry_qty';

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

describe('strategy percent_of_equity provider qty-step truncation (VIN-95)', () => {
    it('qtyStep=1: sub-one percent legs quantize to 0, at-step legs truncate down', () => {
        const context = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 10 });
        context.pine.qtyStep = 1;
        context.strategy.equity = 1000;
        // 10% of 1000 = 100 → exactly 1 share at price 100 → unchanged.
        expect(calculateOrderQty(context, undefined, 1, 100)).toBe(1);
        // 100 / 250 = 0.4 share → quantizes to 0.
        expect(calculateOrderQty(context, undefined, 1, 250)).toBe(0);
        // 100 / 60 = 1.66 shares → truncates to the step.
        expect(calculateOrderQty(context, undefined, 1, 60)).toBe(1);
    });

    it('qtyStep=0.5 truncates to half-share multiples', () => {
        const context = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 37.5, commission_type: 'percent', commission_value: 0.11 });
        context.pine.qtyStep = 0.5;
        context.strategy.equity = 10000;
        // 3750 / (83.17 × 1.0011) = 45.0438… → floor(90.0877)/2 = 45.
        expect(calculateOrderQty(context, undefined, 1, 83.17)).toBe(45);
    });
    it('snaps exact decimal step boundaries, floors genuine sub-step values, and handles large quantities', () => {
        const exact = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 10 });
        exact.pine.qtyStep = 0.1;
        exact.strategy.equity = 300;
        // 30 / 100 = 0.3; the quotient 0.3 / 0.1 is just below 3 in binary.
        expect(calculateOrderQty(exact, undefined, 1, 100)).toBeCloseTo(0.3, 12);

        const genuinelyBelow = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 10 });
        genuinelyBelow.pine.qtyStep = 0.1;
        genuinelyBelow.strategy.equity = 299.99999;
        // 0.29999999 is materially below the 0.3 boundary, so it still floors.
        expect(calculateOrderQty(genuinelyBelow, undefined, 1, 100)).toBe(0.2);

        const large = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 100 });
        large.pine.qtyStep = 0.001;
        large.strategy.equity = 123_456_789;
        // 1,234,567.89 / 0.001 is represented just below its integer quotient
        // (error 2.38e-7 ≤ EPSILON·1.23e9 = 2.74e-7) and must snap.
        expect(calculateOrderQty(large, undefined, 1, 100)).toBeCloseTo(1_234_567.89, 8);

        const cash = makeContext({ default_qty_type: 'cash', default_qty_value: 0.3 });
        cash.pine.qtyStep = 0.1;
        // Cash shares the helper: 0.3 / 1 must not lose a tenth.
        expect(calculateOrderQty(cash, undefined, 1, 1)).toBeCloseTo(0.3, 12);
    });

    it('snaps the 1.2 / 0.1 representation error (4 ulps at 12) but floors at ULP scale only', () => {
        const twelve = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 10 });
        twelve.pine.qtyStep = 0.1;
        twelve.strategy.equity = 1200;
        // 120 / 100 = 1.2; the quotient 1.2 / 0.1 is 11.999999999999998
        // (error 1.78e-15 = 8·EPSILON ≤ 12·EPSILON = tolerance) → 12 steps.
        expect(calculateOrderQty(twelve, undefined, 1, 100)).toBeCloseTo(1.2, 12);

        // A large-magnitude value materially below an integer must FLOOR:
        // 1,000,000,000.9995 is 5e-4 below 1,000,000,001 — far beyond ULP
        // scale (EPSILON·1e9 ≈ 2.2e-7). The old 1e-12-relative tolerance
        // (1e-3 at this magnitude) snapped it UP to 1,000,000,001 and booked
        // one extra share; TV truncates at 1,000,000,000.
        const largeBelow = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 100 });
        largeBelow.pine.qtyStep = 1;
        largeBelow.strategy.equity = 100_000_000_099.95;
        expect(calculateOrderQty(largeBelow, undefined, 1, 100)).toBe(1_000_000_000);

        // Mid-scale immediately-below ordinary value still floors (5e-7 below
        // 1000, tolerance at that magnitude ≈ 2.2e-13).
        const nearBelow = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 100 });
        nearBelow.pine.qtyStep = 1;
        nearBelow.strategy.equity = 99_999.99995;
        expect(calculateOrderQty(nearBelow, undefined, 1, 100)).toBe(999);
    });

    it('is overflow/invalid safe: bad steps and non-finite quotients fall through to the generic precision path', () => {
        // Invalid step (0, negative, NaN) → helper returns undefined → the
        // five-decimal equity quantum applies unchanged (0.3 stays 0.3).
        for (const badStep of [0, -1, NaN]) {
            const context = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 10 });
            context.pine.qtyStep = badStep;
            context.strategy.equity = 300;
            expect(calculateOrderQty(context, undefined, 1, 100)).toBe(0.3);
        }

        // Quotient overflow: 1e300 / 1e-309 = Infinity → helper returns
        // undefined → the generic six-decimal truncation passes 1e300 through
        // (pre-existing path), never a fabricated stepped quantity.
        const overflow = makeContext({ default_qty_type: 'cash', default_qty_value: 1e300 });
        overflow.pine.qtyStep = 1e-309;
        expect(calculateOrderQty(overflow, undefined, 1, 1)).toBe(1e300);

        // Non-finite raw quantity → helper returns undefined → generic path
        // preserves NaN (no crash, no fabricated step). Equity is assigned
        // directly (config defaults coerce NaN → 1, so this bypasses that).
        const invalid = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 10 });
        invalid.pine.qtyStep = 1;
        invalid.strategy.equity = NaN;
        expect(calculateOrderQty(invalid, undefined, 1, 100)).toBeNaN();
    });

    it('COF reversal with a fill-time quantized-zero base cancels without closing the position', () => {
        const context = makeContext({
            initial_capital: 1000,
            calc_on_order_fills: true,
            default_qty_type: 'percent_of_equity',
            default_qty_value: 10,
        });
        context.pine.qtyStep = 1;
        context.strategy.equity = 1000;

        // Placement at 100: 10% of 1000 is one share.
        entry(context)('L', 'long');
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.position_size).toBe(1);

        // Queue the opposite default-percent entry at the same 100 close:
        // total order qty is 1 close leg + 1 requested base leg.
        entry(context)('S', 'short');
        expect(context.strategy.pending_orders[0].qty).toBe(2);

        // At the next fill the price doubles, so the recalculated base is
        // 0.5 share and quantizes to zero. The entire reversal must cancel.
        context.idx = 1;
        context.data.open = new Series([100, 200]);
        context.data.high = new Series([101, 201]);
        context.data.low = new Series([99, 199]);
        context.data.close = new Series([100, 200]);
        context.data.openTime = new Series([0, 86_400_000]);

        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.closedtrades).toHaveLength(0);
        expect(context.strategy.pending_orders).toHaveLength(0);
    });
    it('keeps positive-base and explicit-qty reversals intact', () => {
        const positiveBase = makeContext({
            initial_capital: 1000,
            calc_on_order_fills: true,
            default_qty_type: 'percent_of_equity',
            default_qty_value: 10,
        });
        positiveBase.pine.qtyStep = 1;
        positiveBase.strategy.equity = 1000;
        entry(positiveBase)('L', 'long');
        expect(processStrategyOrders(positiveBase)).toBe(1);
        entry(positiveBase)('S', 'short');
        positiveBase.idx = 1;
        positiveBase.data.open = new Series([100, 100]);
        positiveBase.data.high = new Series([101, 101]);
        positiveBase.data.low = new Series([99, 99]);
        positiveBase.data.close = new Series([100, 100]);
        positiveBase.data.openTime = new Series([0, 86_400_000]);
        expect(processStrategyOrders(positiveBase)).toBe(1);
        expect(positiveBase.strategy.position_size).toBe(-1);
        expect(positiveBase.strategy.closedtrades).toHaveLength(1);

        const explicitQty = makeContext({
            initial_capital: 1000,
            calc_on_order_fills: true,
            default_qty_type: 'percent_of_equity',
            default_qty_value: 10,
        });
        explicitQty.pine.qtyStep = 1;
        explicitQty.strategy.equity = 1000;
        entry(explicitQty)('L', 'long');
        expect(processStrategyOrders(explicitQty)).toBe(1);
        entry(explicitQty)('S', 'short', { qty: 1 });
        explicitQty.idx = 1;
        explicitQty.data.open = new Series([100, 200]);
        explicitQty.data.high = new Series([101, 201]);
        explicitQty.data.low = new Series([99, 199]);
        explicitQty.data.close = new Series([100, 200]);
        explicitQty.data.openTime = new Series([0, 86_400_000]);
        expect(processStrategyOrders(explicitQty)).toBe(1);
        expect(explicitQty.strategy.position_size).toBe(-1);
        expect(explicitQty.strategy.closedtrades).toHaveLength(1);
    });



    it('quantized zero creates no order and no fill (entry submission)', () => {
        const context = makeContext({
            initial_capital: 1000,
            calc_on_order_fills: true,
            default_qty_type: 'percent_of_equity',
            default_qty_value: 0.5,
        });
        context.pine.qtyStep = 1;
        context.strategy.equity = 1000;
        // 0.5% of 1000 = 5 → 5 / 100 (close) = 0.05 share → quantizes to 0.
        entry(context)('L', 'long');
        expect(context.strategy.pending_orders).toHaveLength(0);

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

    it('COF fill-time resize applies the same qty-step truncation', () => {
        const context = makeContext({
            initial_capital: 10000,
            calc_on_order_fills: true,
            default_qty_type: 'percent_of_equity',
            default_qty_value: 10,
            commission_type: 'percent',
            commission_value: 0.02,
        });
        context.pine.qtyStep = 1;
        context.strategy.equity = 10000;
        entry(context)('L', 'long');
        // Placement: 10% of 10000 = 1000 / (100 × 1.0002) = 9.998 → qtyStep 1 → 9.
        expect(context.strategy.pending_orders[0].qty).toBe(9);

        context.idx = 1;
        context.data.open = new Series([100, 120]);
        context.data.high = new Series([101, 121]);
        context.data.low = new Series([99, 119]);
        context.data.close = new Series([100, 120]);
        context.data.openTime = new Series([0, 86_400_000]);

        // Fill-time resize: 10% of 10000 = 1000 / 120 = 8.33 shares → 8.
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].size).toBe(8);
    });

    it('missing qtyStep keeps fractional percent sizing; cash/fixed semantics unchanged', () => {
        // No qtyStep on the context → the five-decimal equity quantum applies.
        const percent = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 10 });
        percent.strategy.equity = 1000;
        expect(calculateOrderQty(percent, undefined, 1, 250)).toBe(0.4);

        // cash already truncates at the provider step (pre-existing VIN-113).
        const cash = makeContext({ default_qty_type: 'cash', default_qty_value: 123.456789 });
        cash.pine.qtyStep = 1;
        cash.strategy.equity = 1000;
        expect(calculateOrderQty(cash, undefined, 1, 7.89)).toBe(15);

        // fixed stays on the six-decimal path regardless of qtyStep.
        const fixed = makeContext({ default_qty_type: 'fixed', default_qty_value: 1.23456789 });
        fixed.pine.qtyStep = 1;
        fixed.strategy.equity = 1000;
        expect(calculateOrderQty(fixed, undefined, 1, 100)).toBe(1.234567);
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
describe('strategy percent_of_equity stock displayed-price sizing (VIN-130)', () => {
    it('uses nearest display prices for discriminants, half-ticks, and grid-noise cases', () => {
        const cases = [
            { price: 0.07, mintick: 0.01, equity: 100, qtyStep: undefined, expectedQty: 1428.57142 },
            { price: 0.07000000000000001, mintick: 0.01, equity: 100, qtyStep: undefined, expectedQty: 1428.57142 },
            { price: 0.1 - 9 * 0.01, mintick: 0.01, equity: 100, qtyStep: undefined, expectedQty: 10000 },
            // At 13.665, nearest display pricing gives 860 shares; the
            // order-level away rounding would instead produce 859.
            { price: 13.665, mintick: 0.01, equity: 11750, qtyStep: 1, expectedQty: 860 },
            { price: 20.833, mintick: 0.01, equity: 100, qtyStep: undefined, expectedQty: 4.80076 },
            { price: 20.835, mintick: 0.01, equity: 100, qtyStep: undefined, expectedQty: 4.79846 },
            { price: 7.945, mintick: 0.01, equity: 100, qtyStep: undefined, expectedQty: 12.57861 },
            { price: 5.435, mintick: 0.01, equity: 100, qtyStep: undefined, expectedQty: 18.38235 },
        ] as const;

        for (const { price, mintick, equity, qtyStep, expectedQty } of cases) {
            const context = makeContext({
                default_qty_type: 'percent_of_equity',
                default_qty_value: 100,
            });
            context.pine.syminfo = { mintick, pointvalue: 1, type: 'stock' };
            context.pine.qtyStep = qtyStep;
            context.strategy.equity = equity;
            expect(calculateOrderQty(context, undefined, 1, price)).toBe(expectedQty);
        }
    });

    it('revalues an open stock lot at the snapped sizing price', () => {
        const context = makeContext({
            default_qty_type: 'percent_of_equity',
            default_qty_value: 100,
        });
        context.pine.syminfo = { mintick: 0.01, pointvalue: 1, type: 'stock' };
        context.strategy.initial_capital = 1000;
        context.strategy.netprofit = 0;
        context.strategy.openprofit = 1;
        context.strategy.equity = 1001;
        context.strategy.opentrades = [{
            id: 'lot',
            entry_id: 'L',
            entry_price: 100,
            entry_bar_index: 0,
            entry_time: 0,
            size: 1,
            commission: 0,
            max_drawdown: 0,
            max_runup: 0,
            status: 'open',
        }];

        // Raw 101.003 snaps to the nearest displayed tick, 101.00, so the
        // open lot contributes 1.00 rather than the raw-marked 1.003 to the
        // sizing equity.
        expect(calculateOrderQty(context, undefined, 1, 101.003)).toBe(9.91089);
    });
});

describe('strategy percent_of_equity pointvalue sizing (VIN-2205)', () => {
    it('divides the futures notional by syminfo.pointvalue: CL1! 1,000,000 / (74.23 × 1000) → 13 contracts', () => {
        const cl1 = makeContext({
            initial_capital: 1_000_000,
            default_qty_type: 'percent_of_equity',
            default_qty_value: 100,
        });
        // NYMEX:CL1! — syminfo.pointvalue=1000 resolved from the capture DB.
        cl1.pine.syminfo = { mintick: 0.01, pointvalue: 1000 };
        // fractional=false → integer contracts (proven from raw WS).
        cl1.pine.qtyStep = 1;
        cl1.strategy.equity = 1_000_000;
        // floor(1_000_000 / (74.23 × 1000)) = 13 — TV's quantity; omitting
        // the multiplier books 13,471 contracts and a −8,756,150 loss.
        expect(calculateOrderQty(cl1, undefined, 1, 74.23)).toBe(13);

        // Same pointvalue notional through the five-decimal equity quantum
        // when the provider supplies no qty step: 13.471641… → 13.47164.
        const noStep = makeContext({
            default_qty_type: 'percent_of_equity',
            default_qty_value: 100,
        });
        noStep.pine.syminfo = { mintick: 0.01, pointvalue: 1000 };
        noStep.strategy.equity = 1_000_000;
        expect(calculateOrderQty(noStep, undefined, 1, 74.23)).toBe(13.47164);
    });

    it('shares the pointvalue notional across placement, COF fill resize, and strategy.default_entry_qty', () => {
        const context = makeContext({
            initial_capital: 1_000_000,
            calc_on_order_fills: true,
            default_qty_type: 'percent_of_equity',
            default_qty_value: 100,
        });
        context.pine.syminfo = { mintick: 0.01, pointvalue: 1000 };
        context.pine.qtyStep = 1;
        context.strategy.equity = 1_000_000;

        // Placement at the signal close: floor(1_000_000 / (100 × 1000)) = 10.
        entry(context)('L', 'long');
        expect(context.strategy.pending_orders[0].qty).toBe(10);
        // strategy.default_entry_qty resolves the same pointvalue notional.
        expect(default_entry_qty(context)(100)).toBe(10);

        // COF fill at 125: floor(1_000_000 / (125 × 1000)) = 8 — the fill
        // resize re-derives at fill-time equity and fill price through the
        // same central calculation.
        context.idx = 1;
        context.data.open = new Series([100, 125]);
        context.data.high = new Series([101, 126]);
        context.data.low = new Series([99, 124]);
        context.data.close = new Series([100, 125]);
        context.data.openTime = new Series([0, 86_400_000]);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].size).toBe(8);
        expect(context.strategy.position_size).toBe(8);
    });

    it('leaves pointvalue-1 instruments (stocks/crypto) on the established notional', () => {
        const pv1 = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 10 });
        pv1.strategy.equity = 1000;
        expect(calculateOrderQty(pv1, undefined, 1, 25)).toBe(4);

        // Same equity at pointvalue 1000 now sizes 1/1000th of the notional.
        const pv1000 = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 10 });
        pv1000.pine.syminfo = { mintick: 0.01, pointvalue: 1000 };
        pv1000.strategy.equity = 1000;
        expect(calculateOrderQty(pv1000, undefined, 1, 25)).toBe(0.004);
    });

    it('keeps explicit, fixed, and cash quantities free of the pointvalue factor', () => {
        const explicit = makeContext({ default_qty_type: 'fixed', default_qty_value: 1 });
        explicit.pine.syminfo = { mintick: 0.01, pointvalue: 1000 };
        expect(calculateOrderQty(explicit, 1.23456789, 1, 100)).toBe(1.234567);

        const fixed = makeContext({ default_qty_type: 'fixed', default_qty_value: 1.23456789 });
        fixed.pine.syminfo = { mintick: 0.01, pointvalue: 1000 };
        fixed.strategy.equity = 1000;
        expect(calculateOrderQty(fixed, undefined, 1, 100)).toBe(1.234567);

        const cash = makeContext({ default_qty_type: 'cash', default_qty_value: 123.456789 });
        cash.pine.syminfo = { mintick: 0.01, pointvalue: 1000 };
        cash.strategy.equity = 1000;
        expect(calculateOrderQty(cash, undefined, 1, 7.89)).toBe(15.647248);
    });
});
