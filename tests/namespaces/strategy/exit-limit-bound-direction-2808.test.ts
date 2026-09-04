// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille : EXIT_LIMIT_BOUND_DIRECTION — id révélateur 2808
// A strategy.exit() limit bound to a pending long reversal must use the
// pending entry's direction for placement rounding, even while the outgoing
// position is short. TradingView fills 554.0896956091999 at 554.09 on a
// 0.01 grid; the pre-fix global-position rule records 554.08.
import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { initializeStrategy, openTrade, processExitOrders, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import type { StrategyState } from '../../../src/namespaces/strategy/types';

type StrategyContext = Context & { strategy: StrategyState };

function strategyOf(context: Context): StrategyState {
    if (!context.strategy) throw new Error('strategy state was not initialized');
    return context.strategy;
}

function makeContext(): StrategyContext {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'BINANCE:AAVEUSDT',
        timeframe: 'D',
    });
    context.idx = 0;
    context.data.open = new Series([554.08]);
    context.data.high = new Series([554.08]);
    context.data.low = new Series([554.08]);
    context.data.close = new Series([554.08]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick: 0.01, pointvalue: 1, type: 'crypto' };
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
    openTrade(context, 'Short', -1, 1, 554.08, 0);
    return context as StrategyContext;
}

function setReversalBar(context: StrategyContext): void {
    context.idx = 1;
    context.data.open = new Series([554.08, 554.08]);
    context.data.high = new Series([554.08, 554.10]);
    context.data.low = new Series([554.08, 554.07]);
    context.data.close = new Series([554.08, 554.09]);
    context.data.openTime = new Series([0, 86_400_000]);
}

describe('EXIT_LIMIT_BOUND_DIRECTION (2808)', () => {
    it('rounds and fills a pending long reversal limit upward while the outgoing position is short', () => {
        const context = makeContext();
        const placeEntry = entry(context);
        placeEntry('Long', 'long', { qty: 1 });

        const placeExit = exit(context);
        placeExit('Take Profit', 'Long', { limit: 554.0896956091999 });

        const pendingExit = strategyOf(context).pending_orders.find(
            (order) => order.category === 'exit' && order.status === 'pending' && order.id === 'Take Profit',
        );
        if (!pendingExit) throw new Error('exit order was not queued');
        expect(pendingExit.limit).toBe(554.09);

        setReversalBar(context);
        expect(processStrategyOrders(context)).toBe(1);
        expect(strategyOf(context).position_size).toBe(1);
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(strategyOf(context).closedtrades).toHaveLength(2);
        expect(strategyOf(context).closedtrades[1]).toMatchObject({
            entry_id: 'Long',
            exit_price: 554.09,
        });
    });
});
