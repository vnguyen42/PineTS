import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import type { Trade } from '../../../src/namespaces/strategy/types';
import { close_all } from '../../../src/namespaces/strategy/methods/close_all';
import { closePartialPosition, initializeStrategy, processExitOrders } from '../../../src/namespaces/strategy/utils';

function makeContext(): Context {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'VIRTUALUSDT',
        timeframe: '15',
    });
    context.pine = { qtyStep: 0.001, syminfo: { mintick: 0.0001, pointvalue: 1 } };
    initializeStrategy(context, { close_entries_rule: 'FIFO', pyramiding: 999 });
    return context;
}

function setBar(context: Context, idx: number, price: number) {
    context.idx = idx;
    context.data.open = new Series([price]);
    context.data.high = new Series([price]);
    context.data.low = new Series([price]);
    context.data.close = new Series([price]);
    context.data.openTime = new Series([idx * 1000]);
}

function lot(id: string, size: number, entryBar: number): Trade {
    return {
        id,
        entry_id: 'Buy',
        entry_comment: 'Buy',
        entry_price: 0.5703,
        _bracket_entry: 0.5703,
        entry_bar_index: entryBar,
        entry_time: entryBar * 1000,
        size,
        commission: 0,
        max_drawdown: 0,
        max_runup: 0,
        status: 'open',
    };
}

describe('same-bar-zero-qty-residual — script 2285 FIFO close_all', () => {
    it('does not book a sub-qtyStep residual from a same-bar close_all fill', () => {
        const context = makeContext();
        const strategy = context.strategy;
        if (strategy === undefined) throw new Error('strategy state was not initialized');
        const oldLots = [
            lot('trade_224', 47.284, 21066),
            lot('trade_225', 47.301, 21067),
            lot('trade_226', 47.35, 21068),
        ];
        strategy.opentrades = oldLots;
        strategy.position_size = oldLots.reduce((sum: number, trade: Trade) => sum + trade.size, 0);
        strategy.position_avg_price = 0.5703;
        strategy.position_entry_name = 'Buy';

        // Script 2285 queues close_all on bar 21068. Its next-bar entry is
        // already filled before the close_all at bar 21069, but is not part of
        // the close_all call-time snapshot.
        setBar(context, 21068, 0.5708);
        close_all(context)();
        strategy.opentrades.push(lot('trade_227', 47.383, 21069));
        strategy.position_size += 47.383;
        strategy.position_avg_price = 0.5703;
        setBar(context, 21069, 0.5703);

        expect(processExitOrders(context)).toBe(1);
        expect(strategy.closedtrades.map((trade: Trade) => Math.abs(trade.size))).toEqual([47.284, 47.301, 47.35]);
        expect(strategy.closedtrades.every((trade: Trade) => trade.entry_bar_index !== trade.exit_bar_index)).toBe(true);
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].size).toBe(47.383);
        expect(strategy.position_size).toBeCloseTo(47.383, 12);
    });

    it('keeps a legitimate sub-qtyStep forced liquidation booked and synchronized', () => {
        const context = makeContext();
        const strategy = context.strategy;
        if (strategy === undefined) throw new Error('strategy state was not initialized');
        const forcedLot = lot('trade_margin', 0.001, 21068);
        strategy.opentrades = [forcedLot];
        strategy.position_size = forcedLot.size;
        strategy.position_avg_price = forcedLot.entry_price;
        strategy.position_entry_name = forcedLot.entry_id;
        setBar(context, 21069, 0.5703);

        closePartialPosition(context, 0.0004, 0.5703, 21069 * 1000);

        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].size).toBe(0.0004);
        expect(strategy.opentrades).toHaveLength(1);
        const openQty = strategy.opentrades.reduce((sum: number, trade: Trade) => sum + Math.abs(trade.size), 0);
        expect(strategy.position_size).toBe(openQty);
        expect(strategy.position_size).toBeCloseTo(0.0006, 15);
    });
});
