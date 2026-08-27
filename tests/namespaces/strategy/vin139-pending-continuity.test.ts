import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { PineTS } from '../../../src/PineTS.class';
import { Series } from '../../../src/Series';
import { cancel } from '../../../src/namespaces/strategy/methods/cancel';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import {
    initializeStrategy,
    openTrade,
    processExitOrders,
} from '../../../src/namespaces/strategy/utils';
import { Order } from '../../../src/namespaces/strategy/types';

function makeContext() {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'NASDAQ:TEST',
        timeframe: 'D',
    });
    context.pine = { syminfo: { type: 'stock', mintick: 0.01, pointvalue: 1 } };
    context.pineVersion = 4;
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
    setBar(context, 0, 100, 101, 99, 100);
    return context;
}

function setBar(context: Context, idx: number, open: number, high: number, low: number, close: number) {
    context.idx = idx;
    context.data.open = new Series([open]);
    context.data.high = new Series([high]);
    context.data.low = new Series([low]);
    context.data.close = new Series([close]);
    context.data.openTime = new Series([idx * 86_400_000]);
}

function openLong(context: Context, entryId = 'L', price = 100) {
    openTrade(context, entryId, 1, 1, price, context.idx * 86_400_000);
}

function pendingExit(context: Context, id = 'x'): Order {
    const order = context.strategy!.pending_orders.find(
        (candidate) => candidate.category === 'exit' && candidate.id === id,
    );
    expect(order).toBeDefined();
    return order as Order;
}

function refreshExit(context: Context, id: string, params: Record<string, unknown>, callsiteId: string) {
    exit(context)(id, params, { __callsiteId: callsiteId });
}

describe('VIN-139 pending exit lifecycle continuity', () => {
    it('replays a minimal three-branch Pine source with one same-id exit lifecycle', async () => {
        const candles = [100, 100, 101, 101, 111].map((open, index) => ({
            openTime: index * 86_400_000,
            open,
            high: [100, 101, 102, 102, 112][index],
            low: [100, 99, 101, 101, 109][index],
            close: [100, 100, 101, 101, 110][index],
            volume: 1,
            closeTime: (index + 1) * 86_400_000 - 1,
            quoteAssetVolume: 0,
            numberOfTrades: 0,
            takerBuyBaseAssetVolume: 0,
            takerBuyQuoteAssetVolume: 0,
            ignore: 0,
        }));
        const source = `
//@version=5
strategy('VIN-139')
if bar_index == 0
    strategy.entry('L', strategy.long)
if strategy.position_size > 0
    if bar_index == 1
        strategy.exit('x', stop=95)
    else if bar_index == 2
        strategy.exit('x', stop=100)
    else if bar_index >= 3
        strategy.exit('x', stop=110)
`;
        const context = await new PineTS(candles).run(source);
        const closedTrades = context.strategy?.closedtrades ?? [];
        expect(closedTrades).toHaveLength(1);
        expect(closedTrades[0]).toMatchObject({ exit_id: 'x', exit_bar_index: 4, exit_price: 110 });
    });
    it('keeps a same-id bracket persistent across stop-loss, breakeven, and profit-stop callsites', () => {
        const lossToBreakeven = makeContext();
        openLong(lossToBreakeven);
        refreshExit(lossToBreakeven, 'x', { loss: 500 }, 'stage-loss');
        setBar(lossToBreakeven, 1, 101, 102, 99, 100);
        expect(processExitOrders(lossToBreakeven)).toBe(0);
        refreshExit(lossToBreakeven, 'x', { stop: 100 }, 'stage-breakeven');
        expect(pendingExit(lossToBreakeven)).toMatchObject({ stop: 100, _isPersistent: true });
        setBar(lossToBreakeven, 2, 101, 102, 99, 100);
        expect(processExitOrders(lossToBreakeven)).toBe(1);
        expect(lossToBreakeven.strategy!.closedtrades[0].exit_price).toBe(100);

        const breakevenToProfit = makeContext();
        openLong(breakevenToProfit);
        refreshExit(breakevenToProfit, 'x', { stop: 100 }, 'stage-breakeven');
        setBar(breakevenToProfit, 1, 101, 102, 101, 101);
        expect(processExitOrders(breakevenToProfit)).toBe(0);
        refreshExit(breakevenToProfit, 'x', { stop: 100 }, 'stage-breakeven');
        setBar(breakevenToProfit, 2, 101, 102, 101, 101);
        expect(processExitOrders(breakevenToProfit)).toBe(0);
        refreshExit(breakevenToProfit, 'x', { stop: 110 }, 'stage-profit-stop');
        expect(pendingExit(breakevenToProfit)).toMatchObject({ stop: 110, _isPersistent: true });
        setBar(breakevenToProfit, 3, 111, 112, 109, 110);
        expect(processExitOrders(breakevenToProfit)).toBe(1);
        expect(breakevenToProfit.strategy!.closedtrades[0].exit_price).toBe(110);
    });

    it('fills the newly staged stop on N+1 instead of the pre-fix N+3 control bar', () => {
        const context = makeContext();
        openLong(context);
        refreshExit(context, 'x', { stop: 100 }, 'stage-breakeven');
        setBar(context, 1, 101, 102, 101, 101);
        expect(processExitOrders(context)).toBe(0);
        refreshExit(context, 'x', { stop: 110 }, 'stage-profit-stop');

        setBar(context, 2, 111, 112, 109, 110);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades[0].exit_bar_index).toBe(2);
        expect(context.strategy!.closedtrades[0].exit_price).toBe(110);
    });

    it('allows a transitioned breakeven stop equal to the entry to fill on its first bar', () => {
        const context = makeContext();
        openLong(context);
        refreshExit(context, 'x', { loss: 500 }, 'stage-loss');
        setBar(context, 1, 101, 102, 101, 101);
        expect(processExitOrders(context)).toBe(0);
        refreshExit(context, 'x', { stop: 100 }, 'stage-breakeven');

        setBar(context, 2, 101, 102, 99, 100);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades[0].exit_price).toBe(100);
    });

    it('does not inherit persistence across a real sparse bar without an exit call', () => {
        const context = makeContext();
        openLong(context);
        refreshExit(context, 'x', { stop: 95 }, 'persistent-site');
        setBar(context, 1, 101, 102, 101, 101);
        expect(processExitOrders(context)).toBe(0);
        refreshExit(context, 'x', { stop: 95 }, 'persistent-site');

        setBar(context, 2, 101, 102, 101, 101);
        expect(processExitOrders(context)).toBe(0);
        setBar(context, 3, 101, 102, 101, 101);
        expect(processExitOrders(context)).toBe(0);
        refreshExit(context, 'x', { stop: 110 }, 'new-sparse-site');
        expect(pendingExit(context)).toMatchObject({ stop: 110, _isPersistent: false });

        setBar(context, 4, 111, 112, 109, 110);
        // A sparse (non-persistent) stop is still a live broker order: once
        // placed it stays pending until filled or cancelled, and the assumed
        // path crossing its level fills it. The legacy "wrong-side vs entry"
        // suppression is refuted by the 2444 ledger (stop above the pyramided
        // average — TV fills at the crossing bar). Persistence only governs
        // which call refreshes the level, not whether the order exists.
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades).toHaveLength(1);
        expect(context.strategy!.closedtrades[0].exit_price).toBe(110);
    });

    it('preserves persistence through two same-bar refreshes while the last definition wins', () => {
        const context = makeContext();
        openLong(context);
        refreshExit(context, 'x', { stop: 95 }, 'persistent-site');
        setBar(context, 1, 101, 102, 101, 101);
        expect(processExitOrders(context)).toBe(0);
        refreshExit(context, 'x', { stop: 95 }, 'persistent-site');
        refreshExit(context, 'x', { stop: 110 }, 'new-same-bar-site');
        expect(pendingExit(context)).toMatchObject({ stop: 110, _isPersistent: true });

        setBar(context, 2, 111, 112, 109, 110);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades[0].exit_price).toBe(110);
    });

    it('does not inherit persistence after cancel then same-id recreation', () => {
        const context = makeContext();
        openLong(context);
        refreshExit(context, 'x', { stop: 95 }, 'persistent-site');
        setBar(context, 1, 101, 102, 101, 101);
        expect(processExitOrders(context)).toBe(0);
        refreshExit(context, 'x', { stop: 95 }, 'persistent-site');
        cancel(context)('x');
        expect(context.strategy!.pending_orders).toHaveLength(0);
        refreshExit(context, 'x', { stop: 110 }, 'recreated-site');
        expect(pendingExit(context)).toMatchObject({ stop: 110, _isPersistent: false });

        setBar(context, 2, 111, 112, 109, 110);
        // The recreated stop is a live broker order whose level the bar's
        // path crosses => it fills at 110 (2444: crossing beats the legacy
        // wrong-side suppression).
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades).toHaveLength(1);
        expect(context.strategy!.closedtrades[0].exit_price).toBe(110);
    });

    it('does not inherit persistence after the old same-id order filled', () => {
        const context = makeContext();
        openLong(context, 'L1');
        refreshExit(context, 'x', { stop: 95 }, 'old-site');
        setBar(context, 1, 101, 102, 94, 95);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.pending_orders).toHaveLength(0);
        expect(context.strategy!.closedtrades).toHaveLength(1);

        setBar(context, 2, 101, 102, 101, 101);
        openLong(context, 'L2');
        refreshExit(context, 'x', { stop: 110 }, 'new-lifecycle-site');
        expect(pendingExit(context)).toMatchObject({ stop: 110, _isPersistent: false });
        setBar(context, 3, 111, 112, 109, 110);
        // The new lifecycle's stop crosses the bar's path and fills — the
        // order is live regardless of persistence (2444 rule).
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades).toHaveLength(2);
        expect(context.strategy!.closedtrades[1].exit_price).toBe(110);
    });

    it('rounds stock stops toward market and limits away from market by position direction', () => {
        const long = makeContext();
        openLong(long);
        refreshExit(long, 'long-stop', { stop: 64.255 }, 'long-stop-site');
        refreshExit(long, 'long-limit', { limit: 64.255 }, 'long-limit-site');
        expect(pendingExit(long, 'long-stop').stop).toBe(64.25);
        expect(pendingExit(long, 'long-limit').limit).toBe(64.26);
        const fractionalReference = makeContext();
        openLong(fractionalReference, 'fractional', 100.005);
        refreshExit(fractionalReference, 'fractional-stop', { stop: 100.005 }, 'fractional-stop-site');
        refreshExit(fractionalReference, 'fractional-limit', { limit: 100.005 }, 'fractional-limit-site');
        expect(pendingExit(fractionalReference, 'fractional-stop').stop).toBe(100);
        expect(pendingExit(fractionalReference, 'fractional-limit').limit).toBe(100.01);


        const short = makeContext();
        openTrade(short, 'S', -1, 1, 100, 0);
        refreshExit(short, 'short-stop', { stop: 76.485 }, 'short-stop-site');
        refreshExit(short, 'short-limit', { limit: 76.485 }, 'short-limit-site');
        expect(pendingExit(short, 'short-stop').stop).toBe(76.49);
        expect(pendingExit(short, 'short-limit').limit).toBe(76.48);
    });
});
