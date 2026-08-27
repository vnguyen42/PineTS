import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { StrategyState } from '../../../src/namespaces/strategy/types';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { initializeStrategy, openTrade, processExitOrders, processStrategyOrders } from '../../../src/namespaces/strategy/utils';

// Famille : bracket strategy.exit sur entrée reversal — VIN-77, révélateur
// 2808, fix 20eeccb. An absolute stop/limit bracket submitted alongside an
// opposite strategy.entry must attach to the newly opened reversal position;
// it must not be discarded because its levels were captured before the fill.

function strategyOf(context: Context): StrategyState {
    if (!context.strategy) throw new Error('strategy state was not initialized');
    return context.strategy;
}

function makeContext() {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'BTCUSDT',
        timeframe: 'D',
    });
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick: 0.01, pointvalue: 1, type: 'crypto' };
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
    openTrade(context, 'S', -1, 1, 110, 0);
    return context;
}

function setFillBar(context: Context) {
    context.idx = 1;
    context.data.open = new Series([100, 100]);
    context.data.high = new Series([101, 102]);
    context.data.low = new Series([99, 94]);
    context.data.close = new Series([100, 96]);
    context.data.openTime = new Series([0, 86_400_000]);
}

describe('VIN-77 reversal entry bracket (2808, 20eeccb)', () => {
    it('keeps the reversal position bracket and closes it at its stop', () => {
        const context = makeContext();
        const strategy = strategyOf(context);

        entry(context)('L', 'long');
        exit(context)('LX', 'L', { stop: 95, limit: 110 });
        setFillBar(context);

        expect(processStrategyOrders(context)).toBe(1);
        expect(strategy.position_size).toBe(1);
        expect(strategy.closedtrades).toHaveLength(1); // outgoing short

        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(strategy.position_size).toBe(0);
        expect(strategy.closedtrades).toHaveLength(2);
        expect(strategy.closedtrades[1]).toMatchObject({
            exit_id: 'LX',
            exit_price: 95,
            size: 1,
        });
        expect(strategy.pending_orders).toHaveLength(0);
    });
});
