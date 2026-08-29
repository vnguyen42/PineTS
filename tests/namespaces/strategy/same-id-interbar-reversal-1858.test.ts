// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Context } from '../../../src/Context.class';
import type { IProvider } from '../../../src/marketData/IProvider';
import { Series } from '../../../src/Series';
import { initializeStrategy } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { Order } from '../../../src/namespaces/strategy/types';

/**
 * 1858 — same-ID pending-stop refresh across bars must reverse the LIVE
 * position. The archived FX:EURUSD witness has the same shape at b21/b27:
 * while +100 is open, ChBrkSE is refreshed on a later bar and fills short.
 *
 * The contiguous same-bar replacement in 2121 is deliberately different: the
 * first queued market reversal is projected before the second same-ID call
 * quantifies its replacement. That projection remains covered below.
 */

const mintick = 0.01;

class InterbarProvider {
    constructor(private readonly candles: unknown[]) {}
    configure() {}
    async getMarketData() {
        return this.candles;
    }
    async getSymbolInfo() {
        return {
            ticker: '1858', tickerid: 'TEST:1858', main_tickerid: 'TEST:1858',
            prefix: 'TEST', root: '1858', description: '1858 / USD', type: 'stock',
            basecurrency: 'USD', currency: 'USD', timezone: 'Etc/UTC',
            mintick, pricescale: 100, minmove: 1, pointvalue: 1, mincontract: 1,
            session: '24x7', volumetype: 'base',
        };
    }
}

function candle(open: number, high: number, low: number, close: number, bar: number) {
    return {
        openTime: bar * 86_400_000, open, high, low, close, volume: 1000,
        closeTime: bar * 86_400_000 + 86_399_999,
    };
}

const CANDLES = [
    candle(100, 100, 100, 100, 0),
    candle(100, 100, 100, 100, 1),
    candle(100, 100, 95, 100, 2),
    candle(100, 100, 89, 100, 3),
];

const INTERBAR_SOURCE = `
//@version=5
strategy('1858 same-ID interbar reversal', pyramiding=1, default_qty_type=strategy.fixed, default_qty_value=100)
if bar_index == 0
    strategy.entry('Buy', strategy.long)
if bar_index >= 1
    strategy.entry('ChBrkSE', strategy.short, stop=90)`;
const CLOSE_BEFORE_FILL_CANDLES = [
    candle(100, 100, 100, 100, 0),
    candle(100, 100, 100, 100, 1),
    candle(100, 100, 95, 100, 2),
    candle(100, 100, 95, 100, 3),
    candle(100, 100, 89, 100, 4),
];

const CLOSE_BEFORE_FILL_SOURCE = `
//@version=5
strategy('1858 pending reversal survives a concurrent close', pyramiding=1, default_qty_type=strategy.fixed, default_qty_value=100)
if bar_index == 0
    strategy.entry('Buy', strategy.long)
if bar_index == 1
    strategy.entry('ChBrkSE', strategy.short, stop=90)
if bar_index == 2
    strategy.close('Buy')`;


function makeContext(config: Record<string, unknown> = {}) {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'TEST:1858',
        timeframe: 'D',
    });
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick: 0.01, pointvalue: 1 };
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 15, ...config });
    return context;
}

describe('strategy same-ID interbar reversal (1858)', () => {
    it('refreshes ChBrkSE across bars as a reversal against the live +100 position', async () => {
        const pendingEngine = new PineTS(new InterbarProvider(CANDLES.slice(0, 3)) as unknown as IProvider, '1858', 'D');
        const pendingContext = await pendingEngine.run(INTERBAR_SOURCE);
        const pending = pendingContext.strategy?.pending_orders
            .find((order: Order) => order.status === 'pending' && order.id === 'ChBrkSE');

        expect(pending).toBeDefined();
        // b21 witness shape: an inter-bar refresh must not project the old
        // pending stop as if it had filled before this call.
        expect(pending?.qty).toBe(200);
        expect(pending?._isReversalEntry).toBe(true);
        expect(pending?._base_qty).toBe(100);

        const engine = new PineTS(new InterbarProvider(CANDLES) as unknown as IProvider, '1858', 'D');
        const context = await engine.run(INTERBAR_SOURCE);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy test context was not initialized');

        // b27 witness shape: the 200-unit stop fill closes +100 and opens
        // -100, rather than flattening the position with a 100-unit order.
        expect(strategy.position_size).toBe(-100);
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_id).toBe('ChBrkSE');
        expect(strategy.opentrades[0].size).toBe(-100);
    });

    it('opens only base qty when a concurrent close flattens the position before the pending reversal fills', async () => {
        const engine = new PineTS(
            new InterbarProvider(CLOSE_BEFORE_FILL_CANDLES) as unknown as IProvider,
            '1858',
            'D',
        );
        const context = await engine.run(CLOSE_BEFORE_FILL_SOURCE);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy test context was not initialized');

        // The stop was queued as close 100 + open 100. The separate close()
        // fills first at bar 3's open, so the pending reversal must open only
        // its preserved base quantity when it triggers on bar 4.
        expect(strategy.position_size).toBe(-100);
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_id).toBe('ChBrkSE');
        expect(strategy.opentrades[0].size).toBe(-100);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].entry_id).toBe('Buy');
    });

    it('keeps 2121 contiguous same-bar projection for a same-ID replacement', () => {
        const context = makeContext();
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy test context was not initialized');
        strategy.position_size = -15;
        entry(context)('L', 'long', { qty: 15 });
        expect(strategy.pending_orders[0].qty).toBe(30);
        expect(strategy.pending_orders[0]._isReversalEntry).toBe(true);

        entry(context)('L', 'long', { qty: 15 });
        const pending = strategy.pending_orders[0];
        expect(pending.qty).toBe(15);
        expect(pending._isReversalEntry).toBe(false);
    });
});
