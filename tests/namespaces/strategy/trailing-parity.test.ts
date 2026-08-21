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
}: {
    open: number;
    high: number;
    low: number;
    close: number;
    mintick?: number;
    trailPeak?: number;
    trailOffset?: number;
}) {
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
                entry_id: 'buy',
                entry_price: 100,
                entry_bar_index: 0,
                entry_time: 0,
                size: 1,
                status: 'open',
            },
        ],
        closedtrades: [],
        pending_orders: [
            {
                id: 'exit_1',
                direction: -1,
                qty: 1,
                type: 'stop',
                category: 'exit',
                from_entry: 'buy',
                trail_points: 10,
                trail_offset: trailOffset,
                trail_peak: trailPeak,
                trail_armed: true,
                status: 'pending',
                bar: 0,
                time: 0,
            },
        ],
        position_size: 1,
        position_avg_price: 100,
        position_entry_name: 'buy',
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
        losstrades_total_loss: 0,
        max_contracts_held_all: 1,
        max_contracts_held_long: 1,
        max_contracts_held_short: 0,
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

    it('quantizes a long trailing sell-stop fill up to the mintick (ceil) while the trigger stays on the raw stop', () => {
        // VIN-86 (TV oracle 2602, 55/55): favorable-first O-H-L-C bar. Raw
        // stop = peak(120) - offset(5.5 ticks) * mintick(1) = 114.5. The
        // trigger fires because low (114.5) <= raw stop; TV reports the fill
        // at ceil(114.5 / 1) * 1 = 115, which stays within [low 114.5, high 120].
        const { context, order, strategy } = createTrailingContext({
            open: 118,
            high: 120,
            low: 114.5,
            close: 118.5,
            trailPeak: 120,
            trailOffset: 5.5,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(115);
        expect(order.trail_peak).toBe(120);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(115);
    });

    it('keeps the long trailing trigger on the raw stop (a low between raw and ceil does not fire)', () => {
        // Same raw stop 114.5; bar low 114.6 does not cross it. If the
        // crossing test used the quantized level (115), 114.6 <= 115 would
        // fire — this proves the trigger/crossing test still uses the raw stop.
        const { context, order, strategy } = createTrailingContext({
            open: 118,
            high: 120,
            low: 114.6,
            close: 118.5,
            trailPeak: 120,
            trailOffset: 5.5,
        });

        processExitOrders(context);

        expect(order.status).toBe('pending');
        expect(strategy.closedtrades).toHaveLength(0);
    });

    it('clamps a long trailing fill to the bar range when the mintick ceil would exit it', () => {
        // Adverse-first O-H-L-C bar. Armed prior bar with peak 126: the raw
        // segment-1 trigger = 126 - 5 = 121 sits ABOVE the bar's high (120).
        // Segment 1 crosses it (low 106 <= 121); ceil(121) = 121 would leave
        // the bar, so the fill-model clamp pins the reported fill to 120.
        const { context, order, strategy } = createTrailingContext({
            open: 108,
            high: 120,
            low: 106,
            close: 110,
            trailPeak: 126,
            trailOffset: 5,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(120);
        expect(order.trail_peak).toBe(126);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(120);
    });

    it('keeps a long trailing fill unchanged when the raw stop is exactly on a tick (EPS guard)', () => {
        // VIN-86 regression (review): raw stop = peak(0.22) - 15 ticks *
        // mintick(0.01) = 0.07. In floats 0.07 / 0.01 = 7.000000000000001,
        // so a naive ceil would report 0.08; the price-grid-aware upward
        // quantizer must leave the exact-tick stop unchanged at 0.07.
        const { context, order, strategy } = createTrailingContext({
            open: 0.218,
            high: 0.22,
            low: 0.069,
            close: 0.1,
            mintick: 0.01,
            trailPeak: 0.22,
            trailOffset: 15,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(0.07);
        expect(order.trail_peak).toBe(0.22);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(0.07);
    });
    it('absorbs upstream subtraction noise before the long trailing ceil (0.1 - 0.09 -> 0.01)', () => {
        // The raw stop is 0.01000000000000000368 from 0.1 - 9 * 0.01.
        // A quotient-only ceil sees 1.0000000000000004 and reports 0.02;
        // snapping the raw price to its nearby 0.01 grid must report 0.01.
        const { context, order, strategy } = createTrailingContext({
            open: 0.099,
            high: 0.1,
            low: 0,
            close: 0.05,
            mintick: 0.01,
            trailPeak: 0.1,
            trailOffset: 9,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(0.01);
        expect(order.trail_peak).toBe(0.1);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(0.01);
    });

    it('keeps a large exact-grid long trailing stop on its tick (50000 - 9 ticks)', () => {
        // The price-unit tolerance is relative to price magnitude: a
        // 50000 - 9 * 0.01 stop must remain 49999.91, not 49999.92.
        const { context, order, strategy } = createTrailingContext({
            open: 49999.99,
            high: 50000,
            low: 49999,
            close: 49999.5,
            mintick: 0.01,
            trailPeak: 50000,
            trailOffset: 9,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(49999.91);
        expect(order.trail_peak).toBe(50000);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(49999.91);
    });


    it('ceils a genuinely fractional long trailing raw stop to the next tick (0.073 -> 0.08)', () => {
        // VIN-86: raw stop = peak(0.123) - 5 ticks * mintick(0.01) = 0.073,
        // genuinely off-grid — the upward quantization must report 0.08.
        const { context, order, strategy } = createTrailingContext({
            open: 0.121,
            high: 0.123,
            low: 0.069,
            close: 0.1,
            mintick: 0.01,
            trailPeak: 0.123,
            trailOffset: 5,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(0.08);
        expect(order.trail_peak).toBe(0.123);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(0.08);
    });
    it('keeps a genuine sub-noise fraction on the upward side (5e-10 / 1 -> 1)', () => {
        // The relative price-grid tolerance must not swallow a genuine
        // fraction: 5e-10 price is real at mintick 1, so ceil(5e-10) = 1.
        const { context, order, strategy } = createTrailingContext({
            open: 1,
            high: 1.0000000005,
            low: 0,
            close: 0.5,
            mintick: 1,
            trailPeak: 1.0000000005,
            trailOffset: 1,
        });

        processExitOrders(context);

        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(1);
        expect(order.trail_peak).toBe(1.0000000005);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(1);
    });

});
