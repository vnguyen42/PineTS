// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Family: ULP-scale residual on a reducing order (same rule as
// same-bar-zero-qty-residual-2285 on the close leg) — revealing id 1799
// ("Zendog V3 DCA bot"). Its take-profit closes the deal with
// `qty = math.abs(strategy.position_size)`: lots 0.14792 + 0.10675 + 0.11015
// sum in float to 0.3648199999999999, the order quantizes to the 1e-5 step
// 0.36482, and the 5.55e-17 difference was booked as a new SHORT lot that
// stalled every later deal (TV: flat; 447 closed trades vs the engine's 32).

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { calculateOrderQty, initializeStrategy, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import type { Order, Trade } from '../../../src/namespaces/strategy/types';

function lot(id: string, size: number, entryBar: number): Trade {
    return {
        id, entry_id: id, entry_comment: id, entry_price: 6500, _bracket_entry: 6500,
        entry_bar_index: entryBar, entry_time: entryBar * 1000, size,
        commission: 0, max_drawdown: 0, max_runup: 0, status: 'open',
    };
}

describe('a reducing order does not book a ULP-scale reversal lot (1799)', () => {
    it('closes three float-summed lots flat', () => {
        const context: any = new Context({ marketData: [], source: [], tickerId: 'BTCUSDT', timeframe: '240' } as any);
        context.pine = { qtyStep: 0.00001, syminfo: { mintick: 0.01, pointvalue: 1 } };
        initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, pyramiding: 99 });
        const strategy = context.strategy;
        strategy.opentrades = [lot('BO', 0.14792, 1), lot('SO1', 0.10674999999999998, 2), lot('SO2', 0.11014999999999998, 3)];
        strategy.position_size = strategy.opentrades.reduce((sum: number, trade: Trade) => sum + trade.size, 0);
        strategy.position_avg_price = 6500;
        expect(strategy.position_size).toBe(0.3648199999999999);

        context.idx = 4;
        context.data.open = new Series([6700]);
        context.data.high = new Series([6710]);
        context.data.low = new Series([6690]);
        context.data.close = new Series([6700]);
        context.data.openTime = new Series([4000]);
        const qty = calculateOrderQty(context, Math.abs(strategy.position_size), -1, 6700);
        // The quantized order exceeds the float position by a few ulps.
        expect(qty).toBeGreaterThan(strategy.position_size);
        expect(qty - strategy.position_size).toBeLessThan(1e-15);
        strategy.pending_orders.push({ id: 'TP', direction: -1, qty, type: 'market', bar: 3, time: 3000, status: 'pending' } as Order);

        expect(processStrategyOrders(context)).toBe(1);
        expect(strategy.closedtrades).toHaveLength(3);
        expect(strategy.opentrades).toHaveLength(0);
        expect(strategy.position_size).toBe(0);
    });
});
