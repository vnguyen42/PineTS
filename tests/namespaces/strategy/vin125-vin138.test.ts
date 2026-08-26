import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { cancel } from '../../../src/namespaces/strategy/methods/cancel';
import {
    initializeStrategy,
    openTrade,
    processExitOrders,
    processStrategyOrders,
} from '../../../src/namespaces/strategy/utils';
import { Order } from '../../../src/namespaces/strategy/types';

function makeContext(config: Record<string, unknown> = {}) {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'NASDAQ:TEST',
        timeframe: 'D',
    });
    context.pine.syminfo = { type: 'stock', mintick: 0.01, pointvalue: 1 };
    context.pineVersion = 4;
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, ...config });
    setBar(context, 0, 100, 101, 99, 100);
    return context;
}

function setBar(context: Context, idx: number, open: number, high: number, low: number, close: number) {
    context.idx = idx;
    context.data.open = new Series([open]);
    context.data.high = new Series([high]);
    context.data.low = new Series([low]);
    context.data.close = new Series([close]);
    context.data.openTime = new Series([idx * 86_400_000]);
}

function openPosition(context: Context, entryId: string, direction: 1 | -1, price = 100) {
    openTrade(context, entryId, direction, 1, price, context.idx * 86_400_000);
}
function fillReversal(
    context: Context,
    entryId: string,
    direction: 'long' | 'short' = 'short',
    exitPhase: 'intrabar' | 'close' = 'intrabar',
) {
    entry(context)(entryId, direction);
    const fillBar = context.idx + 1;
    setBar(context, fillBar, 100, 102, 98, 100);
    expect(processStrategyOrders(context)).toBe(1);
    return processExitOrders(context, exitPhase);
}

function exitOrders(context: Context): Order[] {
    return context.strategy!.pending_orders.filter((order) => order.category === 'exit');
}

describe('VIN-125 strategy.exit call-time binding', () => {
    it('covers activation and pending-entry binding branches', () => {
        const active = makeContext();
        openPosition(active, 'L', 1);
        exit(active)('active', { profit: 10 });
        const activeOrder = exitOrders(active)[0];
        expect(activeOrder._exit_bound_direction).toBe(1);
        expect(activeOrder._exit_bound_activation_ids).toHaveLength(1);

        const pending = makeContext();
        entry(pending)('L', 'long');
        exit(pending)('pending', { profit: 10 });
        const pendingOrder = exitOrders(pending)[0];
        expect(pendingOrder._exit_bound_direction).toBe(1);
        expect(pendingOrder._exit_bound_entry_ids).toEqual(['L']);
    });

    it('lets a wildcard orphan bind an entry submitted later in the same evaluation', () => {
        const context = makeContext();
        exit(context)('same-eval', { profit: 10 });
        expect(exitOrders(context)[0]._exit_bound_activation_ids).toBeUndefined();
        entry(context)('L', 'long');
        setBar(context, 1, 100, 102, 98, 100);
        expect(processStrategyOrders(context)).toBe(1);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades).toHaveLength(1);
    });

    it('kills a wildcard orphan before an entry submitted on a later bar', () => {
        const context = makeContext();
        exit(context)('cross-bar', { profit: 10 });
        setBar(context, 1, 100, 101, 99, 100);
        expect(processExitOrders(context)).toBe(0);
        expect(exitOrders(context)).toHaveLength(0);
        entry(context)('L', 'long');
        setBar(context, 2, 100, 102, 98, 100);
        expect(processStrategyOrders(context)).toBe(1);
        expect(processExitOrders(context)).toBe(0);
        expect(context.strategy!.closedtrades).toHaveLength(0);
    });
    it('does not attach an explicit pending exit to a later pyramiding activation', () => {
        const context = makeContext({ pyramiding: 2 });
        entry(context)('L', 'long', { limit: 90 });
        exit(context)('X', 'L', { limit: 105 });

        setBar(context, 1, 100, 101, 99, 100);
        expect(processStrategyOrders(context)).toBe(0);
        expect(processExitOrders(context)).toBe(0);
        expect(exitOrders(context)).toHaveLength(0);

        setBar(context, 2, 100, 110, 89, 100);
        expect(processStrategyOrders(context)).toBe(1);
        expect(processExitOrders(context)).toBe(0);
        expect(context.strategy!.position_size).toBe(1);
        expect(context.strategy!.closedtrades).toHaveLength(0);
    });
    it('does not migrate a persistent break-even bracket to a reversal', () => {
        const context = makeContext();
        openPosition(context, 'L', 1);
        exit(context)('BE', { stop: 100 }, { __callsiteId: 'be-site' });
        setBar(context, 1, 100, 101, 99, 100);
        exit(context)('BE', { stop: 100 }, { __callsiteId: 'be-site' });

        expect(fillReversal(context, 'R')).toBe(0);
        expect(context.strategy!.closedtrades).toHaveLength(1);
        expect(context.strategy!.opentrades[0].size).toBe(-1);
    });

    it('does not gap-fill a wildcard bracket on the opposite reversal', () => {
        const context = makeContext();
        openPosition(context, 'L', 1);
        exit(context)('gap', { profit: 100 });
        entry(context)('R', 'short');
        setBar(context, 1, 90, 95, 85, 90);

        expect(processStrategyOrders(context)).toBe(1);
        expect(processExitOrders(context)).toBe(0);
        expect(context.strategy!.closedtrades).toHaveLength(1);
        expect(context.strategy!.opentrades[0].size).toBe(-1);
    });

    it('does not intrabar-fill a sparse wildcard bracket on the opposite reversal', () => {
        const context = makeContext();
        openPosition(context, 'L', 1);
        exit(context)('sparse', { profit: 10 });
        entry(context)('R', 'short');
        setBar(context, 1, 100, 102, 98, 100);

        expect(processStrategyOrders(context)).toBe(1);
        expect(processExitOrders(context)).toBe(0);
        expect(context.strategy!.closedtrades).toHaveLength(1);
        expect(context.strategy!.opentrades[0].size).toBe(-1);
    });

    it('refreshes the same ID on one bar without losing the call-time binding', () => {
        const context = makeContext();
        openPosition(context, 'L', 1);
        exit(context)('refresh', { profit: 10 }, { __callsiteId: 'refresh-site' });
        exit(context)('refresh', { profit: 10 }, { __callsiteId: 'refresh-site' });
        expect(fillReversal(context, 'R')).toBe(0);
        expect(context.strategy!.closedtrades).toHaveLength(1);
        expect(context.strategy!.opentrades[0].size).toBe(-1);
    });

    it('allows cancel then recreates a fresh bracket for the new direction', () => {
        const context = makeContext();
        openPosition(context, 'L', 1);
        exit(context)('X', { profit: 10 });
        cancel(context)('X');
        expect(exitOrders(context)).toHaveLength(0);

        entry(context)('R', 'short');
        setBar(context, 1, 100, 102, 98, 100);
        expect(processStrategyOrders(context)).toBe(1);
        exit(context)('X', { profit: 10 });
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades).toHaveLength(2);
        expect(context.strategy!.closedtrades[1].exit_id).toBe('X');
    });

    it('creates a new binding after an order filled and the same ID is reused', () => {
        const context = makeContext();
        openPosition(context, 'L', 1);
        exit(context)('X', { profit: 10 });
        setBar(context, 1, 100, 102, 98, 100);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades).toHaveLength(1);

        setBar(context, 2, 100, 101, 99, 100);
        openPosition(context, 'L2', 1);
        exit(context)('X', { profit: 10 });
        setBar(context, 3, 100, 102, 98, 100);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades).toHaveLength(2);
    });
});

describe('VIN-138 explicit binding and close-phase fills', () => {
    it('does not migrate an explicit from_entry bracket to a reversal', () => {
        const context = makeContext();
        openPosition(context, 'E', -1);
        exit(context)('X', 'E', { profit: 10 });
        expect(fillReversal(context, 'E', 'long')).toBe(0);
        expect(context.strategy!.closedtrades).toHaveLength(1);
        expect(context.strategy!.opentrades[0].size).toBe(1);
    });

    it('attaches an explicit bracket to a pending entry captured at call time', () => {
        const context = makeContext();
        entry(context)('L', 'long');
        exit(context)('X', 'L', { stop: 99 });
        setBar(context, 1, 100, 101, 98, 100);
        expect(processStrategyOrders(context)).toBe(1);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades).toHaveLength(1);
        expect(context.strategy!.closedtrades[0].exit_price).toBe(99);
    });

    it('fills a current close-phase stop at close minus adverse slippage', () => {
        const context = makeContext({ process_orders_on_close: true, slippage: 2 });
        setBar(context, 0, 100, 101, 99, 100);
        openPosition(context, 'L', 1);
        exit(context)('close-stop', 'L', { stop: 99 }, { __callsiteId: 'close-site' });
        cancel(context)('close-stop');

        setBar(context, 1, 100, 110, 95, 98);
        exit(context)('close-stop', 'L', { stop: 99 }, { __callsiteId: 'close-site' });
        expect(processExitOrders(context, 'close')).toBe(1);
        expect(context.strategy!.closedtrades[0].exit_price).toBe(97.98);
    });

    it('does not replay a passed low when the current close is back above the stop', () => {
        const context = makeContext({ process_orders_on_close: true, slippage: 2 });
        setBar(context, 0, 100, 110, 95, 100);
        openPosition(context, 'L', 1);
        exit(context)('close-stop', 'L', { stop: 99 });

        expect(processExitOrders(context, 'close')).toBe(0);
        expect(exitOrders(context)).toHaveLength(1);
        expect(context.strategy!.closedtrades).toHaveLength(0);
    });

    it('keeps a non-marketable close-phase conditional pending', () => {
        const context = makeContext({ process_orders_on_close: true, slippage: 2 });
        setBar(context, 0, 100, 101, 100, 101);
        openPosition(context, 'L', 1);
        exit(context)('close-stop', 'L', { stop: 99 });

        expect(processExitOrders(context, 'close')).toBe(0);
        expect(exitOrders(context)).toHaveLength(1);
        expect(exitOrders(context)[0].status).toBe('pending');
    });
});
