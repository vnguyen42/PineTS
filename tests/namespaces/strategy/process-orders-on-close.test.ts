import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processExitOrders, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { PineTS } from '../../../src/PineTS.class';
import { Series } from '../../../src/Series';
import { Order, StrategyState } from '../../../src/namespaces/strategy/types';

function makeContext(config: Record<string, unknown> = {}) {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'BTCUSDT',
        timeframe: 'D',
    });
    context.idx = 1;
    context.data.open = new Series([100, 110]);
    context.data.high = new Series([101, 120]);
    context.data.low = new Series([99, 105]);
    context.data.close = new Series([100, 115]);
    context.data.openTime = new Series([0, 86_400_000]);
    context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } };
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, ...config });
    return context;
}

function queueMarketEntry(context: Context, bar: number): Order {
    const strategy: StrategyState = context.strategy!;
    const order: Order = {
        id: 'L',
        direction: 1,
        qty: 1,
        type: 'market',
        bar,
        time: bar * 86_400_000,
        status: 'pending',
        category: 'entry',
    };
    strategy.pending_orders.push(order);
    return order;
}

describe('strategy process_orders_on_close — fill phase', () => {
    it('fills a current-bar market entry at that bar close when enabled', () => {
        const context = makeContext({ process_orders_on_close: true });
        const order = queueMarketEntry(context, 1);

        const fills = processStrategyOrders(context, 'close');

        expect(fills).toBe(1);
        expect(order.fill_price).toBe(115);
        expect(order.fill_bar).toBe(1);
        expect(context.strategy?.position_size).toBe(1);
    });

    it('keeps current-bar market entries deferred when process_orders_on_close is false', () => {
        const context = makeContext({ process_orders_on_close: false });
        const order = queueMarketEntry(context, 1);

        const fills = processStrategyOrders(context);

        expect(fills).toBe(0);
        expect(order.status).toBe('pending');
        expect(context.strategy?.position_size).toBe(0);
    });
});

describe('strategy process_orders_on_close — end-to-end execution', () => {
    const candles = [
        {
            openTime: 0, open: 98, high: 101, low: 97, close: 100, volume: 1000, closeTime: 86_399_999,
            quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0,
        },
        {
            openTime: 86_400_000, open: 110, high: 115, low: 105, close: 112, volume: 1000, closeTime: 172_799_999,
            quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0,
        },
    ];

    it('fills the normal bar-close entry without re-running user code', async () => {
        const source = `
//@version=5
strategy('POC', process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
var int evaluations = 0
evaluations += 1
if bar_index == 0
    strategy.entry('L', strategy.long)
plot(evaluations, 'evaluations')`;
        const engine = new PineTS(candles);
        const context = await engine.run(source);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        expect(strategy.opentrades.length).toBe(1);
        expect(strategy.opentrades[0].entry_price).toBe(100);
        expect(context.plots.evaluations.data.map((point: { value: number }) => point.value)).toEqual([1, 2]);
    });

    it('composes COF with close processing: close fill then one post-fill recalc, without reopening the loop', async () => {
        const source = `
//@version=5
strategy('COF + POC', calc_on_order_fills=true, process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
if strategy.position_size > 0
    strategy.close('L')`;
        const engine = new PineTS(candles);
        const context = await engine.run(source);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        expect(strategy.closedtrades.length).toBe(1);
        expect(strategy.closedtrades[0].entry_price).toBe(100);
        expect(strategy.closedtrades[0].exit_price).toBe(110);
    });

    it('keeps COF-only market fills on the existing intrabar tick path', () => {
        const context = makeContext({ calc_on_order_fills: true });
        const order = queueMarketEntry(context, 1);
        const strategy = context.strategy!;
        strategy._cof = { pass: 0, ticks: [110, 115, 105, 112] };

        const fills = processStrategyOrders(context);

        expect(fills).toBe(1);
        expect(order.fill_price).toBe(110);
    });

    it('does not fill a bracket queued in the same evaluation as a deferred limit entry (declared limitation)', () => {
        const context = makeContext({ process_orders_on_close: true });
        const strategy = context.strategy!;
        const entry: Order = {
            id: 'LL', direction: 1, qty: 1, type: 'limit', limit: 95,
            bar: 1, time: 86_400_000, status: 'pending', category: 'entry',
        };
        const bracket: Order = {
            id: 'X', direction: 0, qty: 0, type: 'market', category: 'exit',
            from_entry: 'LL', profit: 10, loss: 10,
            bar: 1, time: 86_400_000, status: 'pending',
        };
        strategy.pending_orders.push(entry, bracket);

        const entryFills = processStrategyOrders(context, 'close');
        const exitFills = processExitOrders(context, 'close');

        // No close-phase fill: the limit entry is not a market order and the
        // bracket has no matching trades yet (its entry has not filled). TV
        // would keep the bracket waiting ("exit orders placed before their
        // entry wait for it"); the close phase cancels it — declared VIN-73
        // limitation, not exercised by the 2841/2748 witnesses.
        expect(entryFills).toBe(0);
        expect(exitFills).toBe(0);
        expect(entry.status).toBe('pending');
        expect(bracket.status).toBe('cancelled');
        expect(strategy.position_size).toBe(0);
        expect(strategy.opentrades.length).toBe(0);
    });

    it('does not double-fill when the close phase runs again', () => {
        const context = makeContext({ process_orders_on_close: true });
        const order = queueMarketEntry(context, 1);

        const first = processStrategyOrders(context, 'close');
        const second = processStrategyOrders(context, 'close');

        expect(first).toBe(1);
        expect(second).toBe(0);
        expect(order.status).toBe('filled');
        expect(context.strategy?.position_size).toBe(1);
        expect(context.strategy?.opentrades.length).toBe(1);
    });
});
