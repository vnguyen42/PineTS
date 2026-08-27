import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { NAHelper } from '../../../src/namespaces/Core';
import { initializeStrategy, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { order } from '../../../src/namespaces/strategy/methods/order';
import { Series } from '../../../src/Series';

/**
 * VIN-95 — TV stop-entry fill semantics (spec: oracle-archives/stopentry-spec/spec.md).
 *
 * TV rule measured on the archived oracles (C1-2454, C1-1665, C2-1828,
 * C3-2118, C4-2097; COF=false, POC=false):
 *   1. a stop already crossed at the bar's OPEN fills at the open (gap);
 *   2. otherwise a stop reached intrabar fills at the stop level — the
 *      equality high==stop / low==stop is INCLUSIVE (C1-1665);
 *   3. a stop strictly beyond the signal close (buy stop < close,
 *      sell stop > close) is triggered and fills at the next admissible
 *      open while keeping its LEVEL for sizing (C4-2097).
 *   4. A stop submitted during a bar is evaluated from the next admissible
 *      bar in the ordinary non-COF path; equality is inclusive there.

 */
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

function setBar(context: any, idx: number, open: number, high: number, low: number, close: number, openTime = idx * 86_400_000) {
    context.idx = idx;
    context.data.open = new Series([open, open]);
    context.data.high = new Series([high, high]);
    context.data.low = new Series([low, low]);
    context.data.close = new Series([close, close]);
    context.data.openTime = new Series([openTime, openTime]);
}

describe('strategy stop-entries — TV fill semantics (VIN-95)', () => {
    it('in-range LONG stop fills at the stop level (not the open)', () => {
        const context = makeContext();
        entry(context)('L', 'long', { stop: 102 }); // placed on bar 0, close 100
        setBar(context, 1, 100, 103, 99, 101);
        const fills = processStrategyOrders(context);
        expect(fills).toBe(1);
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(102);
        expect(context.strategy.opentrades[0].entry_time).toBe(86_400_000);
    });

    it('in-range SHORT stop fills at the stop level (not the open)', () => {
        const context = makeContext();
        entry(context)('S', 'short', { stop: 98 }); // placed on bar 0, close 100
        setBar(context, 1, 100, 101, 97, 99);
        const fills = processStrategyOrders(context);
        expect(fills).toBe(1);
        expect(context.strategy.position_size).toBe(-1);
        expect(context.strategy.opentrades[0].entry_price).toBe(98);
    });

    it('gap-through LONG stop fills at the open, never at the stop', () => {
        const context = makeContext();
        entry(context)('L', 'long', { stop: 102 });
        setBar(context, 1, 105, 106, 104, 105);
        const fills = processStrategyOrders(context);
        expect(fills).toBe(1);
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(105); // the open, not 102
    });

    it('gap-through SHORT stop fills at the open, never at the stop', () => {
        const context = makeContext();
        entry(context)('S', 'short', { stop: 98 });
        setBar(context, 1, 95, 97, 94, 96);
        const fills = processStrategyOrders(context);
        expect(fills).toBe(1);
        expect(context.strategy.position_size).toBe(-1);
        expect(context.strategy.opentrades[0].entry_price).toBe(95); // the open, not 98
    });

    it('gap fill uses the open regardless of stored trigger representation (2454 trigger-vs-fill)', () => {
        // The archived 2454 trigger representation is distinct from the
        // feed open; a gap fill must use the open, never the stored trigger.
        const context = makeContext();
        context.pine = { syminfo: { mintick: 0.001, pointvalue: 1 } } as any;
        entry(context)('L', 'long', { stop: 2.538 }); // rounded trigger = 2.5380000000000003
        setBar(context, 1, 2.9, 2.95, 2.85, 2.92);
        const fills = processStrategyOrders(context);
        expect(fills).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(2.9); // open, never the noisy trigger
    });

    it('equality LONG stop (high == stop) fills inclusively at the stop (1665)', () => {
        // 1665 bar 2024-06-15T14:00: high == stop == 2.538 — the rounded
        // trigger (2.5380000000000003) differs from the feed price by 1 ulp,
        // so the equality must be tolerance-inclusive to fill.
        const context = makeContext();
        context.pine = { syminfo: { mintick: 0.001, pointvalue: 1 } } as any;
        setBar(context, 0, 2.5, 2.55, 2.45, 2.5); // close 2.5 < stop → not marketable
        entry(context)('L', 'long', { stop: 2.538 });
        setBar(context, 1, 2.497, 2.538, 2.477, 2.532); // open < stop, high == stop
        const fills = processStrategyOrders(context);
        expect(fills).toBe(1);
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(2.538);
    });

    it('equality SHORT stop (low == stop) fills inclusively at the stop', () => {
        const context = makeContext();
        context.pine = { syminfo: { mintick: 0.001, pointvalue: 1 } } as any;
        setBar(context, 0, 2.5, 2.55, 2.45, 2.5); // close 2.5 > stop → not marketable
        entry(context)('S', 'short', { stop: 2.462 });
        setBar(context, 1, 2.51, 2.52, 2.462, 2.47); // open > stop, low == stop
        const fills = processStrategyOrders(context);
        expect(fills).toBe(1);
        expect(context.strategy.position_size).toBe(-1);
        expect(context.strategy.opentrades[0].entry_price).toBe(2.462);
    });

    it('already-marketable LONG stop fills at the next open (even below the stop) with sizing at the order level (VIN-89)', () => {
        const context = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 100 });
        entry(context)('L', 'long', { stop: 98 }); // 98 < close 100 (strict) → marketable at submission
        setBar(context, 1, 97, 99, 96, 98); // open 97 < stop 98
        const fills = processStrategyOrders(context);
        expect(fills).toBe(1);
        expect(context.strategy.position_size).toBe(10204.08163); // 1000000 / 98, 5 decimals
        expect(context.strategy.opentrades[0].entry_price).toBe(97); // next open, not the stop
    });

    it('already-marketable SHORT stop fills at the next open with sizing at the order level', () => {
        const context = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 100 });
        entry(context)('S', 'short', { stop: 102 }); // 102 > close 100 (strict) → marketable
        setBar(context, 1, 103, 104, 101, 103);
        const fills = processStrategyOrders(context);
        expect(fills).toBe(1);
        expect(context.strategy.position_size).toBe(-9803.92156); // 1000000 / 102, 5 decimals
        expect(context.strategy.opentrades[0].entry_price).toBe(103); // next open
    });

    it.each([
        { direction: 'long', stop: 102, open: 100, high: 101, low: 99 },
        { direction: 'short', stop: 98, open: 100, high: 101, low: 99 },
    ])('keeps an untriggered $direction stop pending', ({ direction, stop, open, high, low }) => {
        const context = makeContext();
        entry(context)('pending', direction, { stop });
        setBar(context, 1, open, high, low, open);
        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0].status).toBe('pending');
    });

    it.each([
        { direction: 'long', stop: 100, open: 99, high: 100, low: 98 },
        { direction: 'short', stop: 100, open: 101, high: 102, low: 100 },
    ])('treats stop equal to signal close as an ordinary $direction stop', ({ direction, stop, open, high, low }) => {
        const context = makeContext();
        entry(context)('equal-close', direction, { stop });
        setBar(context, 1, open, high, low, open);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(stop);
    });

    it('refreshing one pending ID does not retain the old stop or double-fill', () => {
        const context = makeContext();
        entry(context)('L', 'long', { stop: 102 });

        setBar(context, 1, 100, 101, 99, 100);
        expect(processStrategyOrders(context)).toBe(0);
        entry(context)('L', 'long', { stop: 103 });
        expect(context.strategy.pending_orders).toHaveLength(1);

        setBar(context, 2, 100, 102, 99, 101);
        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.pending_orders).toHaveLength(1);

        setBar(context, 3, 100, 103, 99, 101);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(103);
        expect(context.strategy.pending_orders).toHaveLength(0);
    });

    it('strategy.order pure stop uses the same strict marketable boundary', () => {
        const context = makeContext();
        order(context)({ id: 'L', direction: 'long', qty: 1, stop: 100 });
        setBar(context, 1, 99, 100, 98, 99);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(100);
    });

    it('COF tick-by-tick stop path is unchanged (non-régression)', () => {
        const context = makeContext({ calc_on_order_fills: true });
        entry(context)('L', 'long', { stop: 102 }); // placed on bar 0

        setBar(context, 1, 100, 104, 96, 100);
        context.strategy._cof = { pass: 0, ticks: [100, 104, 96, 100] };
        // Pass 0: tick 100 < 102 → no fill.
        expect(processStrategyOrders(context)).toBe(0);
        // Pass 1: tick 104 crosses the stop → fill at the stop level.
        context.strategy._cof.pass = 1;
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(102);
    });

    it('POC close phase leaves current-bar stops pending (non-régression)', () => {
        const context = makeContext({ process_orders_on_close: true });
        setBar(context, 1, 100, 103, 99, 101);
        entry(context)('L', 'long', { stop: 102 }); // current-bar stop
        expect(processStrategyOrders(context, 'close')).toBe(0);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.pending_orders[0].status).toBe('pending');
    });

    it('stop-limit is never converted by the pure-stop fix (activation only, fill on a later evaluation)', () => {
        const context = makeContext();
        entry(context)('SL', 'long', { stop: 102, limit: 103 });
        setBar(context, 1, 100, 104, 99, 101); // high crosses the stop
        expect(processStrategyOrders(context)).toBe(0);
        const pending = context.strategy.pending_orders[0];
        expect(pending.status).toBe('pending');
        expect(pending.type).toBe('limit'); // stop leg activated, order not filled
        expect(pending._stop_limit_activated).toBe(true);
        // Stop-limit activation remains unchanged; the pure-stop fix does not
        // convert or fill this order in the same evaluation.
    });

    it('slippage applies AFTER the open-vs-stop choice: LONG gap open 1.2020 + 2 ticks = 1.2022 (2097)', () => {
        const context = makeContext({ slippage: 2 });
        context.pine = { syminfo: { mintick: 0.0001, pointvalue: 1 } } as any;
        entry(context)('L', 'long', { stop: 1.2 }); // above close 1.1 → not marketable
        setBar(context, 1, 1.202, 1.21, 1.19, 1.205);
        const fills = processStrategyOrders(context);
        expect(fills).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(1.2022); // open + 2×0.0001
    });

    it('slippage SHORT mirror: gap open − 2 ticks', () => {
        const context = makeContext({ slippage: 2 });
        context.pine = { syminfo: { mintick: 0.0001, pointvalue: 1 } } as any;
        entry(context)('S', 'short', { stop: 1.25 }); // below close 1.3 → not marketable
        setBar(context, 1, 1.24, 1.26, 1.23, 1.245);
        const fills = processStrategyOrders(context);
        expect(fills).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(1.2398); // open − 2×0.0001
    });

    it('marketable stop keeps its level for sizing even when the signal close differs (VIN-89 regression)', () => {
        const context = makeContext({ default_qty_type: 'percent_of_equity', default_qty_value: 50 });
        // A marketable LONG stop at 98 vs a market entry at close 100: the
        // qty must reflect the ORDER level (98), not the signal close (100).
        entry(context)('L', 'long', { stop: 98 });
        expect(context.strategy.pending_orders[0].qty).toBe(Math.floor((1000000 * 50 / 100) / 98 * 1e5) / 1e5);
    });
    const naLevelCases = [
        {
            name: 'market when both levels are na',
            limit: Number.NaN,
            stop: Number.NaN,
            type: 'market',
            expectedLimit: undefined,
            expectedStop: undefined,
            sizingPrice: 100,
        },
        {
            name: 'pure stop when limit is na',
            limit: Number.NaN,
            stop: 95,
            type: 'stop',
            expectedLimit: undefined,
            expectedStop: 95,
            sizingPrice: 95,
        },
        {
            name: 'pure limit when stop is na',
            limit: 105,
            stop: Number.NaN,
            type: 'limit',
            expectedLimit: 105,
            expectedStop: undefined,
            sizingPrice: 105,
        },
        {
            name: 'stop-limit when both levels are real',
            limit: 105,
            stop: 95,
            type: 'stop-limit',
            expectedLimit: 105,
            expectedStop: 95,
            sizingPrice: 95,
        },
    ] as const;

    it.each(naLevelCases)('normalizes entry levels: $name', (testCase) => {
        const context = makeContext({ default_qty_type: 'cash', default_qty_value: 1000 });
        entry(context)('entry', 'long', { limit: testCase.limit, stop: testCase.stop });

        const pending = context.strategy.pending_orders[0];
        expect(pending.type).toBe(testCase.type);
        expect(pending.limit).toBe(testCase.expectedLimit);
        expect(pending.stop).toBe(testCase.expectedStop);
        expect(pending.qty).toBe(Math.floor((1000 / testCase.sizingPrice) * 1e6) / 1e6);
        expect(pending._stop_marketable).toBe(testCase.type === 'stop' && testCase.sizingPrice < 100);
    });

    it.each(naLevelCases)('normalizes strategy.order levels: $name', (testCase) => {
        const context = makeContext({ default_qty_type: 'cash', default_qty_value: 1000 });
        order(context)({ id: 'order', direction: 'long', limit: testCase.limit, stop: testCase.stop });

        const pending = context.strategy.pending_orders[0];
        expect(pending.type).toBe(testCase.type);
        expect(pending.limit).toBe(testCase.expectedLimit);
        expect(pending.stop).toBe(testCase.expectedStop);
        expect(pending.qty).toBe(Math.floor((1000 / testCase.sizingPrice) * 1e6) / 1e6);
        expect(pending._stop_marketable).toBe(testCase.type === 'stop' && testCase.sizingPrice < 100);
    });

    const loneNaCases = [
        { name: 'stop', levels: { stop: Number.NaN }, type: 'stop', field: 'stop' },
        { name: 'limit', levels: { limit: Number.NaN }, type: 'limit', field: 'limit' },
    ] as const;

    it.each(loneNaCases)('keeps a lone na $name entry non-executable', (testCase) => {
        const context = makeContext();
        entry(context)('lone-na', 'long', testCase.levels);

        const pending = context.strategy.pending_orders[0];
        expect(pending.type).toBe(testCase.type);
        expect(Number.isNaN(pending[testCase.field])).toBe(true);
        setBar(context, 1, 101, 102, 100, 101);
        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.position_size).toBe(0);
    });

    it.each(loneNaCases)('keeps a lone na strategy.order $name non-executable', (testCase) => {
        const context = makeContext();
        order(context)({ id: 'lone-na', direction: 'long', ...testCase.levels });

        const pending = context.strategy.pending_orders[0];
        expect(pending.type).toBe(testCase.type);
        expect(Number.isNaN(pending[testCase.field])).toBe(true);
        setBar(context, 1, 101, 102, 100, 101);
        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.position_size).toBe(0);
    });

    // Famille : entry(limit=na, stop=na) — ids 2359/2114, fork 1036df3 : limit=na ET stop=na
    // explicites ENSEMBLE → market ; na SEUL → ordre non exécutable inchangé.
    it('fills an entry with limit=na and stop=na as a market order', () => {
        const context = makeContext();
        entry(context)('market', 'long', { limit: Number.NaN, stop: Number.NaN });
        setBar(context, 1, 101, 102, 100, 101);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.position_size).toBe(1);
    });

    it('fills strategy.order with limit=na and stop=na as a market order', () => {
        const context = makeContext();
        order(context)({ id: 'market', direction: 'long', limit: Number.NaN, stop: Number.NaN });
        setBar(context, 1, 101, 102, 100, 101);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.position_size).toBe(1);
    });

    it('treats an undefined sibling as omitted for a lone na entry', () => {
        const context = makeContext();
        entry(context)('undefined-sibling', 'long', { limit: Number.NaN, stop: undefined });

        const pending = context.strategy.pending_orders[0];
        expect(pending.type).toBe('limit');
        expect(Number.isNaN(pending.limit)).toBe(true);
        setBar(context, 1, 101, 102, 100, 101);
        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.position_size).toBe(0);
    });

    it('normalizes explicit NAHelper levels for strategy.order', () => {
        const context = makeContext();
        const na = new NAHelper();
        order(context)({ id: 'na-helper', direction: 'long', limit: na, stop: na });

        const pending = context.strategy.pending_orders[0];
        expect(pending.type).toBe('market');
        expect(pending.limit).toBeUndefined();
        expect(pending.stop).toBeUndefined();
        setBar(context, 1, 101, 102, 100, 101);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.position_size).toBe(1);
    });

});
