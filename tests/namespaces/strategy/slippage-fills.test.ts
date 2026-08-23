import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { initializeStrategy, processExitOrders, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { close } from '../../../src/namespaces/strategy/methods/close';

function makeContext(config: Record<string, unknown> = {}) {
    const context: any = new Context({
        marketData: [],
        source: [],
        tickerId: 'BTCUSDT',
        timeframe: 'D',
    } as any);
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } } as any;
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, ...config });
    return context;
}

function setBar(context: any, idx: number, open: number, high: number, low: number, closePrice: number) {
    context.idx = idx;
    context.data.open = new Series([open, open]);
    context.data.high = new Series([high, high]);
    context.data.low = new Series([low, low]);
    context.data.close = new Series([closePrice, closePrice]);
    context.data.openTime = new Series([idx * 86_400_000, idx * 86_400_000]);
}

describe('strategy slippage — market and stop only', () => {
    it.each([
        { direction: 'long', limit: 99, open: 100, high: 101, low: 98, expected: 99 },
        { direction: 'short', limit: 101, open: 100, high: 102, low: 99, expected: 101 },
    ])('does not apply slippage to a $direction limit entry', ({ direction, limit, open, high, low, expected }) => {
        const context = makeContext({ slippage: 2 });
        entry(context)('L', direction, { limit });
        setBar(context, 1, open, high, low, open);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(expected);
    });

    it.each([
        { direction: 'long', stop: 102, open: 100, high: 103, low: 99, expected: 102.02 },
        { direction: 'short', stop: 98, open: 100, high: 101, low: 97, expected: 97.98 },
    ])('applies slippage to a $direction stop entry', ({ direction, stop, open, high, low, expected }) => {
        const context = makeContext({ slippage: 2 });
        entry(context)('S', direction, { stop });
        setBar(context, 1, open, high, low, open);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBeCloseTo(expected, 10);
    });

    it.each([
        { direction: 'long', limit: 101, high: 102, low: 99, expected: 101 },
        { direction: 'short', limit: 99, high: 101, low: 98, expected: 99 },
    ])('does not apply slippage to a $direction profit limit exit', ({ direction, limit, high, low, expected }) => {
        const context = makeContext();
        entry(context)('L', direction);
        setBar(context, 1, 100, 100, 100, 100);
        expect(processStrategyOrders(context)).toBe(1);
        context.strategy.config.slippage = 2;
        exit(context)('TP', 'L', { limit });

        setBar(context, 2, 100, high, low, 100);
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.closedtrades[0].exit_price).toBe(expected);
    });

    it.each([
        { direction: 'long', stop: 99, high: 101, low: 98, expected: 98.98 },
        { direction: 'short', stop: 101, high: 102, low: 100, expected: 101.02 },
    ])('applies slippage to a $direction loss stop exit', ({ direction, stop, high, low, expected }) => {
        const context = makeContext();
        entry(context)('L', direction);
        setBar(context, 1, 100, 100, 100, 100);
        expect(processStrategyOrders(context)).toBe(1);
        context.strategy.config.slippage = 2;
        exit(context)('SL', 'L', { stop });

        setBar(context, 2, 100, high, low, 100);
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.closedtrades[0].exit_price).toBeCloseTo(expected, 10);
    });
    it('does not apply slippage after a stop-limit activates into a limit', () => {
        const context = makeContext({ slippage: 2 });
        entry(context)('SL', 'long', { stop: 102, limit: 103 });

        setBar(context, 1, 100, 104, 99, 101);
        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.pending_orders[0].type).toBe('limit');

        setBar(context, 2, 100, 104, 99, 101);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(100);
    });


    it.each([
        { direction: 'long', expected: 99.98 },
        { direction: 'short', expected: 100.02 },
    ])('applies slippage to a $direction market exit', ({ direction, expected }) => {
        const context = makeContext();
        entry(context)('L', direction);
        setBar(context, 1, 100, 100, 100, 100);
        expect(processStrategyOrders(context)).toBe(1);
        context.strategy.config.slippage = 2;
        close(context)('L');

        setBar(context, 2, 100, 101, 99, 100);
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.closedtrades[0].exit_price).toBeCloseTo(expected, 10);
    });
});
