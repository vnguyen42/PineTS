import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import type { Order, Trade } from '../../../src/namespaces/strategy/types';
import { closePartialPosition, initializeStrategy, processExitOrders, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { exit } from '../../../src/namespaces/strategy/methods/exit';

function makeContext(closeEntriesRule: 'FIFO' | 'ANY' = 'FIFO') {
    const context: any = new Context({
        marketData: [],
        source: [],
        tickerId: 'ETHUSDT',
        timeframe: '240',
    } as any);
    context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } } as any;
    initializeStrategy(context, { close_entries_rule: closeEntriesRule, pyramiding: 3 });
    context.idx = 4;
    context.data.open = new Series([1873.91]);
    context.data.high = new Series([1928]);
    context.data.low = new Series([1873.4]);
    context.data.close = new Series([1917.03]);
    context.data.openTime = new Series([4000]);
    return context;
}

function lot(id: string, entryId: string, entryPrice: number, bar: number): Trade {
    return {
        id,
        entry_id: entryId,
        entry_comment: entryId,
        entry_price: entryPrice,
        _bracket_entry: entryPrice,
        entry_bar_index: bar,
        entry_time: bar * 1000,
        size: 10,
        commission: 0,
        max_drawdown: 0,
        max_runup: 0,
        status: 'open',
    };
}

function exitOrder(id: string, fromEntry: string, limit: number, qty = 0, qtyPercent?: number): Order {
    return {
        id,
        direction: 0,
        qty,
        qty_percent: qtyPercent,
        type: 'market',
        limit,
        from_entry: fromEntry,
        bar: 3,
        time: 3000,
        status: 'pending',
        category: 'exit',
    };
}

function seed(context: any, sameId = false) {
    context.strategy.opentrades = [
        lot('trade_1', sameId ? 'L' : 'L1', 1800, 0),
        lot('trade_2', sameId ? 'L' : 'L2', 1810, 1),
        lot('trade_3', sameId ? 'L' : 'L3', 1820, 2),
    ];
    context.strategy.position_size = 30;
    context.strategy.position_avg_price = 1810;
    context.strategy.position_entry_name = sameId ? 'L' : 'L1';
}

function allocation(context: any) {
    return context.strategy.closedtrades.map((trade: Trade) => ({
        entryId: trade.entry_id,
        qty: Math.abs(trade.size),
        exit: trade.exit_price,
    }));
}

describe('strategy exit global FIFO allocation', () => {
    it('sorts distinct-id exits by path crossing, not reversed Pine call order', () => {
        const context = makeContext();
        seed(context);
        context.strategy.pending_orders = [
            exitOrder('X-high-L1', 'L1', 1900, 10),
            exitOrder('X-mid-L2', 'L2', 1890, 10),
            exitOrder('X-low-L3', 'L3', 1880, 5),
        ];

        processExitOrders(context);

        expect(allocation(context)).toEqual([
            { entryId: 'L1', qty: 5, exit: 1880 },
            { entryId: 'L1', qty: 5, exit: 1890 },
            { entryId: 'L2', qty: 5, exit: 1890 },
            { entryId: 'L2', qty: 5, exit: 1900 },
            { entryId: 'L3', qty: 5, exit: 1900 },
        ]);
        expect(context.strategy.opentrades.map((trade: Trade) => [trade.entry_id, trade.size])).toEqual([['L3', 5]]);
    });

    it('splits the same entry id at physical lot boundaries and snapshots qty_percent', () => {
        const context = makeContext();
        seed(context, true);
        context.strategy.pending_orders = [exitOrder('half', 'L', 1880, 0, 50)];

        processExitOrders(context);

        expect(allocation(context)).toEqual([
            { entryId: 'L', qty: 10, exit: 1880 },
            { entryId: 'L', qty: 5, exit: 1880 },
        ]);
        expect(context.strategy.opentrades.map((trade: Trade) => trade.size)).toEqual([5, 10]);
    });
    it.each([
        { total: 10, requested: 5, expected: [5, 5] },
        { total: 11, requested: 5.5, expected: [5, 6] },
    ])('floors an explicit qty-step exit and gives the position remainder to the later exit ($total)', ({ total, requested, expected }) => {
        const context = makeContext();
        context.pine.qtyStep = 1;
        const trade = lot('trade_1', 'L', 1800, 0);
        trade.size = total;
        context.strategy.opentrades = [trade];
        context.strategy.position_size = total;
        context.strategy.position_avg_price = 1800;
        context.strategy.position_entry_name = 'L';

        exit(context)('half', 'L', { limit: 1880, qty: requested });
        exit(context)('rest', 'L', { limit: 1880 });

        expect(processExitOrders(context)).toBe(2);
        expect(context.strategy.closedtrades.map((closed) => Math.abs(closed.size))).toEqual(expected);
        expect(context.strategy.closedtrades.every((closed) => Number.isInteger(closed.size))).toBe(true);
        expect(context.strategy.position_size).toBe(0);
    });
    it('keeps an explicit sub-step exit pending inert and refreshable', () => {
        const context = makeContext();
        context.pine.qtyStep = 1;
        const trade = lot('trade_1', 'L', 1800, 0);
        trade.size = 1;
        context.strategy.opentrades = [trade];
        context.strategy.position_size = 1;
        context.strategy.position_avg_price = 1800;
        context.strategy.position_entry_name = 'L';

        exit(context)('substep', 'L', { limit: 1880, qty: 0.5 });

        expect(context.strategy.pending_orders).toHaveLength(1);
        const initialOrder = context.strategy.pending_orders[0];
        expect(initialOrder).toMatchObject({ qty: 0, _explicit_qty_cap: true, limit: 1880, status: 'pending' });
        expect(processExitOrders(context)).toBe(0);
        expect(context.strategy.closedtrades).toHaveLength(0);
        expect(context.strategy.opentrades.map((open) => open.size)).toEqual([1]);
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.pending_orders).toHaveLength(1);

        exit(context)('substep', 'L', { limit: 1881, qty: 0.5 });

        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0]).toBe(initialOrder);
        expect(context.strategy.pending_orders[0]).toMatchObject({ qty: 0, _explicit_qty_cap: true, limit: 1881, status: 'pending' });
        expect(processExitOrders(context)).toBe(0);
        expect(context.strategy.closedtrades).toHaveLength(0);
        expect(context.strategy.position_size).toBe(1);
    });

    it('re-derives the cap when a same-id exit refresh crosses the qty step boundary', () => {
        const zeroToPositive = makeContext();
        zeroToPositive.pine.qtyStep = 1;
        const tradeA = lot('trade_1', 'L', 1800, 0);
        tradeA.size = 1;
        zeroToPositive.strategy.opentrades = [tradeA];
        zeroToPositive.strategy.position_size = 1;
        zeroToPositive.strategy.position_avg_price = 1800;
        zeroToPositive.strategy.position_entry_name = 'L';

        exit(zeroToPositive)('substep', 'L', { limit: 1880, qty: 0.5 });
        expect(zeroToPositive.strategy.pending_orders[0]).toMatchObject({ qty: 0, _explicit_qty_cap: true });
        exit(zeroToPositive)('substep', 'L', { limit: 1880, qty: 2 });

        expect(zeroToPositive.strategy.pending_orders).toHaveLength(1);
        expect(zeroToPositive.strategy.pending_orders[0]).toMatchObject({ qty: 2, _explicit_qty_cap: true });
        expect(processExitOrders(zeroToPositive)).toBe(1);
        expect(zeroToPositive.strategy.closedtrades).toHaveLength(1);
        expect(zeroToPositive.strategy.position_size).toBe(0);

        const positiveToZero = makeContext();
        positiveToZero.pine.qtyStep = 1;
        const tradeB = lot('trade_1', 'L', 1800, 0);
        tradeB.size = 1;
        positiveToZero.strategy.opentrades = [tradeB];
        positiveToZero.strategy.position_size = 1;
        positiveToZero.strategy.position_avg_price = 1800;
        positiveToZero.strategy.position_entry_name = 'L';

        exit(positiveToZero)('substep', 'L', { limit: 1880, qty: 2 });
        expect(positiveToZero.strategy.pending_orders[0]).toMatchObject({ qty: 2, _explicit_qty_cap: true });
        exit(positiveToZero)('substep', 'L', { limit: 1880, qty: 0.5 });

        expect(positiveToZero.strategy.pending_orders).toHaveLength(1);
        expect(positiveToZero.strategy.pending_orders[0]).toMatchObject({ qty: 0, _explicit_qty_cap: true });
        expect(processExitOrders(positiveToZero)).toBe(0);
        expect(positiveToZero.strategy.closedtrades).toHaveLength(0);
        expect(positiveToZero.strategy.position_size).toBe(1);
    });



    it('retains targeted physical allocation for close_entries_rule ANY', () => {
        const context = makeContext('ANY');
        seed(context);
        context.strategy.pending_orders = [exitOrder('target-L3', 'L3', 1880, 5)];

        processExitOrders(context);

        expect(allocation(context)).toEqual([{ entryId: 'L3', qty: 5, exit: 1880 }]);
        expect(context.strategy.opentrades.map((trade: Trade) => [trade.entry_id, trade.size])).toEqual([
            ['L3', 5],
            ['L1', 10],
            ['L2', 10],
        ]);
    });

    it('restores the canonical position entry name after excluding an older lot', () => {
        const context = makeContext();
        context.strategy.opentrades = [
            lot('A', 'A-entry', 100, 0),
            lot('B', 'B-entry', 100, 1),
        ];
        context.strategy.position_size = 20;
        context.strategy.position_avg_price = 100;
        context.strategy.position_entry_name = 'A-entry';
        context.strategy.pending_orders = [{
            ...exitOrder('refreshed-all', '', 1880, 5),
            _excluded_activation_trade_ids: ['A'],
            _excluded_consumed_trade_ids: ['A'],
        }];

        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy.opentrades.map((trade: Trade) => [trade.id, trade.size])).toEqual([
            ['A', 10],
            ['B', 5],
        ]);
        expect(context.strategy.position_entry_name).toBe('A-entry');
    });

    it('executes every crossed per-lot event from one exit order', () => {
        const context = makeContext();
        context.pine.syminfo.mintick = 1;
        context.data.open = new Series([100]);
        context.data.high = new Series([140]);
        context.data.low = new Series([100]);
        context.data.close = new Series([140]);
        context.strategy.opentrades = [
            lot('trade_1', 'L1', 100, 0),
            lot('trade_2', 'L2', 110, 1),
            lot('trade_3', 'L3', 120, 2),
        ];
        context.strategy.position_size = 30;
        context.strategy.position_avg_price = 110;
        context.strategy.position_entry_name = 'L1';
        context.strategy.pending_orders = [{
            ...exitOrder('one-exit', '', 0),
            limit: undefined,
            profit: 10,
        }];

        expect(processExitOrders(context)).toBe(3);
        expect(allocation(context)).toEqual([
            { entryId: 'L1', qty: 10, exit: 110 },
            { entryId: 'L2', qty: 10, exit: 120 },
            { entryId: 'L3', qty: 10, exit: 130 },
        ]);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.opentrades).toHaveLength(0);
    });

    it('trims remapped activation segments when a direct FIFO close spans lots', () => {
        const context = makeContext();
        context.strategy.opentrades = [
            lot('trade_A', 'A', 100, 0),
            lot('trade_B', 'B', 100, 1),
        ];
        context.strategy.position_size = 20;
        context.strategy.position_avg_price = 100;
        context.strategy.position_entry_name = 'A';
        context.strategy.pending_orders = [exitOrder('B-exit', 'B', 1880, 5)];

        expect(processExitOrders(context)).toBe(1);
        closePartialPosition(context, 7, 1800, 5000, {
            exitId: 'Margin call',
            exitComment: 'Margin call',
        });

        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0]).toMatchObject({
            entry_id: 'B',
            size: 8,
            _activation_segments: [
                expect.objectContaining({ id: 'trade_A', entryId: 'A', qty: 3 }),
                expect.objectContaining({ id: 'trade_B', entryId: 'B', qty: 5 }),
            ],
        });

        context.idx = 5;
        context.data.openTime = new Series([5000]);
        context.strategy.pending_orders = [exitOrder('A-exit', 'A', 1880, 5)];

        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy.closedtrades.at(-1)).toMatchObject({
            entry_id: 'B',
            size: 3,
            exit_id: 'A-exit',
        });
        expect(context.strategy.position_size).toBe(5);
        expect(context.strategy.opentrades[0].size).toBe(5);
    });

    it('ignores the pre-entry path when a waiting exit attaches to an intrabar entry', () => {
        const context = makeContext();
        seed(context);
        context.idx = 3;
        context.data.openTime = new Series([3000]);
        context.strategy.pending_orders.push({
            id: 'Long5',
            direction: 1,
            qty: 10,
            type: 'limit',
            limit: 275.76,
            bar: 3,
            time: 3000,
            status: 'pending',
            category: 'entry',
        } satisfies Order);
        exit(context)('Exit 5', 'Long5', { limit: 284.36 });

        context.idx = 4;
        context.data.open = new Series([286.9]);
        context.data.high = new Series([288.73]);
        context.data.low = new Series([272.2]);
        context.data.close = new Series([279.48]);
        context.data.openTime = new Series([4000]);

        expect(processStrategyOrders(context)).toBe(1);
        const newEntry = context.strategy.opentrades.find((trade: Trade) => trade.entry_id === 'Long5');
        expect(newEntry).toMatchObject({
            entry_price: 275.76,
            _activation_entry_path_segment: 1,
        });
        expect(processExitOrders(context)).toBe(0);
        expect(context.strategy.closedtrades).toHaveLength(0);

        // The close evaluation refreshes Exit 5 after Long5 exists. Its new
        // 284.15 level becomes eligible on the following bar's upward cross.
        exit(context)('Exit 5', 'Long5', { limit: 284.15 });
        context.idx = 5;
        context.data.open = new Series([279.49]);
        context.data.high = new Series([284.3]);
        context.data.low = new Series([275.1]);
        context.data.close = new Series([283.39]);
        context.data.openTime = new Series([5000]);

        expect(processExitOrders(context)).toBe(1);
        expect(allocation(context)).toMatchObject([{ entryId: 'L1', qty: 10 }]);
        expect(context.strategy.closedtrades[0].exit_price).toBeCloseTo(284.15);
    });

    it.each([
        { direction: 1, open: 90, high: 105, low: 80, close: 95, limit: 100 },
        { direction: -1, open: 110, high: 120, low: 95, close: 105, limit: 100 },
    ])('fills a marketable $direction limit entry at the favorable open', ({ direction, open, high, low, close, limit }) => {
        const context = makeContext();
        context.idx = 1;
        context.data.open = new Series([open]);
        context.data.high = new Series([high]);
        context.data.low = new Series([low]);
        context.data.close = new Series([close]);
        context.data.openTime = new Series([1000]);
        const order: Order = {
            id: 'gap-entry',
            direction,
            qty: 1,
            type: 'limit',
            limit,
            bar: 0,
            time: 0,
            status: 'pending',
            category: 'entry',
        };
        context.strategy.pending_orders = [order];
        const fills = processStrategyOrders(context);
        expect({ fills, status: order.status, pending: context.strategy.pending_orders.length }).toEqual({
            fills: 1,
            status: 'filled',
            pending: 0,
        });
        expect(order.fill_price).toBe(open);
        expect(context.strategy.opentrades[0]).toMatchObject({
            entry_price: open,
            _activation_entry_path_segment: -1,
        });
    });

});
