import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { StrategyState } from '../../../src/namespaces/strategy/types';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { initializeStrategy, openTrade, processExitOrders } from '../../../src/namespaces/strategy/utils';

// Famille : arrondi exit absolu — VIN-133, révélateur 2422, fix 2bad8f1.
// Stock absolute stop/limit levels use the open position direction and its
// average entry as the reference. This test covers the four required price
// cases, then observes the resulting exit fill rather than implementation
// details.

function strategyOf(context: Context): StrategyState {
    if (!context.strategy) throw new Error('strategy state was not initialized');
    return context.strategy;
}

function makeContext({
    direction,
    positionAverage,
    currentClose,
    mintick,
}: {
    direction: 1 | -1;
    positionAverage: number;
    currentClose: number;
    mintick: number;
}) {
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
    openTrade(context, direction === 1 ? 'L' : 'S', direction, 1, positionAverage, 0);
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

type ExitCase = {
    name: string;
    direction: 1 | -1;
    leg: 'limit' | 'stop';
    positionAverage: number;
    currentClose: number;
    mintick: number;
    raw: number;
    expected: number;
    bar: { open: number; high: number; low: number; close: number };
};

const cases: ExitCase[] = [
    {
        name: 'exact-grid value remains unchanged despite grid representation noise',
        direction: 1,
        leg: 'limit',
        positionAverage: 0.05,
        currentClose: 0.08,
        mintick: 0.01,
        raw: 0.07000000000000001,
        expected: 0.07,
        bar: { open: 0.06, high: 0.08, low: 0.05, close: 0.07 },
    },
    {
        name: 'genuine fraction rounds away from a long position',
        direction: 1,
        leg: 'limit',
        positionAverage: 0.05,
        currentClose: 0.08,
        mintick: 0.01,
        raw: 0.073,
        expected: 0.08,
        bar: { open: 0.07, high: 0.09, low: 0.06, close: 0.08 },
    },
    {
        name: 'upstream subtraction dust snaps back to its exact grid',
        direction: 1,
        leg: 'limit',
        positionAverage: 0.005,
        currentClose: 0.02,
        mintick: 0.01,
        raw: 0.1 - 9 * 0.01,
        expected: 0.01,
        bar: { open: 0, high: 0.02, low: 0, close: 0.01 },
    },
    {
        name: 'a genuine sub-noise fraction is preserved by directional rounding',
        direction: -1,
        leg: 'stop',
        positionAverage: 0,
        currentClose: 1,
        mintick: 1,
        raw: 5e-10,
        expected: 1,
        bar: { open: 0, high: 2, low: -1, close: 0 },
    },
];

describe('VIN-133 absolute exit rounding (2422, 2bad8f1)', () => {
    it.each(cases)('$name', (testCase) => {
        const context = makeContext(testCase);
        const strategy = strategyOf(context);
        const entryId = testCase.direction === 1 ? 'L' : 'S';
        const placeExit = exit(context);
        if (testCase.leg === 'limit') placeExit('X', entryId, { limit: testCase.raw });
        else placeExit('X', entryId, { stop: testCase.raw });

        const pending = strategy.pending_orders[0];
        if (!pending) throw new Error('exit order was not queued');
        const queuedLevel = testCase.leg === 'limit' ? pending.limit : pending.stop;
        expect(queuedLevel).toBe(testCase.expected);

        setBar(context, testCase.bar.open, testCase.bar.high, testCase.bar.low, testCase.bar.close);
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(testCase.expected);
    });

    it('reproduces 2422’s observed long limit level against the position average', () => {
        const context = makeContext({
            direction: 1,
            positionAverage: 22.325,
            currentClose: 22.55370718,
            mintick: 0.01,
        });
        const strategy = strategyOf(context);

        exit(context)('TP', 'L', { limit: 22.54825 });
        expect(strategy.pending_orders[0]?.limit).toBe(22.55);

        setBar(context, 22.54, 22.56, 22.5, 22.55);
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(strategy.closedtrades[0]?.exit_price).toBe(22.55);
    });
});
