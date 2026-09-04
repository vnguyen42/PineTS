// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
// Family: INTRABAR_FILL_ORDERING — active exit before crossed pending entry (1828).
import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { initializeStrategy, processExitOrders, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import type { Trade } from '../../../src/namespaces/strategy/types';

type StrategyContext = Context & { strategy: NonNullable<Context['strategy']> };

function makeContext(): StrategyContext {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'BINANCE:XLMUSDT',
        timeframe: 'D',
    });
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([100]);
    context.data.low = new Series([100]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick: 0.0001, pointvalue: 1, type: 'crypto', prefix: 'BINANCE' };
    initializeStrategy(context, {
        pyramiding: 1,
        default_qty_type: 'fixed',
        default_qty_value: 1,
    });
    if (!context.strategy) throw new Error('strategy was not initialized');
    return context as StrategyContext;
}

function setBar(
    context: StrategyContext,
    idx: number,
    open: number,
    high: number,
    low: number,
    close: number,
) {
    context.idx = idx;
    context.data.open = new Series([open, open]);
    context.data.high = new Series([high, high]);
    context.data.low = new Series([low, low]);
    context.data.close = new Series([close, close]);
    context.data.openTime = new Series([idx * 86_400_000, idx * 86_400_000]);
}

function openTrade(id: string, entryId: string, size: number, price: number): Trade {
    return {
        id,
        entry_id: entryId,
        entry_comment: entryId,
        entry_price: price,
        entry_bar_index: 0,
        entry_time: 0,
        size,
        commission: 0,
        max_drawdown: 0,
        max_runup: 0,
        status: 'open',
    };
}

function seedPosition(context: StrategyContext, size: number, price: number) {
    const strategy = context.strategy;
    strategy.opentrades = [openTrade('seed-trade', 'seed', size, price)];
    strategy.position_size = size;
    strategy.position_avg_price = price;
    strategy.position_entry_name = 'seed';
}

function runCrossTypeScenario(
    seedSize: number,
    seedPrice: number,
    exitLevel: number,
    exitKind: 'stop' | 'limit',
    entryDirection: 'long' | 'short',
    entryLevel: number,
    entryQty: number,
    bar: { open: number; high: number; low: number; close: number },
): StrategyContext {
    const context = makeContext();
    seedPosition(context, seedSize, seedPrice);
    // Orders are submitted on the preceding bar, whose close is the seed
    // price. This keeps both price-based orders pending until bar 1.
    setBar(context, 0, seedPrice, seedPrice, seedPrice, seedPrice);

    // Match the source order: a pending opposite stop and the active bracket
    // coexist until the bar's assumed OHLC path reaches one of their levels.
    entry(context)('cross-entry', entryDirection, { qty: entryQty, stop: entryLevel });
    exit(context)(
        'active-exit',
        'seed',
        exitKind === 'stop' ? { stop: exitLevel } : { limit: exitLevel },
    );
    setBar(context, 1, bar.open, bar.high, bar.low, bar.close);

    // This is the non-COF bar scheduler used by the engine loop. The second
    // call lets the test observe the resulting ledger independent of whether
    // the first call already consumed a prioritized exit.
    processStrategyOrders(context);
    processExitOrders(context, 'intrabar');
    return context;
}

describe('INTRABAR_FILL_ORDERING 1828 cross-type entry-vs-exit', () => {
    it('serves the active short exit before the pending long stop on bar 474', () => {
        const context = runCrossTypeScenario(
            -3617,
            0.0576,
            0.0628,
            'stop',
            'long',
            0.0641,
            3250,
            { open: 0.05864, high: 0.0667, low: 0.05804, close: 0.06347 },
        );
        const strategy = context.strategy;

        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0]).toMatchObject({
            entry_id: 'seed',
            size: -3617,
            exit_id: 'active-exit',
            exit_bar_index: 1,
        });
        expect(strategy.closedtrades[0].exit_price).toBeCloseTo(0.0628, 12);
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0]).toMatchObject({
            entry_id: 'cross-entry',
            size: 3250,
            entry_price: 0.0641,
            entry_bar_index: 1,
        });
    });

    it('serves the active long exit before the pending short stop on bar 794', () => {
        const context = runCrossTypeScenario(
            2318,
            0.1059,
            0.1086,
            'limit',
            'short',
            0.0854,
            2875,
            { open: 0.10756, high: 0.11629, low: 0.08443, close: 0.10251 },
        );
        const strategy = context.strategy;

        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0]).toMatchObject({
            entry_id: 'seed',
            size: 2318,
            exit_id: 'active-exit',
            exit_bar_index: 1,
        });
        expect(strategy.closedtrades[0].exit_price).toBeCloseTo(0.1086, 12);
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0]).toMatchObject({
            entry_id: 'cross-entry',
            size: -2875,
            entry_price: 0.0854,
            entry_bar_index: 1,
        });
    });
});
