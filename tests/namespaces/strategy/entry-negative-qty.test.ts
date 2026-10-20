// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// A negative explicit qty creates no order (strategy.entry and strategy.order).
// TradingView: "The order size must be positive; negative numbers will cause
// runtime errors" (support 43000478450); a risk-sized qty turns negative once
// the equity is below zero (support 43000651235). The engine used to trade
// |qty|, so an account below zero reopened ever larger positions (TradeSearcher
// 2270 "2 MA | Trend Following" on GC1! 1h: +6.99e303 %).

import { describe, it, expect } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Provider } from '../../../src/marketData/Provider.class';

const script = (call: string) => `//@version=5
strategy("negative qty", initial_capital = 1000)
size = bar_index % 12 == 1 ? 3 : -2
if bar_index % 6 == 1
    ${call}
if bar_index % 6 == 4
    strategy.close_all()
`;

async function sizes(source: string): Promise<number[]> {
    const engine = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2019-01-01').getTime(), new Date('2019-03-01').getTime());
    const context = await engine.run(source);
    return (context.strategy.closedtrades as { size: number }[]).map((trade) => trade.size);
}

describe('a negative explicit qty creates no order', () => {
    it.each([
        ['strategy.entry', 'strategy.entry("L", strategy.long, qty = size)'],
        ['strategy.order', 'strategy.order("L", strategy.long, qty = size)'],
    ])('%s: only the positive calls open a position, never |qty|', async (_label, call) => {
        const traded = await sizes(script(call));
        // Every other entry asks for -2: no order, so every trade is the +3 one.
        expect(traded.length).toBeGreaterThan(2);
        expect(traded.every((size) => size === 3)).toBe(true);
    });
});
