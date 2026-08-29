import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, openTrade, processExitOrders, processStrategyOrders, roundToMintick } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { order } from '../../../src/namespaces/strategy/methods/order';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { Series } from '../../../src/Series';

/**
 * Mintick execution snap — focused constructed controls.
 *
 * Review findings (MintickReview HIGH/MEDIUM + LOW):
 *   1. On the proved STOCK surface, only MARKET fills and explicit OHLC-GAP
 *      fills at the open are recorded on the nearest mintick. An ordinary
 *      intrabar stop crossing keeps its TRIGGER level — an off-grid stop
 *      (strategy.order does not away-round at placement) must not be
 *      execution-snapped.
 *   2. Derived profit/loss levels round via roundToMintick only for a
 *      FINITE POSITIVE mintick; invalid metadata (0, NaN, ±Infinity) keeps
 *      the pre-change raw derived level — never a NaN from 0 × Infinity.
 *   3. The representation-preservation tolerance of the snap is bounded
 *      below half a tick: large genuinely off-grid values snap, only
 *      near-grid float noise is preserved; non-finite quotients/products
 *      return the original nominal price.
 *
 * The same rule is exercised on the EXIT path (processExitOrders): market
 * closes and OHLC-gap stop-loss fills snap; an intrabar stop-loss crossing
 * keeps its trigger level (the exit `gap` flag drives the decision).
 */
function makeContext(config: Record<string, unknown> = {}, type = 'stock') {
    const context: any = new Context({
        marketData: [],
        source: [],
        tickerId: 'STOCK',
        timeframe: 'D',
    } as any);
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine = { syminfo: { mintick: 0.01, pointvalue: 1, type } } as any;
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, ...config });
    return context;
}

function setBar(context: any, idx: number, open: number, high: number, low: number, close: number, openTime = idx * 86_400_000) {
    context.idx = idx;
    context.data.open = new Series([open, open]);
    context.data.high = new Series([high, high]);
    context.data.low = new Series([low, low]);
    context.data.close = new Series([close, close]);
    context.data.openTime = new Series([openTime, openTime]);
}

describe('stock execution snap — market and open-gap fills snap, intrabar stop crossings do not', () => {
    it('stock MARKET entry on an off-grid open snaps to the nearest mintick', () => {
        const context = makeContext();
        entry(context)('M', 'long'); // placed on bar 0, close 100
        setBar(context, 1, 101.037, 102, 100.5, 101.5);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(101.04); // nearest 0.01 tick, not 101.037
    });

    it('stock strategy.order MARKET on an off-grid open snaps too', () => {
        const context = makeContext();
        order(context)({ id: 'M', direction: 'long', qty: 1 });
        setBar(context, 1, 101.037, 102, 100.5, 101.5);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(101.04);
    });

    it('stock stop GAP-filled at an off-grid open snaps the open (never the trigger)', () => {
        const context = makeContext();
        entry(context)('L', 'long', { stop: 102 }); // on-grid trigger
        setBar(context, 1, 103.037, 104, 102.5, 103.5); // open already past the stop
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(103.04); // snapped open, not 102
    });

    it('stock stop GAP-filled at the open with slippage snaps AFTER slippage', () => {
        const context = makeContext({ slippage: 2 });
        context.pine = { syminfo: { mintick: 0.0001, pointvalue: 1, type: 'stock' } } as any;
        entry(context)('L', 'long', { stop: 1.2 });
        setBar(context, 1, 1.202, 1.21, 1.19, 1.205);
        expect(processStrategyOrders(context)).toBe(1);
        // open + 2×0.0001 = 1.2022, already on the 0.0001 grid → preserved.
        expect(context.strategy.opentrades[0].entry_price).toBe(1.2022);
    });

    it('stock stop INTRABAR crossing with an off-grid trigger keeps the trigger (review repro)', () => {
        // strategy.order does NOT away-round levels at placement: the raw
        // 102.003 reaches the fill path. Crossing intrabar (open 101 < stop,
        // high 103 >= stop) must fill at 102.003 — never snapped to 102.00.
        const context = makeContext();
        order(context)({ id: 'L', direction: 'long', qty: 1, stop: 102.003 }); // close 100
        setBar(context, 1, 101, 103, 100, 102);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(102.003);
    });

    it('stock stop INTRABAR crossing keeps an entry-form (already rounded) trigger', () => {
        const context = makeContext();
        entry(context)('L', 'long', { stop: 102.003 }); // away-rounded to 102.01 at placement
        setBar(context, 1, 101, 103, 100, 102);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(102.01); // trigger, unchanged by the execution snap
    });

    it('stock COF pass 0 (open tick) stop fill is a gap execution and snaps', () => {
        const context = makeContext({ calc_on_order_fills: true });
        entry(context)('L', 'long', { stop: 102 });
        setBar(context, 1, 100, 104, 96, 100);
        context.strategy._cof = { pass: 0, ticks: [103.037, 104, 96, 100] }; // open tick already past the stop
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(103.04); // snapped open tick
    });

    it('stock COF later-pass stop crossing fills at the trigger (not snapped)', () => {
        const context = makeContext({ calc_on_order_fills: true });
        entry(context)('L', 'long', { stop: 102 });
        setBar(context, 1, 100, 104, 96, 100);
        context.strategy._cof = { pass: 0, ticks: [100, 104, 96, 100] };
        expect(processStrategyOrders(context)).toBe(0); // pass 0: tick 100 < stop
        context.strategy._cof.pass = 1; // tick 104 crosses intrabar
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(102); // trigger, not snapped
    });

    it('stock marketable-at-submission stop fills at the open and snaps', () => {
        const context = makeContext();
        entry(context)('L', 'long', { stop: 98 }); // 98 < close 100 → marketable
        setBar(context, 1, 97.037, 99, 96, 98);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(97.04); // snapped next open
    });
    it('stock strategy.entry stop uses displayed OHLC for the trigger and reversal fill', () => {
        const run = (open: number, high: number) => {
            const context = makeContext();
            setBar(context, 0, 19.65, 19.65, 19.64, 19.65);
            openTrade(context, 'S', -1, 1, 19.64, 0);
            entry(context)('L', 'long', { stop: 19.66 });
            setBar(context, 1, open, high, 19.64, 19.65);
            return { context, fills: processStrategyOrders(context) };
        };

        // Below the displayed 19.66 threshold, the raw high must not trigger.
        const below = run(19.65, 19.6549);
        expect(below.fills).toBe(0);
        // At the displayed threshold, strategy.entry() reverses the short at
        // 19.66; the raw bar's high is already on that level.
        const atThreshold = run(19.65, 19.66);
        expect(atThreshold.fills).toBe(1);
        expect(atThreshold.context.strategy.closedtrades[0].exit_price).toBe(19.66);
        expect(atThreshold.context.strategy.opentrades[0].size).toBe(1);
        expect(atThreshold.context.strategy.opentrades[0].entry_price).toBe(19.66);

        // The replay's raw open/high pair (19.655) is displayed as 19.66;
        // retain the raw gap nominal and snap once after slippage.
        const replay = run(19.655, 19.655);
        expect(replay.fills).toBe(1);
        expect(replay.context.strategy.closedtrades[0].exit_price).toBe(19.66);
        expect(replay.context.strategy.opentrades[0].entry_price).toBe(19.66);
        // A half-tick raw high rounds up to the displayed trigger without
        // making the open a gap: the intrabar fill must remain at 19.66.
        const halfTick = run(19.6549, 19.655);
        expect(halfTick.fills).toBe(1);
        expect(halfTick.context.strategy.opentrades[0].entry_price).toBe(19.66);
    });

    it('NON-crypto/non-stock is unchanged: market open keeps its raw value', () => {
        const context = makeContext({}, 'forex');
        entry(context)('M', 'long');
        setBar(context, 1, 101.037, 102, 100.5, 101.5);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(101.037); // no snap on forex
    });

    it('NON-stock is unchanged: intrabar off-grid stop keeps its trigger', () => {
        const context = makeContext({}, 'crypto');
        order(context)({ id: 'L', direction: 'long', qty: 1, stop: 102.003 });
        setBar(context, 1, 101, 103, 100, 102);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(102.003);
    });

    it('LOW: a large genuinely off-grid value is snapped, not preserved by the magnitude epsilon', () => {
        const context = makeContext();
        entry(context)('M', 'long');
        // |price| 1e12 would give a 1e-12×1e12 = 1 magnitude epsilon — far past
        // half a 0.01 tick. The bounded tolerance snaps 0.005 off-grid.
        setBar(context, 1, 1000000000000.005, 1000000000000.01, 999999999999.99, 1000000000000.0);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(1000000000000.01);
    });

    it('LOW: a non-finite quotient returns the original nominal price', () => {
        const context = makeContext();
        context.pine = { syminfo: { mintick: 1e-308, pointvalue: 1, type: 'stock' } } as any;
        entry(context)('M', 'long');
        setBar(context, 1, 1e308, 1e308, 1e308 - 1, 1e308);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(1e308); // quotient 1e308/1e-308 = ∞ → original kept
    });

    it('stock market snap with a >100-decimal mintick fills the nearest tick without RangeError', () => {
        const context = makeContext();
        context.pine = { syminfo: { mintick: 1e-101, pointvalue: 1, type: 'stock' } } as any;
        entry(context)('M', 'long');
        setBar(context, 1, 1.5e-101, 2e-101, 1e-101, 1.5e-101); // 1.5 ticks off-grid → nearest = 2 ticks
        expect(processStrategyOrders(context)).toBe(1);
        const fill = context.strategy.opentrades[0].entry_price;
        expect(Number.isFinite(fill)).toBe(true);
        expect(fill).toBe(2e-101); // snapped product; toFixed(101) would RangeError — the guard must keep this finite
    });

    it('stock market snap preserves Math.round signed-zero (-0.005 / 0.01 → -0, never +0)', () => {
        const context = makeContext();
        entry(context)('M', 'long');
        setBar(context, 1, -0.005, 0.01, -0.01, -0.005); // -0.5 ticks → Math.round → -0
        expect(processStrategyOrders(context)).toBe(1);
        const fill = context.strategy.opentrades[0].entry_price;
        expect(Object.is(fill, -0)).toBe(true); // (-0).toFixed(2) would give "0.00" → +0; the -0 must survive
        expect(Object.is(fill, 0)).toBe(false);
    });

    it('stock exit MARKET close at an off-grid open snaps', () => {
        const context = makeContext();
        entry(context)('M', 'long'); // fills bar 1 at the open
        setBar(context, 1, 101.037, 102, 100.5, 101.5);
        expect(processStrategyOrders(context)).toBe(1);
        context.strategy.pending_orders.push({
            id: 'close', direction: 0, qty: 0, type: 'market', category: 'exit',
            from_entry: '', status: 'pending', bar: 1, time: 86_400_000,
        });
        setBar(context, 2, 103.037, 104, 102.5, 103.5); // pure market exit fills at this open
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy.closedtrades[0].exit_price).toBe(103.04); // snapped open, not 103.037
    });

    it('stock exit stop-loss GAP-filled at an off-grid open snaps the open', () => {
        const context = makeContext();
        entry(context)('M', 'long');
        setBar(context, 1, 101.037, 102, 100.5, 101.5);
        expect(processStrategyOrders(context)).toBe(1);
        context.strategy.pending_orders.push({
            id: 'sl', direction: 0, qty: 0, type: 'market', category: 'exit',
            from_entry: '', stop: 97.003, status: 'pending', bar: 1, time: 86_400_000,
        });
        setBar(context, 2, 96.963, 97.5, 96, 96.5); // open already below the stop → gap fill at the open
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy.closedtrades[0].exit_price).toBe(96.96); // snapped open (96.963 → 96.96), not the trigger
    });

    it('stock exit stop-loss INTRABAR crossing keeps the off-grid trigger (not snapped)', () => {
        const context = makeContext();
        entry(context)('M', 'long');
        setBar(context, 1, 101.037, 102, 100.5, 101.5);
        expect(processStrategyOrders(context)).toBe(1);
        context.strategy.pending_orders.push({
            id: 'sl', direction: 0, qty: 0, type: 'market', category: 'exit',
            from_entry: '', stop: 97.003, status: 'pending', bar: 1, time: 86_400_000,
        });
        setBar(context, 2, 98, 99, 97, 97.5); // open above the stop, low crosses intrabar → fill at the trigger
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy.closedtrades[0].exit_price).toBe(97.003); // trigger kept, never snapped to 97.00
    });
    it('stock COF market entries use the displayed bar open, not the next path extreme', () => {
        const context = makeContext({ calc_on_order_fills: true });
        setBar(context, 1, 101.037, 102, 100.5, 101.5);
        context.strategy._cof = { pass: 1, ticks: [101.037, 100.5, 102, 101.5] };
        entry(context)('M', 'long');
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(101.04);
    });

    it('stock absolute exits round against the open position average', () => {
        const context = makeContext();
        setBar(context, 1, 22.55370718, 22.6, 22.5, 22.55370718);
        context.strategy.position_size = 1;
        context.strategy.position_avg_price = 22.325;
        exit(context)('TP', { limit: 22.54825 });
        const pending = context.strategy.pending_orders.find((order: any) => order.id === 'TP');
        expect(pending?.limit).toBe(22.55);
    });

    it('stock exit triggers use displayed OHLC before filling at the rounded level', () => {
        const context = makeContext();
        context.pine.syminfo = { mintick: 0.005, pointvalue: 1, type: 'stock' } as any;
        setBar(context, 0, 23.485, 23.485, 23.485, 23.485);
        openTrade(context, 'S', -1, 1, 23.485, 0);
        exit(context)('SL', { stop: 23.602425 });
        setBar(context, 1, 23.485, 23.60312359, 23.49818251, 23.59875128);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy.closedtrades[0].exit_price).toBe(23.605);
    });
});

describe('invalid mintick — derived profit/loss levels stay finite, pre-change raw', () => {
    it('roundToMintick passes through non-finite mintick (review repro: Infinity => NaN)', () => {
        expect(roundToMintick(1, 0, Infinity)).toBe(1); // before: 0 × ∞ → NaN
        expect(roundToMintick(1, 0, NaN)).toBe(1);
        expect(roundToMintick(123, 100, 0)).toBe(123);
        expect(Number.isNaN(roundToMintick(NaN, 100, 0.01))).toBe(true); // NaN price still passes through
    });

    it('derived TP from profit points with invalid mintick (0) stays the raw entry level — no NaN', () => {
        const context = makeContext();
        context.pine = { syminfo: { mintick: 0, pointvalue: 1, type: 'stock' } } as any;
        entry(context)('L', 'long'); // market, fills bar 1 at the open
        setBar(context, 1, 101.037, 102, 100, 101.5);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(101.037); // mintick 0 → snap is a no-op too
        exit(context)('x', { profit: 10 }); // derived TP = entry + 10×0 = entry
        setBar(context, 2, 100, 102, 99, 101); // open below entry → intrabar TP crossing
        expect(processExitOrders(context)).toBe(1);
        const closed = context.strategy.closedtrades[0];
        expect(Number.isFinite(closed.exit_price)).toBe(true);
        expect(closed.exit_price).toBe(101.037); // pre-change raw derived level (entry ± 0), never NaN
    });
});
