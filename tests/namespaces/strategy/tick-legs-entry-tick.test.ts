import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processExitOrders, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { Series } from '../../../src/Series';

/**
 * Tick-based exit legs (profit / loss / trail_points / trail_offset) are
 * measured in the tick in force when their entry filled. A host may vary
 * syminfo.mintick per bar (split-adjusted history: bars before a split carry
 * prices, and therefore ticks, divided by the split); a bracket held across
 * that change keeps its distance instead of stretching with the new tick.
 */
function makeContext() {
    const context: any = new Context({ marketData: [], source: [], tickerId: 'STOCK', timeframe: 'D' } as any);
    context.idx = 0;
    context.data.open = new Series([10]);
    context.data.high = new Series([10]);
    context.data.low = new Series([10]);
    context.data.close = new Series([10]);
    context.data.openTime = new Series([0]);
    context.pine = { syminfo: { mintick: 0.0025, pointvalue: 1, type: 'stock' } } as any;
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
    return context;
}

function setBar(context: any, idx: number, open: number, high: number, low: number, close: number) {
    context.idx = idx;
    for (const [key, value] of [['open', open], ['high', high], ['low', low], ['close', close], ['openTime', idx * 86_400_000]] as const) {
        context.data[key] = new Series([value, value]);
    }
}

function longWithBracket(leg: Record<string, number>) {
    const context = makeContext();
    entry(context)('L', 'long');
    setBar(context, 1, 10, 10.05, 9.95, 10);
    expect(processStrategyOrders(context)).toBe(1);
    expect(context.strategy.opentrades[0].entry_price).toBe(10);
    context.strategy.pending_orders.push({
        id: 'X', direction: 0, qty: 0, type: 'market', category: 'exit',
        from_entry: 'L', status: 'pending', bar: 1, time: 86_400_000, ...leg,
    });
    // A split: from bar 2 on the host's tick is 4× the entry bar's.
    context.pine.syminfo.mintick = 0.01;
    return context;
}

describe('tick exit legs keep the tick of their entry bar', () => {
    it('loss=80 stays 80 × 0.0025 = 0.20 below the entry after the tick changes', () => {
        const context = longWithBracket({ loss: 80 });
        setBar(context, 2, 9.95, 9.96, 9.7, 9.75); // the current tick would put the stop at 9.20
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy.closedtrades[0].exit_price).toBe(9.8);
    });

    it('profit=80 stays 0.20 above the entry after the tick changes', () => {
        const context = longWithBracket({ profit: 80 });
        setBar(context, 2, 10.05, 10.3, 10.0, 10.25); // the current tick would put the target at 10.80
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy.closedtrades[0].exit_price).toBeCloseTo(10.2, 12);
    });

    it('trail_points / trail_offset arm and ride in the entry tick', () => {
        const context = longWithBracket({ trail_points: 40, trail_offset: 40 });
        setBar(context, 2, 10.02, 10.15, 10.01, 10.12); // arms at 10.10 (40 × 0.0025), peak 10.15
        processExitOrders(context);
        expect(context.strategy.pending_orders.find((o: any) => o.id === 'X')?.trail_armed).toBe(true);
        setBar(context, 3, 10.12, 10.13, 10.0, 10.02); // rides 0.10 behind the peak: 10.05
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy.closedtrades[0].exit_price).toBe(10.05);
    });
});
