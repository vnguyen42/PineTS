import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { close } from '../../../src/namespaces/strategy/methods/close';
import { close_all } from '../../../src/namespaces/strategy/methods/close_all';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { initializeStrategy } from '../../../src/namespaces/strategy/utils';
import { Order, Trade } from '../../../src/namespaces/strategy/types';

/**
 * SAME_BAR_CLOSE_ALL_SAME_SIDE_REENTRY (1825).
 *
 * TradingView evaluates an entry queued in the same script evaluation as a
 * market close against the position and pyramiding book after that close.
 * The close/close_all order is bound to its call-time trade IDs, so a full
 * close frees its activation while a partial close only frees the quantity
 * actually closed and must not free a whole pyramiding slot.
 */

function makeContext(config: Record<string, unknown> = {}): Context {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'TEST',
        timeframe: 'D',
    });
    context.idx = 10;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([10_000]);
    context.pine.syminfo = { mintick: 0.01, pointvalue: 1, type: 'stock' };
    initializeStrategy(context, { pyramiding: 1, ...config });
    return context;
}

function makeTrade(id: string, entryId: string, size = 1): Trade {
    return {
        id,
        entry_id: entryId,
        entry_comment: entryId,
        entry_price: 100,
        entry_bar_index: 9,
        entry_time: 9_000,
        size,
        commission: 0,
        max_drawdown: 0,
        max_runup: 0,
        status: 'open',
    };
}

function setOpenTrades(context: Context, trades: Trade[]): void {
    const strategy = context.strategy;
    if (!strategy) throw new Error('strategy was not initialized');
    strategy.opentrades = trades;
    strategy.position_size = trades.reduce((sum, trade) => sum + trade.size, 0);
    strategy.position_avg_price = 100;
    strategy.position_entry_name = trades[0]?.entry_id ?? '';
}

function pendingEntry(context: Context): Order | undefined {
    return context.strategy?.pending_orders.find((order) => order.category === 'entry');
}

describe('SAME_BAR_CLOSE_ALL_SAME_SIDE_REENTRY (1825)', () => {
    it('projects a TP close_all before the same-bar buy (1616)', () => {
        const context = makeContext();
        setOpenTrades(context, [makeTrade('trade_tp', 'buy')]);

        close_all(context)('TP');
        entry(context)('buy', 'long');

        expect(context.strategy.pending_orders).toHaveLength(2);
        expect(context.strategy.pending_orders[0]._intended_trade_ids).toEqual(['trade_tp']);
        expect(pendingEntry(context)).toMatchObject({ qty: 1, _isReversalEntry: false });
    });

    it('does not project a conditional strategy.exit TP/SL close (o.profit !== undefined)', () => {
        const context = makeContext();
        setOpenTrades(context, [makeTrade('trade_tp_sl', 'buy')]);

        // A conditional exit (profit/loss set) is not a same-bar market
        // close: the projection stays off and the same-side entry still
        // hits the pyramiding cap against the call-time book (parent
        // behavior — the close was never projected either).
        exit(context)({ id: 'TP', from_entry: 'buy', profit: 100 });
        entry(context)('buy', 'long');

        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0]).toMatchObject({ id: 'TP', category: 'exit' });
        expect(pendingEntry(context)).toBeUndefined();
        expect(context.strategy.position_size).toBe(1);
    });
    it('does not run the projection under calc_on_order_fills=true (ledger identical to parent)', () => {
        const context = makeContext({ pyramiding: 1, calc_on_order_fills: true });
        setOpenTrades(context, [makeTrade('trade_cof', 'buy')]);

        close_all(context)('TP');
        entry(context)('buy', 'long');

        // COF skips the whole block: the entry is classified against the
        // call-time book (the parent only counted opentrades), so the
        // same-side entry is still rejected — no pending entry, no fill,
        // position untouched. The resulting ledger is exactly the parent's.
        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0]._intended_trade_ids).toEqual(['trade_cof']);
        expect(pendingEntry(context)).toBeUndefined();
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.opentrades).toHaveLength(1);
    });
    it('does not block an opposite-direction entry by the projection (reversal unchanged)', () => {
        const context = makeContext();
        setOpenTrades(context, [makeTrade('trade_long', 'buy')]);

        close_all(context)('TP');
        entry(context)('sell', 'short');

        // The close snapshot only frees same-side slots; the opposite entry
        // is classified exactly as before the projection existed — a
        // reversal sized on the full position (qty 2), never blocked by the
        // pyramiding cap (the cap applies to same-side adds only).
        expect(context.strategy.pending_orders).toHaveLength(2);
        expect(context.strategy.pending_orders[0]._intended_trade_ids).toEqual(['trade_long']);
        expect(pendingEntry(context)).toMatchObject({ direction: -1, qty: 2, _isReversalEntry: true });
    });
    it('does not trigger the projection for a close queued on an earlier bar (o.bar !== context.idx)', () => {
        const context = makeContext();
        setOpenTrades(context, [makeTrade('trade_close', 'buy')]);

        close(context)('buy');
        context.strategy.pending_orders[0].bar = 9; // queued on the previous bar

        entry(context)('buy', 'long');

        // A stale close is not a same-bar market close: no projection, so
        // the same-side entry hits the pyramiding cap against the call-time
        // book and is not queued.
        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0]._intended_trade_ids).toEqual(['trade_close']);
        expect(pendingEntry(context)).toBeUndefined();
        expect(context.strategy.position_size).toBe(1);
    });

    it('projects strategy.close before a same-direction entry (1825)', () => {
        const context = makeContext();
        setOpenTrades(context, [makeTrade('trade_close', 'buy')]);

        close(context)('buy');
        entry(context)('buy', 'long');

        expect(context.strategy.pending_orders).toHaveLength(2);
        expect(context.strategy.pending_orders[0]._intended_trade_ids).toEqual(['trade_close']);
        expect(pendingEntry(context)).toMatchObject({ qty: 1, _isReversalEntry: false });
    });

    it('does not free a whole pyramiding slot for a partial close', () => {
        const context = makeContext({ pyramiding: 2 });
        setOpenTrades(context, [makeTrade('trade_a', 'a'), makeTrade('trade_b', 'b')]);

        close(context)('a', { qty: 0.5 });

        entry(context)('c', 'long');

        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0]).toMatchObject({
            id: 'close_a',
            qty: 0.5,
            _intended_trade_ids: ['trade_a'],
        });
        expect(pendingEntry(context)).toBeUndefined();
    });
});
