import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { StrategyState } from '../../../src/namespaces/strategy/types';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { initializeStrategy, processStrategyOrders, roundToMintick } from '../../../src/namespaces/strategy/utils';

// Famille : trailing stock sur prix affichés — VIN-136, révélateur 1565,
// fix 2bad8f1. TradingView evaluates stock stop triggers on the displayed
// nearest-tick OHLC view, not on the raw feed values. The four canonical
// rounding cases below are all exercised through an observable entry fill.

function strategyOf(context: Context): StrategyState {
    if (!context.strategy) throw new Error('strategy state was not initialized');
    return context.strategy;
}

function makeContext(currentClose: number, mintick: number) {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'STOCK',
        timeframe: 'D',
    });
    context.idx = 0;
    context.data.open = new Series([currentClose]);
    context.data.high = new Series([currentClose]);
    context.data.low = new Series([currentClose]);
    context.data.close = new Series([currentClose]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick, pointvalue: 1, type: 'stock' };
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
    return context;
}

function setBar(context: Context, open: number, high: number, low: number, close: number) {
    context.idx = 1;
    context.data.open = new Series([0, open]);
    context.data.high = new Series([0, high]);
    context.data.low = new Series([0, low]);
    context.data.close = new Series([0, close]);
    context.data.openTime = new Series([0, 86_400_000]);
}

type DisplayCase = {
    name: string;
    currentClose: number;
    mintick: number;
    stop: number;
    bar: { open: number; high: number; low: number; close: number };
    expected: number;
};

const cases: DisplayCase[] = [
    {
        name: 'exact-grid high with binary noise is displayed on the stop grid',
        currentClose: 0.06,
        mintick: 0.01,
        stop: 0.07,
        bar: { open: 0.06, high: 0.06999999999999999, low: 0.05, close: 0.06 },
        expected: 0.07,
    },
    {
        name: '1565 high 19.655 rounds to the displayed 19.66 stop',
        currentClose: 19.65,
        mintick: 0.01,
        stop: 19.66,
        bar: { open: 19.65, high: 19.655, low: 19.64, close: 19.65 },
        expected: 19.66,
    },
    {
        name: 'subtraction dust is absorbed by the displayed grid',
        currentClose: 0,
        mintick: 0.01,
        stop: 0.01,
        bar: { open: 0, high: 0.1 - 9 * 0.01, low: -0.01, close: 0 },
        expected: 0.01,
    },
    {
        name: 'a five-e-10 sub-tick deficit still displays as the one-tick level',
        currentClose: 0.5,
        mintick: 1,
        stop: 1,
        bar: { open: 0.5, high: 1 - 5e-10, low: 0.4, close: 0.5 },
        expected: 1,
    },
];

describe('VIN-136 stock trailing/displayed-price path (1565, 2bad8f1)', () => {
    it.each(cases)('$name', (testCase) => {
        const context = makeContext(testCase.currentClose, testCase.mintick);
        const strategy = strategyOf(context);
        entry(context)('L', 'long', { stop: testCase.stop });
        setBar(context, testCase.bar.open, testCase.bar.high, testCase.bar.low, testCase.bar.close);

        expect(processStrategyOrders(context)).toBe(1);
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_price).toBe(testCase.expected);
        expect(strategy.pending_orders).toHaveLength(0);
    });

    it('retains the canonical away-rounding of a genuine sub-noise fraction', () => {
        expect(roundToMintick(5e-10, 0, 1, 'up')).toBe(1);
    });
});
