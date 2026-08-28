import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { PineTS } from '../../../src/PineTS.class';

type Candle = {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
    quoteAssetVolume: number;
    numberOfTrades: number;
    takerBuyBaseAssetVolume: number;
    takerBuyQuoteAssetVolume: number;
    ignore: number;
};

const candles: Candle[] = [
    {
        openTime: 0,
        open: 98,
        high: 101,
        low: 97,
        close: 100,
        volume: 1000,
        closeTime: 86_399_999,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    },
    {
        openTime: 86_400_000,
        open: 110,
        high: 115,
        low: 105,
        close: 112,
        volume: 1000,
        closeTime: 172_799_999,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    },
    {
        openTime: 172_800_000,
        open: 112,
        high: 118,
        low: 108,
        close: 116,
        volume: 1000,
        closeTime: 259_199_999,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    },
];

function plotValues(context: Context, name: string): number[] {
    return context.plots[name].data.map((point: { value: number }) => point.value);
}

describe('strategy POC history pre-fill — 2511', () => {
    it('keeps history at the last script-visible state before the close fill', async () => {
        const source = `
//@version=5
strategy('POC history pre-fill 2511', process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
plot(strategy.position_size[1], 'previous_position')
plot(strategy.position_avg_price[1], 'previous_average')
plot(strategy.opentrades[1], 'previous_open_trades')`;

        const context = await new PineTS(candles).run(source);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        // Bar 0's close fill happens after its script evaluation. The bar-1
        // script must therefore see the pre-fill state from bar 0.
        expect(plotValues(context, 'previous_position')).toEqual([NaN, 0, 1]);
        expect(plotValues(context, 'previous_average')).toEqual([NaN, NaN, 100]);
        expect(plotValues(context, 'previous_open_trades')).toEqual([NaN, 0, 1]);

        // VIN-79: one history entry per executed bar, including POC bars.
        expect(strategy._series_history?.position_size).toHaveLength(candles.length);
        expect(strategy._series_history?.position_avg_price).toHaveLength(candles.length);
        expect(strategy._series_history?.opentrades).toHaveLength(candles.length);
        expect(strategy._series_history?.position_size).toEqual([0, 1, 1]);
    });
    it('replaces the POC history entry after a COF close-fill recalculation', async () => {
        const source = `
//@version=5
strategy('COF + POC history 2511', calc_on_order_fills=true, process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
plot(strategy.position_size[1], 'previous_position')`;

        const context = await new PineTS(candles).run(source);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        // COF's post-fill execution is the last script execution on bar 0,
        // so it replaces—not appends—a single VIN-79 history entry.
        expect(plotValues(context, 'previous_position')).toEqual([NaN, 1, 1]);
        expect(strategy._series_history?.position_size).toHaveLength(candles.length);
        expect(strategy._series_history?.position_size).toEqual([1, 1, 1]);
    });
    it('keeps one history entry per re-executed bar in a partial runTail', async () => {
        const c = (t: number, open: number, high: number, low: number, close: number): Candle => ({
            openTime: t,
            open,
            high,
            low,
            close,
            volume: 1000,
            closeTime: t + 86_399_999,
            quoteAssetVolume: 0,
            numberOfTrades: 0,
            takerBuyBaseAssetVolume: 0,
            takerBuyQuoteAssetVolume: 0,
            ignore: 0,
        });
        const feed = [
            c(0, 98, 101, 97, 100),
            c(86_400_000, 110, 115, 105, 112),
            c(172_800_000, 112, 118, 108, 116),
            c(259_200_000, 116, 120, 110, 118),
        ];
        const provider = {
            feed,
            async getMarketData() {
                return this.feed;
            },
            async getSymbolInfo() {
                return {
                    ticker: 'BTCUSDT',
                    tickerid: 'FILE:BTCUSDT',
                    type: 'crypto',
                    timezone: 'Etc/UTC',
                    mintick: 0.01,
                    pointvalue: 1,
                    mincontract: 0.00001,
                    session: '24x7',
                    currency: 'USD',
                    basecurrency: 'BTC',
                };
            },
        };
        const source = `//@version=5
strategy('partial 2511', calc_on_order_fills=true, process_orders_on_close=true, pyramiding=100, default_qty_type=strategy.fixed, default_qty_value=1)
strategy.entry('L' + str.tostring(bar_index), strategy.long)
plot(strategy.position_size[1], 'prev')`;
        const engine = new PineTS(provider as any, 'BTCUSDT', 'D');
        const context = await engine.run(source, 1);

        provider.feed = [
            ...feed.slice(0, 3),
            c(259_200_000, 116, 121, 109, 119),
            c(345_600_000, 119, 123, 115, 120),
        ];
        await engine.updateTail(context);

        expect(context.strategy?._series_history?.position_size).toEqual([6, 11]);
        expect(context.plots.prev.data.map((point: { value: number }) => point.value)).toEqual([NaN, 1, 6]);
    });
    it('does not append stale history on a no-fill partial updateTail', async () => {
        const partialFeed = [
            ...candles,
            {
                ...candles[2],
                openTime: 259_200_000,
                open: 116,
                high: 120,
                low: 110,
                close: 118,
                closeTime: 345_599_999,
            },
        ];
        const provider = {
            feed: partialFeed,
            async getMarketData() {
                return this.feed;
            },
            async getSymbolInfo() {
                return null;
            },
        };
        const source = `//@version=5
strategy('partial no-fill 2511', calc_on_order_fills=true, process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
plot(strategy.position_size[1], 'prev')`;
        const engine = new PineTS(provider as any, 'BTCUSDT', 'D');
        const context = await engine.run(source, 1);

        provider.feed = [
            ...partialFeed.slice(0, 3),
            { ...partialFeed[3], high: 121, low: 109, close: 119 },
            {
                ...partialFeed[3],
                openTime: 345_600_000,
                open: 119,
                high: 123,
                low: 115,
                close: 120,
                closeTime: 431_999_999,
            },
        ];
        await engine.updateTail(context);

        expect(context.strategy?._series_history?.position_size).toEqual([0, 0]);
        expect(context.strategy?._series_history?.position_size).toHaveLength(2);
    });
});
