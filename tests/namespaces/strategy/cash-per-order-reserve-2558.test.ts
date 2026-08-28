import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { calculateOrderQty, initializeStrategy } from '../../../src/namespaces/strategy/utils';

describe('cash_per_order reserve in percent-of-equity sizing — script 2558', () => {
    it('reserves the flat commission before calculating quantity', () => {
        const context = new Context({
            marketData: [],
            source: [],
            tickerId: 'AMAT',
            timeframe: '15',
        });
        context.idx = 0;
        context.data.open = new Series([142.70]);
        context.data.high = new Series([142.70]);
        context.data.low = new Series([142.70]);
        context.data.close = new Series([142.70]);
        context.data.openTime = new Series([0]);
        context.pine.syminfo = { mintick: 0.01, pointvalue: 1 };
        context.pine.qtyStep = 1;
        initializeStrategy(context, {
            default_qty_type: 'percent_of_equity',
            default_qty_value: 90,
            initial_capital: 20462.8,
            commission_type: 'cash_per_order',
            commission_value: 50,
        });
        if (!context.strategy) throw new Error('strategy test context was not initialized');
        context.strategy.equity = 20462.8;

        // floor((20462.8 × 90% − 50) / 142.70) = 128;
        expect(calculateOrderQty(context, undefined, 1, 142.70)).toBe(128);
    });
});
