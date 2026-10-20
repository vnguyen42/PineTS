// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// A negative explicit qty (strategy.entry and strategy.order). TradingView:
// "The order size must be positive; negative numbers will cause runtime
// errors" (support 43000478450, "Cannot create an order with negative
// quantity", 43000651235). While the equity is above zero the run stops with
// that error; once it is at or below zero (a risk-sized qty turns negative
// there) the order is dropped: the engine used to trade |qty|, so an account
// below zero reopened ever larger positions (TradeSearcher 2270 "2 MA | Trend
// Following" on GC1! 1h: +6.99e303 %).

import { describe, it, expect } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Provider } from '../../../src/marketData/Provider.class';
import { PineRuntimeError } from '../../../src/errors/PineRuntimeError';

const run = async (source: string) => {
    const engine = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2019-01-01').getTime(), new Date('2019-03-01').getTime());
    return engine.run(source);
};

const calls = [
    ['strategy.entry', 'strategy.entry("L", strategy.long, qty = size)'],
    ['strategy.order', 'strategy.order("L", strategy.long, qty = size)'],
];

describe('a negative explicit qty', () => {
    it.each(calls)('%s: a runtime error while the equity is above zero', async (_label, call) => {
        const source = `//@version=5
strategy("negative qty", initial_capital = 1000)
size = bar_index == 3 ? -2 : 1
if bar_index % 6 == 1 or bar_index == 3
    ${call}
if bar_index % 6 == 4
    strategy.close_all()
`;
        const error = await run(source).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(PineRuntimeError);
        expect((error as Error).message).toBe('Cannot create an order with negative quantity.');
    });

    it.each(calls)('%s: no order once the equity is at or below zero, never |qty|', async (_label, call) => {
        // 10 000 units on 1 000 of capital: the first trade loses more than the capital; the
        // risk-sized size that follows is negative and must open nothing.
        const source = `//@version=5
strategy("ruin", initial_capital = 1000)
size = strategy.equity > 0 ? 10000 : strategy.equity
if bar_index % 4 == 1
    ${call}
if bar_index % 4 == 3
    strategy.close_all()
`;
        const context = await run(source);
        const trades = context.strategy.closedtrades as { size: number }[];
        const ruined = context.strategy.equity <= 0;
        expect(ruined).toBe(true);
        expect(trades.length).toBeGreaterThan(0);
        expect(trades.every((trade) => trade.size === 10000)).toBe(true);
    });
});
