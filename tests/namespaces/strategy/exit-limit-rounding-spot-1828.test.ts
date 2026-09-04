// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille : arrondi de limite exit sur spot crypto — id révélateur 1828
// (BINANCE:XLMUSDT, tf D). TradingView arrondit une limite absolue de sortie
// dans le sens qui éloigne le prix du côté défavorable de la position : long
// vers le haut, short vers le bas. Le contrôle stop vérifie que cette règle
// reste limitée aux limites et que le stop spot conserve son placement dirigé
// par la référence.
import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { StrategyState } from '../../../src/namespaces/strategy/types';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { initializeStrategy, openTrade, processExitOrders } from '../../../src/namespaces/strategy/utils';

type AssetType = 'spot' | 'stock';
type Direction = -1 | 0 | 1;
type ExitLeg = 'limit' | 'stop';

type Bar = {
    open: number;
    high: number;
    low: number;
    close: number;
};

function strategyOf(context: Context): StrategyState {
    if (!context.strategy) throw new Error('strategy state was not initialized');
    return context.strategy;
}

function makeContext({
    type = 'spot',
    direction,
    currentClose = 0.07426,
    positionAverage = currentClose,
    mintick = 0.0001,
}: {
    type?: AssetType;
    direction: Direction;
    currentClose?: number;
    positionAverage?: number;
    mintick?: number;
}): Context {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: type === 'stock' ? 'NASDAQ:TEST' : 'BINANCE:XLMUSDT',
        timeframe: 'D',
    });
    context.idx = 0;
    context.data.open = new Series([currentClose]);
    context.data.high = new Series([currentClose]);
    context.data.low = new Series([currentClose]);
    context.data.close = new Series([currentClose]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick, pointvalue: 1, type };
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
    if (direction !== 0) {
        openTrade(context, direction === 1 ? 'L' : 'S', direction, 1, positionAverage, 0);
    }
    return context;
}

function makeBars(context: Context, bar: Bar): void {
    context.idx = 1;
    context.data.open = new Series([0, bar.open]);
    context.data.high = new Series([0, bar.high]);
    context.data.low = new Series([0, bar.low]);
    context.data.close = new Series([0, bar.close]);
    context.data.openTime = new Series([0, 86_400_000]);
}

function queueExit(context: Context, entryId: string, leg: ExitLeg, rawLevel: number) {
    const placeExit = exit(context);
    if (leg === 'limit') placeExit('X', entryId, { limit: rawLevel });
    else placeExit('X', entryId, { stop: rawLevel });

    const pending = strategyOf(context).pending_orders.find(
        (order) => order.category === 'exit' && order.status === 'pending' && order.id === 'X',
    );
    if (!pending) throw new Error('exit order was not queued');
    return pending;
}

function expectFilledAt(context: Context, bar: Bar, expectedPrice: number): void {
    const strategy = strategyOf(context);
    makeBars(context, bar);
    expect(processExitOrders(context, 'intrabar')).toBe(1);
    expect(strategy.closedtrades).toHaveLength(1);
    expect(strategy.closedtrades[0]?.exit_price).toBe(expectedPrice);
}

describe('exit limit rounding on spot crypto (1828 XLMUSDT)', () => {
    it('rounds the short absolute limit down and fills the 1828 seed at 0.0742', () => {
        const context = makeContext({ direction: -1 });
        const pending = queueExit(context, 'S', 'limit', 0.074295);

        expect(pending.limit).toBe(0.0742);
        expectFilledAt(context, {
            open: 0.07426,
            high: 0.07431,
            low: 0.07419,
            close: 0.0742,
        }, 0.0742);
    });

    it('rounds the long absolute limit up on the same spot grid', () => {
        const context = makeContext({ direction: 1 });
        const pending = queueExit(context, 'L', 'limit', 0.074295);

        expect(pending.limit).toBe(0.0743);
        expectFilledAt(context, {
            open: 0.07426,
            high: 0.07431,
            low: 0.07419,
            close: 0.0743,
        }, 0.0743);
    });

    it('keeps reference-directed limit placement when there is no position', () => {
        const context = makeContext({ direction: 0 });
        const pending = queueExit(context, 'S', 'limit', 0.074295);

        expect(pending.limit).toBe(0.0743);
        expect(strategyOf(context).closedtrades).toHaveLength(0);
    });

    it('keeps spot short stop rounding directed by the current close', () => {
        const context = makeContext({ direction: -1 });
        const pending = queueExit(context, 'S', 'stop', 0.074255);

        // A spot stop has no forced direction: this level is just below the
        // close and therefore rounds down, unlike a stock short stop.
        expect(pending.stop).toBe(0.0742);
    });

    it('keeps the established stock long limit behavior unchanged', () => {
        const context = makeContext({
            type: 'stock',
            direction: 1,
            currentClose: 0.08,
            positionAverage: 0.05,
            mintick: 0.01,
        });
        const pending = queueExit(context, 'L', 'limit', 0.073);

        expect(pending.limit).toBe(0.08);
        expectFilledAt(context, {
            open: 0.079,
            high: 0.081,
            low: 0.078,
            close: 0.08,
        }, 0.08);
    });
});
