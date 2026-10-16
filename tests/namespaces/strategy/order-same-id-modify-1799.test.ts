// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Family: strategy.order same-ID modification — revealing id 1799 ("Zendog V3
// DCA bot"): its take-profit `strategy.order(id = 'D1-TP', direction = short,
// qty = math.abs(strategy.position_size), limit = …, when = is_deal_started())`
// is resubmitted on every bar of a deal. Pine reference, strategy.order: "If an
// order with the same ID is already pending, it is possible to modify the
// order." The engine pushed a new order per call; every stale copy filled and
// flipped the closed deal into a short position (TV ledger: one fill, flat).

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { initializeStrategy, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { order } from '../../../src/namespaces/strategy/methods/order';

function setBar(context: any, idx: number, price: number) {
    context.idx = idx;
    context.data.open = new Series([price]);
    context.data.high = new Series([price + 1]);
    context.data.low = new Series([price - 1]);
    context.data.close = new Series([price]);
    context.data.openTime = new Series([idx * 86_400_000]);
}

describe('strategy.order modifies the pending order of the same ID (1799)', () => {
    it('two calls with one ID leave one order: the later spec', () => {
        const context: any = new Context({ marketData: [], source: [], tickerId: 'BTCUSDT', timeframe: 'D' } as any);
        context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } };
        initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, pyramiding: 5 });
        setBar(context, 0, 100);
        entry(context)('L', 'long', 1);
        setBar(context, 1, 100);
        processStrategyOrders(context);
        expect(context.strategy.position_size).toBe(1);

        // Same bar, same ID, resubmitted with the position's size (1799's TP).
        order(context)('TP', 'short', 1, 150);
        order(context)('TP', 'short', 1, 120);
        expect(context.strategy.pending_orders.filter((o: any) => o.status === 'pending' && o.id === 'TP')).toHaveLength(1);
        expect(context.strategy.pending_orders.find((o: any) => o.status === 'pending' && o.id === 'TP').limit).toBe(120);

        setBar(context, 2, 160);
        processStrategyOrders(context);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.opentrades).toHaveLength(0);
    });

    it('an unchanged stop-limit resubmitted every bar keeps its activated limit', () => {
        const context: any = new Context({ marketData: [], source: [], tickerId: 'BTCUSDT', timeframe: 'D' } as any);
        context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } };
        initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
        const bars = [[100, 100.5, 99.5, 100], [100, 102, 99, 101], [100, 100.5, 97, 98], [98, 99, 97, 98]];
        bars.forEach(([o, h, l, c], i) => {
            context.idx = i;
            context.data.open = new Series([o]);
            context.data.high = new Series([h]);
            context.data.low = new Series([l]);
            context.data.close = new Series([c]);
            context.data.openTime = new Series([i * 86_400_000]);
            if (i > 0) processStrategyOrders(context);
            order(context)('O', 'long', 1, { limit: 98, stop: 101 });
        });
        // Stop 101 crossed on bar 1 activates the limit 98, filled on bar 2.
        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(98);
        expect(context.strategy.opentrades[0].entry_bar_index).toBe(2);
    });
});
