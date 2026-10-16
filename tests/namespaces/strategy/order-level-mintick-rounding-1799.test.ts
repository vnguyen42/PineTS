// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Family: round-to-mintick of strategy.order levels — revealing id 1799
// ("Zendog V3 DCA bot", BINANCE:BTCUSDT 240): its take-profit
// `strategy.order(limit = position_avg_price × 1.02)` filled at the raw
// 4104.2534388048 where TV's ledger shows 4104.26 (and 4160.57, 3961.40,
// 3401.88, … on every take-profit deal). strategy.entry already snaps its
// levels away from the signal bar's close (roundToMintick); strategy.order did
// not. The canonical rounding cases live with roundToMintick's own tests; here
// only that strategy.order applies it to its limit (the stop is unproven).

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { initializeStrategy } from '../../../src/namespaces/strategy/utils';
import { order } from '../../../src/namespaces/strategy/methods/order';

describe('strategy.order snaps its limit to the mintick grid (1799)', () => {
    it('rounds away from the signal bar close', () => {
        const context: any = new Context({ marketData: [], source: [], tickerId: 'BTCUSDT', timeframe: '240' } as any);
        context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } };
        initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
        context.idx = 0;
        context.data.open = new Series([4000]);
        context.data.high = new Series([4010]);
        context.data.low = new Series([3990]);
        context.data.close = new Series([4000]);
        context.data.openTime = new Series([0]);

        const sellLimit = order(context)('TP', 'short', 0.5, 4104.2534388048);
        const buyLimit = order(context)('BL', 'long', 0.5, 3901.2389);
        expect(sellLimit.limit).toBeCloseTo(4104.26, 10);
        expect(buyLimit.limit).toBeCloseTo(3901.23, 10);
        // On-grid level unchanged.
        expect(order(context)('X', 'short', 0.5, 4104.26).limit).toBe(4104.26);
    });

    it('under calc_on_order_fills a pure limit rounds against the current tick', () => {
        const context: any = new Context({ marketData: [], source: [], tickerId: 'BTCUSDT', timeframe: '240' } as any);
        context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } };
        initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, calc_on_order_fills: true });
        context.idx = 0;
        context.data.open = new Series([100]);
        context.data.high = new Series([101]);
        context.data.low = new Series([95]);
        context.data.close = new Series([100]);
        context.data.openTime = new Series([0]);
        // Recalculation at the low tick (95): 96.003 lies above it, so it rounds up.
        context.strategy._cof = { pass: 1, ticks: [100, 95, 101, 100] };
        expect(order(context)('C', 'long', 1, 96.003).limit).toBeCloseTo(96.01, 10);
    });
});
