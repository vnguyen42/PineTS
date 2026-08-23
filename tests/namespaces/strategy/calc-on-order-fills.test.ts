import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processStrategyOrders, processExitOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { close_all } from '../../../src/namespaces/strategy/methods/close_all';
import { cancel } from '../../../src/namespaces/strategy/methods/cancel';
import { PineTS } from '../../../src/PineTS.class';
import { Series } from '../../../src/Series';
import { Order } from '../../../src/namespaces/strategy/types';

/**
 * calc_on_order_fills=true — TV broker-emulator intrabar sequencing.
 *
 * TV semantics (official docs, Concepts / Strategies → "Altering
 * calculation behavior" → calc_on_order_fills): when the parameter is true,
 * the strategy performs an additional execution on each tick where the
 * broker emulator fills an order. On historical bars the emulator assumes 4
 * ticks per bar (open, then high & low in the inferred order, then close).
 * Orders placed during a recalculation normally fill on the NEXT tick of the
 * SAME bar — enabling same-bar round trips. The measured exception is a pure
 * market exit emitted by that recalculation: it is drained at the current
 * fill tick. Same-bar market entries and price-based exits retain their
 * next-tick/path semantics. Without the parameter (default false), orders
 * placed on bar N fill from bar N+1 and a strategy can never enter and exit
 * within one bar.
 *
 * The engine mirrors this with the per-bar COF loop in PineTS.class.ts
 * (process orders → re-run the script after any fill → drain same-tick market
 * exits → repeat, max 4 ticks) plus the same-bar guards lifted in
 * processStrategyOrders / processExitOrders and the fill-time sizing of
 * percent_of_equity default quantities (TV: "position sizes will be
 * calculated as a percentage of the available equity when the trade opens" —
 * Strategy properties help article).
 */

function makeContext(config: Record<string, unknown> = {}) {
    const context: any = new Context({
        marketData: [],
        source: [],
        tickerId: 'BTCUSDT',
        timeframe: 'D',
    } as any);
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } } as any;
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, ...config });
    return context;
}

describe('strategy calc_on_order_fills — same-bar sequencing', () => {
    it('round trip: a market entry filling at the open and a TP bracket placed by the same-bar recalculation exit in the SAME bar', () => {
        const context = makeContext({ calc_on_order_fills: true });
        // Entry queued on bar 0 (fills at bar 1's open).
        entry(context)('L', 'long');
        expect(context.strategy.pending_orders.length).toBe(1);
        expect(context.strategy.pending_orders[0]._qty_from_default_equity).toBe(false);

        // Bar 1: open 100, high 110, low 95, close 105 (open closer to low
        // → assumed ticks open → low → high → close).
        context.idx = 1;
        context.data.open = new Series([100, 100]);
        context.data.high = new Series([101, 110]);
        context.data.low = new Series([99, 95]);
        context.data.close = new Series([100, 105]);
        context.data.openTime = new Series([0, 86_400_000]);
        context.strategy._cof = { pass: 0, ticks: [100, 95, 110, 105] };

        // Pass 0: the market entry fills at the open.
        const fills0 = processStrategyOrders(context);
        expect(fills0).toBe(1);
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.opentrades.length).toBe(1);

        // Recalculation at the fill price — the script places the TP bracket.
        exit(context)('X', 'L', { limit: 102 });
        expect(context.strategy.pending_orders.length).toBe(1);

        // Pass 1 is the low tick: the long TP has not been crossed yet.
        context.strategy._cof.pass = 1;
        expect(processExitOrders(context, 'intrabar')).toBe(0);
        expect(context.strategy.position_size).toBe(1);

        // Pass 2 is the high tick: the path crosses the TP and fills it.
        context.strategy._cof.pass = 2;
        const fills1 = processExitOrders(context, 'intrabar');
        expect(fills1).toBe(1);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.opentrades.length).toBe(0);
        expect(context.strategy.closedtrades.length).toBe(1);

        // TV books the ledger timestamps at the bar's open time — the round
        // trip carries entry_time === exit_time === the same bar's timestamp.
        const trade = context.strategy.closedtrades[0];
        expect(trade.entry_time).toBe(86_400_000);
        expect(trade.exit_time).toBe(86_400_000);
        expect(trade.entry_price).toBe(100);
        expect(trade.exit_price).toBe(102);
    });

    it('intrabar limit entry placed during a same-bar recalculation fills in the same bar (COF) and is deferred (no-COF)', () => {
        // COF: the limit order queued on the current bar is eligible same-bar.
        const cof = makeContext({ calc_on_order_fills: true });
        cof.idx = 1;
        cof.data.open = new Series([100, 100]);
        cof.data.high = new Series([101, 101]);
        cof.data.low = new Series([99, 95]);
        cof.data.close = new Series([100, 100]);
        cof.data.openTime = new Series([0, 86_400_000]);
        cof.strategy._cof = { pass: 1, ticks: [100, 95, 101, 100] };

        const order: Order = {
            id: 'L', direction: 1, qty: 1, type: 'limit', limit: 98,
            bar: 1, time: 86_400_000, status: 'pending', category: 'entry',
        };
        cof.strategy.pending_orders.push(order);
        const fills = processStrategyOrders(cof);
        expect(fills).toBe(1);
        expect(cof.strategy.position_size).toBe(1);
        expect(order.fill_price).toBe(98); // intrabar at the limit level

        // no-COF: the same same-bar order is deferred to the next bar.
        const plain = makeContext();
        plain.idx = 1;
        plain.data.open = new Series([100, 100]);
        plain.data.high = new Series([101, 101]);
        plain.data.low = new Series([99, 95]);
        plain.data.close = new Series([100, 100]);
        plain.data.openTime = new Series([0, 86_400_000]);
        const order2: Order = {
            id: 'L', direction: 1, qty: 1, type: 'limit', limit: 98,
            bar: 1, time: 86_400_000, status: 'pending', category: 'entry',
        };
        plain.strategy.pending_orders.push(order2);
        const fillsPlain = processStrategyOrders(plain);
        expect(fillsPlain).toBe(0);
        expect(plain.strategy.position_size).toBe(0);
        expect(order2.status).toBe('pending');
    });

    it('gap-fills a marketable limit at the open instead of outside the bar range', () => {
        const context = makeContext({ calc_on_order_fills: true });
        context.strategy._cof = { pass: 0, ticks: [100, 101, 99, 100] };
        const order: Order = {
            id: 'L',
            direction: 1,
            qty: 1,
            type: 'limit',
            limit: 105,
            bar: -1,
            time: -1,
            status: 'pending',
            category: 'entry',
        };
        context.strategy.pending_orders.push(order);

        expect(processStrategyOrders(context)).toBe(1);
        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(100);
        expect(context.strategy.position_size).toBe(1);
    });

    it.each([
        { type: 'limit', direction: 1, field: 'limit', nextTick: 99 },
        { type: 'limit', direction: -1, field: 'limit', nextTick: 101 },
        { type: 'stop', direction: 1, field: 'stop', nextTick: 101 },
        { type: 'stop', direction: -1, field: 'stop', nextTick: 99 },
    ] as const)(
        'fills a $direction $type order when price moves from equality to its executable side',
        ({ type, direction, field, nextTick }) => {
            const context = makeContext({ calc_on_order_fills: true });
            context.strategy._cof = { pass: 1, ticks: [100, nextTick, 102, 98] };
            const order: Order = {
                id: `${type}-${direction}`,
                direction,
                qty: 1,
                type,
                [field]: 100,
                bar: -1,
                time: -1,
                status: 'pending',
                category: 'entry',
            };
            context.strategy.pending_orders.push(order);

            expect(processStrategyOrders(context)).toBe(1);
            expect(order.status).toBe('filled');
            expect(order.fill_price).toBe(100);
        },
    );

    it('activates a stop-limit before filling the resulting limit order on a later executable tick', () => {
        const context = makeContext({ calc_on_order_fills: true });
        context.strategy._cof = { pass: 1, ticks: [99, 100, 99, 100] };
        const order: Order = {
            id: 'stop-limit-equal',
            direction: 1,
            qty: 1,
            type: 'stop-limit',
            stop: 100,
            limit: 100,
            bar: -1,
            time: -1,
            status: 'pending',
            category: 'entry',
        };
        context.strategy.pending_orders.push(order);

        expect(processStrategyOrders(context)).toBe(0);
        expect(order.status).toBe('pending');

        context.strategy._cof.pass = 2;
        expect(processStrategyOrders(context)).toBe(1);
        expect(order.status).toBe('filled');
        expect(order.fill_price).toBe(99);
    });

    it.each([
        { direction: 1, ticks: [99, 100, 99, 100], stop: 100, limit: 101, fillPrice: 99 },
        { direction: -1, ticks: [100, 99, 100, 99], stop: 99, limit: 100, fillPrice: 100 },
    ] as const)(
        'activates then fills a $direction stop-limit whose stop is below its limit',
        ({ direction, ticks, stop, limit, fillPrice }) => {
            const context = makeContext({ calc_on_order_fills: true });
            context.strategy._cof = { pass: 1, ticks };
            const order: Order = {
                id: `stop-limit-${direction}`,
                direction,
                qty: 1,
                type: 'stop-limit',
                stop,
                limit,
                bar: -1,
                time: -1,
                status: 'pending',
                category: 'entry',
            };
            context.strategy.pending_orders.push(order);

            expect(processStrategyOrders(context)).toBe(0);
            context.strategy._cof.pass = 2;
            expect(processStrategyOrders(context)).toBe(1);
            expect(order.fill_price).toBe(fillPrice);
        },
    );

    it.each([
        { direction: 1, ticks: [101, 102, 103, 104], stop: 100, limit: 99 },
        { direction: -1, ticks: [99, 98, 97, 96], stop: 100, limit: 101 },
    ] as const)(
        'activates a newly placed $direction stop-limit when the next tick is already beyond its stop',
        ({ direction, ticks, stop, limit }) => {
            const context = makeContext({ calc_on_order_fills: true });
            context.strategy._cof = { pass: 1, ticks };
            const order: Order = {
                id: `new-stop-limit-${direction}`,
                direction,
                qty: 1,
                type: 'stop-limit',
                stop,
                limit,
                bar: 0,
                time: 0,
                status: 'pending',
                category: 'entry',
            };
            context.strategy.pending_orders.push(order);

            expect(processStrategyOrders(context)).toBe(0);
            expect(order.type).toBe('limit');
            expect(order.status).toBe('pending');
        },
    );

    it('fills an activated same-ID stop-limit on the next executable COF tick after an unchanged refresh', () => {
        const context = makeContext({ calc_on_order_fills: true });
        context.strategy._cof = { pass: 1, ticks: [101, 102, 103, 104] };
        context.data.open = new Series([101]);
        context.data.high = new Series([104]);
        context.data.low = new Series([101]);
        context.data.close = new Series([104]);

        entry(context)('L', 'long', { stop: 100, limit: 105 });
        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.pending_orders[0]).toMatchObject({
            type: 'limit',
            _stop_limit_activated: true,
        });
        const activatedOrder = context.strategy.pending_orders[0];

        context.strategy._cof.pass = 2;
        entry(context)('L', 'long', { stop: 100, limit: 105 });
        expect(context.strategy.pending_orders[0]).toBe(activatedOrder);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.position_size).toBe(1);
        expect(activatedOrder.status).toBe('filled');
        expect(activatedOrder.fill_price).toBe(103);
    });

    it('re-arms an activated same-ID stop-limit when its stop definition changes', () => {
        const context = makeContext({ calc_on_order_fills: true });
        context.strategy._cof = { pass: 1, ticks: [101, 102, 103, 104] };

        entry(context)('L', 'long', { stop: 100, limit: 105 });
        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.pending_orders[0].type).toBe('limit');

        context.strategy._cof.pass = 2;
        entry(context)('L', 'long', { stop: 110, limit: 105 });

        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.pending_orders[0]).toMatchObject({
            type: 'stop-limit',
            stop: 110,
            limit: 105,
            status: 'pending',
        });
    });

    it('does not re-fire a refreshed qty_percent limit exit after the path has left its trigger', () => {
        const context = makeContext({ calc_on_order_fills: true });
        context.strategy.position_size = 100;
        context.strategy.position_avg_price = 100;
        context.strategy.opentrades = [{
            id: 'trade-L',
            entry_id: 'L',
            entry_price: 100,
            entry_time: 0,
            entry_bar_index: 0,
            size: 100,
            commission: 0,
            max_drawdown: 0,
            max_runup: 0,
        }];
        context.data.low = new Series([90]);
        context.data.close = new Series([108]);
        context.strategy._cof = { pass: 2, ticks: [100, 90, 110, 108] };

        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.position_size).toBe(50);

        // The COF recalculation refreshes the same exit. The next path tick
        // remains above 105, but does not CROSS 105 again. The bar high must
        // not make the refreshed order fire a second time.
        context.strategy._cof.pass = 3;
        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        expect(processExitOrders(context, 'intrabar')).toBe(0);
        expect(context.strategy.position_size).toBe(50);
    });

    it('does not re-arm a filled qty_percent exit for the same activation on the next bar', () => {
        const context = makeContext({ calc_on_order_fills: true });
        context.strategy.position_size = 100;
        context.strategy.position_avg_price = 100;
        context.strategy.opentrades = [{
            id: 'trade-L',
            entry_id: 'L',
            entry_price: 100,
            entry_time: 0,
            entry_bar_index: 0,
            size: 100,
            commission: 0,
            max_drawdown: 0,
            max_runup: 0,
        }];
        context.data.low = new Series([90]);
        context.data.close = new Series([108]);
        context.strategy._cof = { pass: 2, ticks: [100, 90, 110, 108] };

        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.position_size).toBe(50);

        context.strategy._cof.pass = 3;
        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        expect(context.strategy.pending_orders).toHaveLength(0);

        context.idx = 1;
        context.data.open = new Series([106]);
        context.data.high = new Series([110]);
        context.data.low = new Series([104]);
        context.data.close = new Series([108]);
        context.data.openTime = new Series([86_400_000]);
        context.strategy._cof = { pass: 0, ticks: [106, 104, 110, 108] };
        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        expect(context.strategy.pending_orders).toHaveLength(0);
        expect(processExitOrders(context, 'intrabar')).toBe(0);
        expect(context.strategy.position_size).toBe(50);
    });

    it('keeps a filled partial exit dead until a new pyramid activation appears', () => {
        const context = makeContext({ calc_on_order_fills: true, pyramiding: 2 });
        context.strategy.position_size = 100;
        context.strategy.position_avg_price = 100;
        context.strategy.opentrades = [{
            id: 'trade-old',
            entry_id: 'L',
            entry_price: 100,
            entry_time: 0,
            entry_bar_index: 0,
            size: 100,
            commission: 0,
            max_drawdown: 0,
            max_runup: 0,
        }];
        context.data.low = new Series([90]);
        context.data.close = new Series([108]);
        context.strategy._cof = { pass: 2, ticks: [100, 90, 110, 108] };

        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 }, { __callsiteId: 'site-Tg1' });
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.opentrades[0].size).toBe(50);

        for (const idx of [1, 2]) {
            context.idx = idx;
            context.data.open = new Series([100]);
            context.data.high = new Series([101]);
            context.data.low = new Series([99]);
            context.data.close = new Series([100]);
            context.data.openTime = new Series([idx * 86_400_000]);
            context.strategy._cof = { pass: 0, ticks: [100, 99, 101, 100] };
            exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 }, { __callsiteId: 'site-Tg1' });
            expect(context.strategy.pending_orders).toHaveLength(0);
        }

        context.idx = 3;
        context.data.open = new Series([96]);
        context.data.high = new Series([101]);
        context.data.low = new Series([94]);
        context.data.close = new Series([99]);
        context.data.openTime = new Series([259_200_000]);
        context.strategy.position_size = 150;
        context.strategy.opentrades.push({
            id: 'trade-new',
            entry_id: 'L',
            entry_price: 100,
            entry_time: 259_200_000,
            entry_bar_index: 3,
            size: 100,
            commission: 0,
            max_drawdown: 0,
            max_runup: 0,
        });
        context.strategy._cof = { pass: 0, ticks: [96, 94, 101, 99] };
        // The wrong-sided absolute limit is kept only for persistent exit
        // cadence; losing history on a suppressed bar would drop this leg.
        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 95 }, { __callsiteId: 'site-Tg1' });

        expect(context.strategy.pending_orders[0]._isPersistent).toBe(true);
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.opentrades.find((trade: { id: string }) => trade.id === 'trade-old')).toBeUndefined();
        expect(context.strategy.opentrades.find((trade: { id: string }) => trade.id === 'trade-new')?.size).toBe(100);
    });

    it('keeps a consumed exit waiting across COF passes for a delayed pyramid entry', () => {
        const context = makeContext({ calc_on_order_fills: true, process_orders_on_close: true, pyramiding: 2 });
        context.strategy.position_size = 100;
        context.strategy.position_avg_price = 100;
        context.strategy.opentrades = [{
            id: 'trade-old',
            entry_id: 'L',
            entry_price: 100,
            entry_time: 0,
            entry_bar_index: 0,
            size: 100,
            commission: 0,
            max_drawdown: 0,
            max_runup: 0,
        }];
        context.data.low = new Series([90]);
        context.data.close = new Series([108]);
        context.strategy._cof = { pass: 2, ticks: [100, 90, 110, 108] };

        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.opentrades[0].size).toBe(50);

        entry(context)('L', 'long', { qty: 100, limit: 90 });
        context.strategy._cof.pass = 3;
        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        expect(context.strategy.pending_orders.filter((order: Order) => order.category === 'exit')).toHaveLength(1);

        expect(processExitOrders(context, 'intrabar')).toBe(0);
        expect(context.strategy.pending_orders.filter((order: Order) => order.category === 'exit')).toHaveLength(1);
        context.strategy._cof.pass = 4;
        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        expect(context.strategy.pending_orders.filter((order: Order) => order.category === 'exit')).toHaveLength(1);
        expect(processExitOrders(context, 'close')).toBe(0);
        expect(context.strategy.pending_orders.filter((order: Order) => order.category === 'exit')).toHaveLength(1);

        context.idx = 1;
        context.data.open = new Series([100]);
        context.data.high = new Series([104]);
        context.data.low = new Series([95]);
        context.data.close = new Series([102]);
        context.data.openTime = new Series([86_400_000]);
        context.strategy._cof = { pass: 0, ticks: [100, 95, 104, 102] };
        processExitOrders(context, 'open');
        expect(processStrategyOrders(context)).toBe(0);
        context.strategy._cof.pass = 2;
        expect(processExitOrders(context, 'intrabar')).toBe(0);
        expect(processExitOrders(context, 'close')).toBe(0);
        expect(context.strategy.pending_orders.filter((order: Order) => order.category === 'exit')).toHaveLength(1);

        context.idx = 2;
        context.data.open = new Series([89]);
        context.data.high = new Series([106]);
        context.data.low = new Series([88]);
        context.data.close = new Series([104]);
        context.data.openTime = new Series([172_800_000]);
        context.strategy._cof = { pass: 0, ticks: [89, 88, 106, 104] };
        processExitOrders(context, 'open');
        expect(processStrategyOrders(context)).toBe(1);

        context.strategy._cof.pass = 2;
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.opentrades.find((trade: { id: string }) => trade.id === 'trade-old')?.size).toBe(50);
        expect(context.strategy.opentrades.find((trade: { id: string }) => trade.id !== 'trade-old')?.size).toBe(50);
    });

    it('clears a waiting exit after its matching entry is explicitly cancelled', () => {
        const context = makeContext({ calc_on_order_fills: true });

        entry(context)('L', 'long', { qty: 100, limit: 90 });
        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        expect(context.strategy.pending_orders).toHaveLength(2);

        cancel(context)('L');
        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(processExitOrders(context, 'intrabar')).toBe(0);
        expect(context.strategy.pending_orders).toHaveLength(0);
    });

    it('keeps a waiting exit bound to an entry ID when the pending entry reverses direction', () => {
        const context = makeContext({ calc_on_order_fills: true });

        entry(context)('L', 'long', { qty: 100, limit: 90 });
        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        entry(context)('L', 'short', { qty: 100, limit: 110 });

        expect(context.strategy.pending_orders.filter((order: Order) => order.category === 'entry')).toHaveLength(1);
        expect(context.strategy.pending_orders.find((order: Order) => order.category === 'entry')?.direction).toBe(-1);
        expect(processExitOrders(context, 'intrabar')).toBe(0);
        expect(context.strategy.pending_orders.filter((order: Order) => order.category === 'exit')).toHaveLength(1);
    });

    it('lets close_all supersede a waiting conditional exit', () => {
        const context = makeContext({ calc_on_order_fills: true });
        context.strategy.position_size = 100;
        context.strategy.position_avg_price = 100;
        context.strategy.opentrades = [{
            id: 'trade-L',
            entry_id: 'L',
            entry_price: 100,
            entry_time: 0,
            entry_bar_index: 0,
            size: 100,
            commission: 0,
            max_drawdown: 0,
            max_runup: 0,
        }];

        entry(context)('L', 'long', { qty: 100, limit: 90 });
        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        close_all(context)();

        expect(context.strategy.pending_orders.some((order: Order) => order.id === 'Tg1')).toBe(false);
        expect(context.strategy.pending_orders.some((order: Order) => order.id === 'close_all')).toBe(true);
    });

    it('does not re-arm a filled qty_percent trailing exit for its partially open lot', () => {
        const context = makeContext({ calc_on_order_fills: true });
        context.strategy.position_size = 100;
        context.strategy.position_avg_price = 100;
        context.strategy.opentrades = [{
            id: 'trade-L',
            entry_id: 'L',
            entry_price: 100,
            entry_time: 0,
            entry_bar_index: 0,
            size: 100,
            commission: 0,
            max_drawdown: 0,
            max_runup: 0,
        }];
        context.data.open = new Series([100]);
        context.data.high = new Series([110]);
        context.data.low = new Series([90]);
        context.data.close = new Series([100]);
        context.strategy._cof = { pass: 2, ticks: [100, 90, 110, 100] };

        exit(context)('Trail', 'L', { qty_percent: 50, trail_price: 101, trail_offset: 500 });
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.position_size).toBe(50);

        context.strategy._cof.pass = 3;
        exit(context)('Trail', 'L', { qty_percent: 50, trail_price: 101, trail_offset: 500 });
        expect(context.strategy.pending_orders).toHaveLength(0);
    });

    it('re-arms a consumed exit after close_all for a new physical lot with the same entry ID', () => {
        const context = makeContext({ calc_on_order_fills: true });
        context.strategy.position_size = 100;
        context.strategy.position_avg_price = 100;
        context.strategy.opentrades = [{
            id: 'trade-first',
            entry_id: 'L',
            entry_price: 100,
            entry_time: 0,
            entry_bar_index: 0,
            size: 100,
            commission: 0,
            max_drawdown: 0,
            max_runup: 0,
        }];
        context.data.low = new Series([90]);
        context.data.close = new Series([108]);
        context.strategy._cof = { pass: 2, ticks: [100, 90, 110, 108] };

        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.position_size).toBe(50);

        close_all(context)();
        context.strategy._cof.pass = 3;
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.position_size).toBe(0);

        context.idx = 1;
        context.strategy.position_size = 100;
        context.strategy.position_avg_price = 100;
        context.strategy.opentrades.push({
            id: 'trade-second',
            entry_id: 'L',
            entry_price: 100,
            entry_time: 86_400_000,
            entry_bar_index: 1,
            size: 100,
            commission: 0,
            max_drawdown: 0,
            max_runup: 0,
        });
        context.strategy._cof = { pass: 2, ticks: [100, 90, 110, 108] };

        exit(context)('Tg1', 'L', { qty_percent: 50, limit: 105 });
        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0]).toMatchObject({ id: 'trade-second', size: 50 });
    });

    it('refreshes a pending stop entry with the same ID instead of accumulating stale orders', () => {
        const context = makeContext({ calc_on_order_fills: true });

        entry(context)('L', 'long', { stop: 105 });
        entry(context)('L', 'long', { stop: 106 });

        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0].id).toBe('L');
        expect(context.strategy.pending_orders[0].stop).toBe(106);
    });

    it('keeps same-ID pending entries in separate pyramiding slots across bars', () => {
        const context = makeContext({ calc_on_order_fills: true, pyramiding: 3 });

        for (let bar = 0; bar < 3; bar++) {
            context.idx = bar;
            context.data.openTime = new Series([bar * 86_400_000]);
            entry(context)('L', 'long', { limit: 90 - bar });
        }

        expect(context.strategy.pending_orders).toHaveLength(3);
        expect(context.strategy.pending_orders.map((order: Order) => order.limit)).toEqual([90, 89, 88]);
    });

    it('cancels every same-ID pending order before placing an opposite-direction entry', () => {
        const context = makeContext({ calc_on_order_fills: true, pyramiding: 3 });

        entry(context)('E', 'long', { limit: 90 });
        entry(context)('E', 'long', { limit: 89 });
        entry(context)('E', 'long', { limit: 88 });
        entry(context)('E', 'short', { limit: 110 });

        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0]).toMatchObject({
            id: 'E',
            direction: -1,
            limit: 110,
            status: 'pending',
        });
    });

    it('modifies an unchanged same-ID pending definition instead of duplicating it', () => {
        const context = makeContext({ calc_on_order_fills: true, pyramiding: 3 });

        for (let bar = 0; bar < 3; bar++) {
            context.idx = bar;
            context.data.openTime = new Series([bar * 86_400_000]);
            entry(context)('L', 'long', { limit: 90 });
        }

        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0].bar).toBe(2);
    });

    it('modifies a same-ID pending entry after that direction already has an open trade', () => {
        const context = makeContext({ calc_on_order_fills: true, pyramiding: 3 });
        context.strategy.position_size = 1;
        context.strategy.opentrades.push({ size: 1 });

        entry(context)('L2', 'long', { limit: 90 });
        context.idx = 1;
        entry(context)('L2', 'long', { limit: 89 });

        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0].limit).toBe(89);
    });

    it('percent_of_equity default quantity is re-sized at FILL in COF mode (TV: "when the trade opens") — and no-COF fills at placement size (v5 margin 0: no rejection)', () => {
        const make = () => {
            const context = makeContext({
                calc_on_order_fills: true,
                initial_capital: 1000,
                default_qty_type: 'percent_of_equity',
                default_qty_value: 100,
            });
            // Placed at close 10 → placement-time qty = 1000 / 10 = 100.
            context.data.close = new Series([10]);
            entry(context)('L', 'long');
            const order = context.strategy.pending_orders[0];
            expect(order.qty).toBe(100);
            expect(order._qty_from_default_equity).toBe(true);
            // Fill bar opens at 11: placement qty × 11 = 1100 > equity 1000
            // → the placement-time size would be margin-rejected. TV sizes at
            // fill: qty = 1000 / 11 → required = 1000 → equality → fills.
            context.idx = 1;
            context.data.open = new Series([10, 11]);
            context.data.high = new Series([10, 11.5]);
            context.data.low = new Series([10, 10.5]);
            context.data.close = new Series([10, 11]);
            context.data.openTime = new Series([0, 86_400_000]);
            return context;
        };

        const cof = make();
        cof.strategy._cof = { pass: 0, ticks: [11, 11.5, 10.5, 11] };
        const fills = processStrategyOrders(cof);
        expect(fills).toBe(1);
        // floor(1000/11 × 1e6)/1e6
        expect(cof.strategy.position_size).toBe(Math.floor((1000 / 11) * 1e6) / 1e6);

        // no-COF: the placement-time qty (100) fills at the open (11) →
        // notional 1100 > equity 1000. The fork's old 100%-margin default
        // rejected this entry ("notional exceeds equity"); TV's v5 default
        // margin is 0 (no margin requirement) so the entry fills at the
        // placement-time size — the fork divergence is gone. The COF-vs-noCOF
        // contrast (fill-time re-size vs placement-time size) still holds.
        const plain = makeContext({
            initial_capital: 1000,
            default_qty_type: 'percent_of_equity',
            default_qty_value: 100,
        });
        plain.data.close = new Series([10]);
        entry(plain)('L', 'long');
        plain.idx = 1;
        plain.data.open = new Series([10, 11]);
        plain.data.high = new Series([10, 11.5]);
        plain.data.low = new Series([10, 10.5]);
        plain.data.close = new Series([10, 11]);
        plain.data.openTime = new Series([0, 86_400_000]);
        const fillsPlain = processStrategyOrders(plain);
        expect(fillsPlain).toBe(1);
        expect(plain.strategy.position_size).toBe(100);
    });
});

describe('strategy calc_on_order_fills — end-to-end loop', () => {
    // Deterministic 5-bar feed: entry fires on bar 0 (ep = close = 99),
    // fills at bar 1's open (100); the TP (ep × 1.02 = 100.98) is above the
    // fill and within bar 1's range (high 110). With calc_on_order_fills=true
    // the recalculation after the entry fill places the bracket intrabar →
    // same-bar round trip. Without it the bracket is placed at bar 1's close
    // and fills on bar 2 (high 101.5 ≥ 100.98).
    const candles = [
        { openTime: 0, open: 98, high: 99, low: 97, close: 99, volume: 1000, closeTime: 86_399_999 },
        { openTime: 86_400_000, open: 100, high: 110, low: 95, close: 105, volume: 1000, closeTime: 172_799_999 },
        { openTime: 172_800_000, open: 100.5, high: 101.5, low: 100, close: 101, volume: 1000, closeTime: 259_199_999 },
        { openTime: 259_200_000, open: 101, high: 101.5, low: 100.5, close: 101, volume: 1000, closeTime: 345_599_999 },
        { openTime: 345_600_000, open: 101, high: 101.5, low: 100.5, close: 101, volume: 1000, closeTime: 431_999_999 },
    ];

    class FixedProvider {
        configure() {}
        async getMarketData() {
            return candles;
        }
        async getSymbolInfo() {
            return {
                ticker: 'BTCUSDT', tickerid: 'TEST:BTCUSDT', main_tickerid: 'TEST:BTCUSDT',
                prefix: 'TEST', root: 'BTC', description: 'BTC / USDT', type: 'crypto',
                basecurrency: 'BTC', currency: 'USDT', timezone: 'Etc/UTC',
                mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1, mincontract: 0.00001,
                session: '24x7', volumetype: 'base',
            };
        }
    }

    const SOURCE = `
//@version=5
strategy('COF roundtrip', calc_on_order_fills=true, default_qty_type=strategy.fixed, default_qty_value=1)
var float ep = na
if bar_index == 0
    ep := close
    strategy.entry('L', strategy.long)
if strategy.position_size > 0
    strategy.exit('X', 'L', limit = ep * 1.02)`;
    const MARKET_CLOSE_SOURCE = `
//@version=5
strategy('COF market close', calc_on_order_fills=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
if strategy.position_size > 0
    strategy.close('L')`;

    const MARKET_ENTRY_SOURCE = `
//@version=5
strategy('COF market-entry cadence', calc_on_order_fills=true, pyramiding=2, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L1', strategy.long)
if strategy.position_size > 0 and strategy.opentrades == 1
    strategy.entry('L2', strategy.long)
if strategy.position_size > 0
    strategy.exit('TP1', 'L1', limit=102)`;
    it('same-bar round trip appears with calc_on_order_fills=true and not with false', async () => {
        const run = async (cof: boolean) => {
            const source = cof ? SOURCE : SOURCE.replace('calc_on_order_fills=true, ', '');
            const engine = new PineTS(new FixedProvider() as any, 'BTCUSDT', 'D');
            const ctx = await engine.run(source);
            return ctx.strategy as any;
        };

        const cof = await run(true);
        expect(cof.closedtrades.length).toBe(1);
        const cofTrade = cof.closedtrades[0];
        expect(cofTrade.entry_time).toBe(86_400_000);
        expect(cofTrade.exit_time).toBe(86_400_000); // same-bar round trip
        expect(cofTrade.entry_price).toBe(100);
        expect(cofTrade.exit_price).toBe(100.98);

        const plain = await run(false);
        expect(plain.closedtrades.length).toBe(1);
        const plainTrade = plain.closedtrades[0];
        expect(plainTrade.entry_time).toBe(86_400_000);
        expect(plainTrade.exit_time).toBe(172_800_000); // exit on the NEXT bar
        expect(plainTrade.exit_price).toBe(100.98);
    });

    it('drains a recalculated pure market close at the triggering fill tick', async () => {
        const engine = new PineTS(new FixedProvider() as any, 'BTCUSDT', 'D');
        const context = await engine.run(MARKET_CLOSE_SOURCE);
        const strategy = context.strategy as any;

        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].entry_price).toBe(100);
        // Bar 1 follows open → low → high; the old next-tick behavior closed
        // this trade at 95 instead of at the entry fill's open price.
        expect(strategy.closedtrades[0].exit_price).toBe(100);
    });

    it('keeps a recalculated market entry on the next path tick while its bracket uses the crossed level', async () => {
        const engine = new PineTS(new FixedProvider() as any, 'BTCUSDT', 'D');
        const context = await engine.run(MARKET_ENTRY_SOURCE);
        const strategy = context.strategy as any;
        const l2 = strategy.opentrades.find((trade: any) => trade.entry_id === 'L2');
        const l1 = strategy.closedtrades.find((trade: any) => trade.entry_id === 'L1');

        expect(l2).toBeDefined();
        expect(l2.entry_price).toBe(95);
        expect(l1).toBeDefined();
        expect(l1.exit_price).toBe(102);
    });
});
