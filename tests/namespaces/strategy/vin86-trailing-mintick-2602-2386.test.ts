import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { Order, StrategyState } from '../../../src/namespaces/strategy/types';
import { initializeStrategy, openTrade, processExitOrders } from '../../../src/namespaces/strategy/utils';

// Famille : quantization mintick des fills trailing — VIN-86/VIN-86c,
// révélateurs 2602/2386, fixes 7f18d31 + 09079fc. The trailing offset is
// truncated to whole ticks; long stops use floor and short stops use ceil,
// after absorbing only magnitude-relative representation noise. Each case
// observes the recorded trade fill.

function strategyOf(context: Context): StrategyState {
    if (!context.strategy) throw new Error('strategy state was not initialized');
    return context.strategy;
}

function makeContext({
    direction,
    mintick,
    open,
    high,
    low,
    close,
    trailPeak,
    trailOffset,
}: {
    direction: 1 | -1;
    mintick: number;
    open: number;
    high: number;
    low: number;
    close: number;
    trailPeak: number;
    trailOffset: number;
}) {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'BTCUSDT',
        timeframe: 'D',
    });
    context.idx = 0;
    context.data.open = new Series([open]);
    context.data.high = new Series([high]);
    context.data.low = new Series([low]);
    context.data.close = new Series([close]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick, pointvalue: 1, type: 'crypto' };
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
    const entryId = direction === 1 ? 'L' : 'S';
    openTrade(context, entryId, direction, 1, 100, 0);

    context.idx = 1;
    context.data.open = new Series([open, open]);
    context.data.high = new Series([high, high]);
    context.data.low = new Series([low, low]);
    context.data.close = new Series([close, close]);
    context.data.openTime = new Series([0, 86_400_000]);

    const order: Order = {
        id: 'trail',
        direction: -direction,
        qty: 1,
        type: 'stop',
        category: 'exit',
        from_entry: entryId,
        trail_offset: trailOffset,
        trail_peak: trailPeak,
        trail_armed: true,
        status: 'pending',
        bar: 0,
        time: 0,
    };
    strategyOf(context).pending_orders.push(order);
    return context;
}

type TrailingCase = {
    name: string;
    direction: 1 | -1;
    mintick: number;
    open: number;
    high: number;
    low: number;
    close: number;
    trailPeak: number;
    trailOffset: number;
    expected: number;
};

const cases: TrailingCase[] = [
    {
        name: 'exact-grid long level absorbs binary representation noise',
        direction: 1,
        mintick: 0.01,
        open: 0.071,
        high: 0.10000000000000002,
        low: 0.069,
        close: 0.07,
        trailPeak: 0.10000000000000002,
        trailOffset: 3,
        expected: 0.07,
    },
    {
        name: 'genuine fractional long offset is rounded on the adverse side',
        direction: 1,
        mintick: 0.001,
        open: 13.469,
        high: 13.4699,
        low: 13.467,
        close: 13.4685,
        trailPeak: 13.4699,
        trailOffset: 1.2744,
        expected: 13.468,
    },
    {
        name: 'subtraction dust is snapped back to the exact long grid level',
        direction: 1,
        mintick: 0.01,
        open: 0.02,
        high: 0.1,
        low: 0.009,
        close: 0.01,
        trailPeak: 0.1,
        trailOffset: 9,
        expected: 0.01,
    },
    {
        name: 'a genuine sub-noise short fraction is preserved by the ceil',
        direction: -1,
        mintick: 1,
        open: 10.5,
        high: 12.1,
        low: 10.0000000005,
        close: 10.5,
        trailPeak: 10.0000000005,
        trailOffset: 1,
        expected: 12,
    },
];

describe('VIN-86/VIN-86c trailing mintick fills (2602, 2386)', () => {
    it.each(cases)('$name', (testCase) => {
        const context = makeContext(testCase);
        const strategy = strategyOf(context);

        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_price).toBe(testCase.expected);
        expect(strategy.pending_orders).toHaveLength(0);
    });
});
