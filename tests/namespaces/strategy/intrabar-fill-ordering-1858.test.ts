// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { PineTS } from '../../../src/PineTS.class';
import { Series } from '../../../src/Series';
import { close } from '../../../src/namespaces/strategy/methods/close';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { order } from '../../../src/namespaces/strategy/methods/order';
import { initializeStrategy, processExitOrders, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import type { Trade } from '../../../src/namespaces/strategy/types';

type StrategyContext = Context & { strategy: NonNullable<Context['strategy']> };

function makeContext(config: Record<string, unknown> = {}): StrategyContext {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'TEST:1858',
        timeframe: '240',
    });
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick: 0.01, pointvalue: 1, type: 'forex' };
    initializeStrategy(context, {
        pyramiding: 1,
        default_qty_type: 'fixed',
        default_qty_value: 1,
        ...config,
    });
    if (!context.strategy) throw new Error('strategy was not initialized');
    return context as StrategyContext;
}
function setBar(context: StrategyContext, idx: number, open: number, high: number, low: number, close: number) {
    context.idx = idx;
    context.data.open = new Series([open, open]);
    context.data.high = new Series([high, high]);
    context.data.low = new Series([low, low]);
    context.data.close = new Series([close, close]);
    context.data.openTime = new Series([idx * 14_400_000, idx * 14_400_000]);
}

function openTrade(id: string, entryId: string, size: number, price: number): Trade {
    return {
        id,
        entry_id: entryId,
        entry_comment: entryId,
        entry_price: price,
        entry_bar_index: 0,
        entry_time: 0,
        size,
        commission: 0,
        max_drawdown: 0,
        max_runup: 0,
        status: 'open',
    };
}
function seedPosition(context: StrategyContext, size: number, price = 100) {
    const strategy = context.strategy;
    strategy.opentrades = [openTrade('seed-trade', 'seed', size, price)];
    strategy.position_size = size;
    strategy.position_avg_price = price;
    strategy.position_entry_name = 'seed';
}

describe('1858 intrabar-fill-ordering', () => {
    it('fills a market reversal at the open before an opposite stop on the same bar', () => {
        const context = makeContext();
        entry(context)('stop-short', 'short', { qty: 1, stop: 95 });
        seedPosition(context, -1);
        entry(context)('market-long', 'long', { qty: 1 });
        setBar(context, 1, 100, 110, 90, 105);

        expect(processStrategyOrders(context)).toBe(2);
        expect(context.strategy.closedtrades[0]).toMatchObject({
            entry_id: 'seed',
            exit_id: 'market-long',
            exit_price: 100,
        });
        expect(context.strategy.closedtrades[1]).toMatchObject({
            entry_id: 'market-long',
            exit_id: 'stop-short',
            exit_price: 95,
        });
        expect(context.strategy.position_size).toBe(0);
    });

    it('fills two opposite stops in the assumed O-H-L-C order when the open is closer to high', () => {
        const context = makeContext();

        entry(context)('short-first-in-queue', 'short', { qty: 1, stop: 95 });
        entry(context)('long-first-on-path', 'long', { qty: 1, stop: 109 });
        setBar(context, 1, 108, 110, 90, 100);

        expect(processStrategyOrders(context)).toBe(2);
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0]).toMatchObject({
            entry_id: 'long-first-on-path',
            exit_id: 'short-first-in-queue',
            entry_price: 109,
            exit_price: 95,
        });
        expect(context.strategy.position_size).toBe(0);
    });

    it('fills two opposite stops in the assumed O-L-H-C order when the open is closer to low', () => {
        const context = makeContext();

        entry(context)('long-first-in-queue', 'long', { qty: 1, stop: 109 });
        entry(context)('short-first-on-path', 'short', { qty: 1, stop: 91 });
        setBar(context, 1, 92, 110, 90, 100);

        expect(processStrategyOrders(context)).toBe(2);
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0]).toMatchObject({
            entry_id: 'short-first-on-path',
            exit_id: 'long-first-in-queue',
            entry_price: 91,
            exit_price: 109,
        });
        expect(context.strategy.position_size).toBe(0);
    });

    it('rechecks the strategy.entry pyramiding cap at fill after an earlier same-side market fill', () => {
        const context = makeContext();

        entry(context)('stop-add', 'long', { qty: 1, stop: 109 });
        entry(context)('market-first', 'long', { qty: 1 });
        setBar(context, 1, 108, 110, 90, 100);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0]).toMatchObject({ entry_id: 'market-first', size: 1, entry_price: 108 });
        expect(context.strategy.position_size).toBe(1);
    });

    it('drains a deferred immediately close at the next open without POC', () => {
        const context = makeContext();
        seedPosition(context, 1);
        close(context)('seed', { immediately: true });
        setBar(context, 1, 110, 125, 105, 120);

        expect(processExitOrders(context, 'intrabar', true)).toBe(1);
        expect(context.strategy.closedtrades[0].exit_price).toBe(110);
    });

    it('keeps strategy.order exempt from the pyramiding cap', () => {
        const context = makeContext();

        order(context)({ id: 'stop-add', direction: 'long', qty: 1, stop: 109 });
        order(context)({ id: 'market-first', direction: 'long', qty: 1 });
        setBar(context, 1, 108, 110, 90, 100);

        expect(processStrategyOrders(context)).toBe(2);
        expect(context.strategy.opentrades.map((trade: Trade) => trade.entry_id)).toEqual(['market-first', 'stop-add']);
        expect(context.strategy.position_size).toBe(2);
    });
});

// Chemin COMPLET de la boucle non-COF de PineTS.class.ts (pas d'appel direct
// à processExitOrders / processStrategyOrders) : le pré-drain des sorties
// marché différées tourne AVANT les entrées marché, tout à l'ouverture de la
// barre. Contrat local (close.ts:18-21) : une sortie différée remplit à
// l'ouverture de la barre suivante ; seul `immediately=true` AVEC
// process_orders_on_close remplit à la clôture. Une sortie différée ne doit
// donc JAMAIS consommer la clôture d'une barre future.
describe('1858 deferred market exits through the non-COF bar loop', () => {
    const candles = [
        { open: 100, high: 101, low: 99, close: 100 },
        { open: 100, high: 101, low: 99, close: 100 },
        { open: 110, high: 125, low: 105, close: 120 },
        { open: 120, high: 121, low: 119, close: 120 },
    ].map((bar, index) => ({
        openTime: index * 14_400_000,
        closeTime: (index + 1) * 14_400_000 - 1,
        ...bar,
        volume: 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    }));

    const HEADER = `//@version=5
strategy('1858-immediately', default_qty_type=strategy.fixed, default_qty_value=1, pyramiding=1)
if bar_index == 0
    strategy.entry('seed', strategy.long)
`;

    it('fills a deferred immediately close at the next bar open, never at its close', async () => {
        const context = await new PineTS(candles, 'TEST:1858', '240').run(`${HEADER}if bar_index == 1
    strategy.close('seed', immediately = true)
`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy was not initialized');

        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0]).toMatchObject({
            entry_id: 'seed',
            entry_price: 100,
            exit_bar_index: 2,
            exit_price: 110,
        });
        expect(strategy.position_size).toBe(0);
    });

    it('drains the deferred close before the opposite market entry, both at the open', async () => {
        const context = await new PineTS(candles, 'TEST:1858', '240').run(`${HEADER}if bar_index == 1
    strategy.close('seed', immediately = true)
    strategy.entry('rev', strategy.short)
`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy was not initialized');

        // La sortie seed et l'entrée opposée remplissent TOUTES DEUX à
        // l'ouverture de la barre 2 ; aucun fill ne prend la clôture 120.
        expect(strategy.closedtrades.map((trade: Trade) => trade.exit_price)).toEqual([110]);
        expect(strategy.closedtrades[0]).toMatchObject({ entry_id: 'seed', exit_bar_index: 2 });
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0]).toMatchObject({ entry_id: 'rev', size: -1, entry_price: 110 });
    });
});
