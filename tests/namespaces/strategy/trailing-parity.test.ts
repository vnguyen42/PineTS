import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { StrategyState } from '../../../src/namespaces/strategy/types';
import { processExitOrders } from '../../../src/namespaces/strategy/utils';
function createTrailingContext({
    open,
    high,
    low,
    close,
    mintick = 1,
    trailPeak = 110,
    trailOffset = 5,
    direction = 'long',
    trailPrice,
    trailArmed = true,
}: {
    open: number;
    high: number;
    low: number;
    close: number;
    mintick?: number;
    trailPeak?: number;
    trailOffset?: number;
    direction?: 'long' | 'short';
    trailPrice?: number;
    trailArmed?: boolean;
}) {
    const isLong = direction === 'long';
    const entryId = isLong ? 'buy' : 'sell';
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'BTCUSDC',
        timeframe: 'D',
    });
    context.idx = 1;

    context.data.open = new Series([100, open]);
    context.data.high = new Series([110, high]);
    context.data.low = new Series([99, low]);
    context.data.close = new Series([110, close]);
    context.data.openTime = new Series([0, 1000]);

    const strategy: StrategyState = {
        config: {
            title: 'Test Strategy',
            overlay: true,
        },
        opentrades: [
            {
                id: 'trade_1',
                entry_id: entryId,
                entry_price: 100,
                entry_bar_index: 0,
                entry_time: 0,
                size: isLong ? 1 : -1,
                status: 'open',
            },
        ],
        closedtrades: [],
        pending_orders: [
            {
                id: 'exit_1',
                direction: isLong ? -1 : 1,
                qty: 1,
                type: 'stop',
                category: 'exit',
                from_entry: entryId,
                trail_points: trailPrice === undefined ? 10 : undefined,
                trail_price: trailPrice,
                trail_offset: trailOffset,
                trail_peak: trailArmed ? trailPeak : NaN,
                trail_armed: trailArmed,
                status: 'pending',
                bar: 0,
                time: 0,
            },
        ],
        position_size: isLong ? 1 : -1,
        position_avg_price: 100,
        position_entry_name: entryId,
        initial_capital: 10000,
        account_currency: 'USD',
        equity: 10000,
        netprofit: 0,
        grossprofit: 0,
        grossloss: 0,
        openprofit: 0,
        max_drawdown: 0,
        max_runup: 0,
        equity_peak: 10000,
        equity_trough: 10000,
        equity_at_runup_peak: 10000,
        equity_at_drawdown_peak: 10000,
        max_drawdown_percent_value: 0,
        max_runup_percent_value: 0,
        wintrades: 0,
        losstrades: 0,
        eventrades: 0,
        wintrades_total_profit: 0,
        max_contracts_held_all: 1,
        max_contracts_held_long: isLong ? 1 : 0,
        max_contracts_held_short: isLong ? 0 : 1,
        risk_rules: {},
        risk_halted: false,
    };

    context.strategy = strategy;
    context.pine = {
        syminfo: {
            mintick,
        },
    } as any;

    return {
        context,
        order: strategy.pending_orders[0],
        strategy,
    };
}

describe('Strategy - Trailing Stop Price Path Parity', () => {
    it('keeps an adverse-first long trail pending when segment 1 misses the old trigger and segment 3 misses the new trigger', () => {
        const { context, order, strategy } = createTrailingContext({
            open: 108,
            high: 120,
            low: 106,
            close: 118,
        });

        processExitOrders(context);

        expect(order.status).toBe('pending');
        expect(order.trail_peak).toBe(120);
        expect(strategy.closedtrades).toHaveLength(0);
    });

    it('fills an adverse-first long trail at the updated trigger when segment 3 crosses it', () => {
        const { context, order, strategy } = createTrailingContext({
            open: 108,
            high: 120,
            low: 106,
            close: 110,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(115);
        expect(order.trail_peak).toBe(120);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(115);
    });

    it('keeps the favorable-first long trail behavior by updating the peak before the trigger check', () => {
        const { context, order, strategy } = createTrailingContext({
            open: 118,
            high: 120,
            low: 106,
            close: 110,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(115);
        expect(order.trail_peak).toBe(120);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(115);
    });

    it('truncates fractional offset ticks before computing a long stop', () => {
        // TV truncates 1.2744 ticks to one tick. With peak 13.4699 and
        // mintick 0.001, the rounded stop is floor(13.4689 / 0.001) =
        // 13.468.
        const { context, order, strategy } = createTrailingContext({
            open: 13.469,
            high: 13.4699,
            low: 13.467,
            close: 13.4685,
            mintick: 0.001,
            trailPeak: 13.4699,
            trailOffset: 1.2744,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(13.468);
        expect(strategy.closedtrades[0].exit_price).toBe(13.468);
    });

    it('uses the long floor stop for crossing and fill', () => {
        // Raw = 13.4699 - 1 * 0.001 = 13.4689; the TV stop is the
        // per-side floor, 13.468.
        const { context, order, strategy } = createTrailingContext({
            open: 13.469,
            high: 13.4699,
            low: 13.467,
            close: 13.4675,
            mintick: 0.001,
            trailPeak: 13.4699,
            trailOffset: 1,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(13.468);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(13.468);
    });

    it('uses the short ceil stop for crossing and fill', () => {
        // Raw = 11.0608 + 1 * 0.001 = 11.0618; the TV stop is the
        // per-side ceil, 11.062.
        const { context, order, strategy } = createTrailingContext({
            open: 11.061,
            high: 11.063,
            low: 11.0608,
            close: 11.0615,
            mintick: 0.001,
            trailPeak: 11.0608,
            trailOffset: 1,
            direction: 'short',
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(11.062);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(11.062);
    });

    it('fills a long sub-tick trail at the ceil-rounded activation price', () => {
        const { context, order, strategy } = createTrailingContext({
            open: 13.46,
            high: 13.48,
            low: 13.45,
            close: 13.46,
            mintick: 0.001,
            trailPeak: NaN,
            trailOffset: 0.5,
            // exit.ts has already away-rounded a raw 13.4702 trail_price
            // to 13.471 before this order reaches processExitOrders.
            trailPrice: 13.471,
            trailArmed: false,
        });

        processExitOrders(context);
        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(13.471);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(13.471);
    });

    it('fills a short sub-tick trail at the floor-rounded activation price', () => {
        const { context, order, strategy } = createTrailingContext({
            open: 11.07,
            high: 11.08,
            low: 11.05,
            close: 11.07,
            mintick: 0.001,
            trailPeak: NaN,
            trailOffset: 0.5,
            // exit.ts has already away-rounded a raw 11.0598 trail_price
            // to 11.059 before this order reaches processExitOrders.
            trailPrice: 11.059,
            trailArmed: false,
            direction: 'short',
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(11.059);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(11.059);
    });

    it('fills a long trail at the open when the bar gaps below the current stop', () => {
        const { context, order, strategy } = createTrailingContext({
            open: 23.35,
            high: 23.7,
            low: 23,
            close: 23.28,
            mintick: 0.001,
            trailPeak: 23.7,
            trailOffset: 2,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(23.35);
        expect(order.trail_peak).toBe(23.7);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(23.35);
    });

    it('keeps exact-grid long stops stable against floating-point noise', () => {
        const { context, order, strategy } = createTrailingContext({
            open: 0.071,
            high: 0.1,
            low: 0.069,
            close: 0.07,
            mintick: 0.01,
            trailPeak: 0.1,
            trailOffset: 3,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(0.07);
        expect(strategy.closedtrades[0].exit_price).toBe(0.07);
    });
    it('preserves a genuine sub-tick short fraction instead of rounding it down', () => {
        // lowWater 10.0000000005 + one tick = 11.0000000005. The genuine
        // 5e-10 fraction is larger than the price-domain tolerance, so ceil
        // yields 12; a fixed 1e-9 tick epsilon would incorrectly yield 11.
        const { context, order, strategy } = createTrailingContext({
            open: 10.5,
            high: 11.5,
            low: 10.0000000005,
            close: 10.5,
            mintick: 1,
            trailPeak: 10.0000000005,
            trailOffset: 1,
            direction: 'short',
        });

        processExitOrders(context);

        expect(order.status).toBe('pending');
        expect(strategy.closedtrades).toHaveLength(0);
    });

    it('canonicalizes a long exact-grid stop after subtraction dust', () => {
        // 13.469000000000001 - 3 * 0.001 =
        // 13.466000000000001; the snapped grid level is 13.466.
        const { context, order, strategy } = createTrailingContext({
            open: 13.468,
            high: 13.469000000000001,
            low: 13.465,
            close: 13.466,
            mintick: 0.001,
            trailPeak: 13.469000000000001,
            trailOffset: 3,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(13.466);
        expect(strategy.closedtrades[0].exit_price).toBe(13.466);
    });

});
