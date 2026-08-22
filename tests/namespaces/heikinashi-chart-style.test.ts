import { PineTS } from 'index';
import { describe, expect, it } from 'vitest';

import type { Kline } from '@pinets/marketData/types';
import { Provider } from '@pinets/marketData/Provider.class';
import {
    splitTickerModifier,
    stripTickerModifier,
    transformHeikinAshi,
    withTickerModifier,
} from '../../src/tickerModifier';

const RANGE = [new Date('2025-01-01').getTime(), new Date('2025-03-01').getTime()] as const;

function candle(open: number, high: number, low: number, close: number, openTime: number): Kline {
    return {
        open,
        high,
        low,
        close,
        volume: 100,
        openTime,
        closeTime: openTime + 60_000,
        quoteAssetVolume: 0,
        numberOfTrades: 1,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

describe('Heikin-Ashi chart style (extended tickers + chartStyle)', () => {
    it('transforms the complete feed with the TV recurrence and first-bar rule', () => {
        const raw = [
            candle(10, 14, 8, 12, 0),
            candle(12, 16, 10, 14, 60_000),
            candle(14, 15, 9, 10, 120_000),
            candle(10, 18, 7, 16, 180_000),
            candle(16, 17, 13, 14, 240_000),
        ];
        const transformed = transformHeikinAshi(raw);

        expect(transformed.map(({ open, high, low, close }) => ({ open, high, low, close }))).toEqual([
            { open: 11, high: 14, low: 8, close: 11 },
            { open: 11, high: 16, low: 10, close: 13 },
            { open: 12, high: 15, low: 9, close: 12 },
            { open: 12, high: 18, low: 7, close: 12.75 },
            { open: 12.375, high: 17, low: 12.375, close: 15 },
        ]);
        expect(raw[1].open).toBe(12);
        expect(transformed[0].volume).toBe(raw[0].volume);
        expect(transformed[0].openTime).toBe(raw[0].openTime);
    });

    it('v5 ticker.heikinashi security returns HA values on a manual feed', async () => {
        const raw = [
            candle(10, 14, 8, 12, 0),
            candle(12, 16, 10, 14, 60_000),
            candle(14, 15, 9, 10, 120_000),
            candle(10, 18, 7, 16, 180_000),
            candle(16, 17, 13, 14, 240_000),
        ];
        const engine = new PineTS(raw, 'TEST', 'D');
        const source = `//@version=5
indicator("heikinashi security")
ha = request.security(ticker.heikinashi("TEST"), "D", close)
standard = request.security(ticker.standard("TEST"), "D", close)
plot(ha, "ha")
plot(standard, "standard")
`;
        const context = await engine.run(source);
        const values = (name: string) => context.plots[name].data.map((point: { value: number }) => point.value);

        expect(values('ha')).toEqual([11, 13, 12, 12.75, 15]);
        expect(values('standard')).toEqual([12, 14, 10, 16, 14]);
    });

    it('tickerModifier helpers split/strip/append the chart-type suffix', () => {
        expect(splitTickerModifier('BINANCE:BTCUSDT;heikinashi')).toEqual({ symbol: 'BINANCE:BTCUSDT', modifier: 'heikinashi' });
        expect(splitTickerModifier('BINANCE:BTCUSDT')).toEqual({ symbol: 'BINANCE:BTCUSDT', modifier: null });
        expect(splitTickerModifier('BTCUSDT;unknownthing')).toEqual({ symbol: 'BTCUSDT;unknownthing', modifier: null }); // unknown suffixes stay part of the symbol
        expect(stripTickerModifier('BTCUSDT;heikinashi')).toBe('BTCUSDT');
        expect(withTickerModifier('BTCUSDT', 'heikinashi')).toBe('BTCUSDT;heikinashi');
        expect(withTickerModifier('BTCUSDT;heikinashi', 'heikinashi')).toBe('BTCUSDT;heikinashi'); // idempotent
    });

    it('ticker.heikinashi() appends the modifier; ticker.standard() strips it; ticker.inherit() propagates it', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, RANGE[0], RANGE[1]);
        const { result } = await pineTS.run((context) => {
            const ha = ticker.heikinashi(syminfo.tickerid);
            const std = ticker.standard(ha);
            const stdNoArg = ticker.standard();
            const inheritHa = ticker.inherit(ha, 'BINANCE:ETHUSDT');
            const inheritStd = ticker.inherit(std, 'BINANCE:ETHUSDT');
            return { ha, std, stdNoArg, inheritHa, inheritStd };
        });
        expect(result.ha[0]).toBe('BINANCE:BTCUSDC;heikinashi');
        expect(result.std[0]).toBe('BINANCE:BTCUSDC');
        expect(result.stdNoArg[0]).toBe('BINANCE:BTCUSDC');
        expect(result.inheritHa[0]).toBe('BINANCE:ETHUSDT;heikinashi'); // chart type inherited
        expect(result.inheritStd[0]).toBe('BINANCE:ETHUSDT');
    });

    it('default chart: is_standard true, is_heikinashi false, tickerid clean', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, RANGE[0], RANGE[1]);
        const { result } = await pineTS.run((context) => {
            const isStd = chart.is_standard; // Pine variables — bare member access
            const isHa = chart.is_heikinashi;
            const tid = syminfo.tickerid;
            return { isStd, isHa, tid };
        });
        expect(result.isStd[0]).toBe(true);
        expect(result.isHa[0]).toBe(false);
        expect(result.tid[0]).toBe('BINANCE:BTCUSDC');
    });

    it('an extended constructor ticker IS the chart type: predicates flip and syminfo.tickerid gains the suffix', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC;heikinashi', 'D', null, RANGE[0], RANGE[1]);
        const { result } = await pineTS.run((context) => {
            const isStd = chart.is_standard; // Pine variables — bare member access
            const isHa = chart.is_heikinashi;
            const tid = syminfo.tickerid;
            const std = ticker.standard(); // strips the modifier back off
            return { isStd, isHa, tid, std };
        });
        expect(result.isStd[0]).toBe(false);
        expect(result.isHa[0]).toBe(true);
        expect(result.tid[0]).toBe('BINANCE:BTCUSDC;heikinashi');
        expect(result.std[0]).toBe('BINANCE:BTCUSDC');
    });

    it('REAL Pine source: bare chart.is_* member access resolves as a VARIABLE through the transpiler', async () => {
        // Locks the transpiler contract the getters rely on: non-computed `chart.*` member
        // access is a plain property read (like syminfo.tickerid / barstate.islast), NOT
        // auto-converted to a call (the ta.tr / math.pi constant treatment).
        const src = `//@version=5
indicator("probe")
v1 = chart.is_heikinashi ? 1 : 0
v2 = chart.is_standard ? 1 : 0
plot(v1, "v1")
plot(v2, "v2")
`;
        const onHa = new PineTS(Provider.Mock, 'BTCUSDC;heikinashi', 'D', null, RANGE[0], RANGE[1]);
        const haCtx: any = await onHa.run(src);
        const last = (ctx: any, k: string): number => {
            const d = ctx.plots[k].data;
            return d[d.length - 1].value;
        };
        expect(last(haCtx, 'v1')).toBe(1);
        expect(last(haCtx, 'v2')).toBe(0);

        const onStd = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, RANGE[0], RANGE[1]);
        const stdCtx: any = await onStd.run(src);
        expect(last(stdCtx, 'v1')).toBe(0);
        expect(last(stdCtx, 'v2')).toBe(1);
    });

    it('security on an extended ticker materializes Heikin-Ashi candles', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, RANGE[0], RANGE[1]);
        const { result } = await pineTS.run((context) => {
            const haClose = request.security(ticker.heikinashi(syminfo.tickerid), 'W', close);
            const stdClose = request.security(ticker.standard(syminfo.tickerid), 'W', close);
            return { haClose, stdClose };
        });
        expect(Number.isFinite(result.haClose[0])).toBe(true);
        expect(Number.isFinite(result.stdClose[0])).toBe(true);
        expect(result.haClose.some((value: number, index: number) =>
            Number.isFinite(value) && Number.isFinite(result.stdClose[index]) && value !== result.stdClose[index]
        )).toBe(true);
    });

    it('provider receives the STRIPPED ticker; the engine transforms once (single-transform contract)', async () => {
        const raw = [
            candle(10, 14, 8, 12, 0),
            candle(12, 16, 10, 14, 60_000),
            candle(14, 15, 9, 10, 120_000),
            candle(10, 18, 7, 16, 180_000),
            candle(16, 17, 13, 14, 240_000),
        ];
        const seen: string[] = [];
        const provider = {
            configure() {},
            async getMarketData(tickerId: string) {
                seen.push(tickerId);
                return raw;
            },
            async getSymbolInfo(tickerId: string) {
                seen.push(`info:${tickerId}`);
                return {
                    ticker: 'TEST', tickerid: 'FILE:TEST', main_tickerid: 'FILE:TEST', prefix: 'FILE',
                    root: 'TEST', description: 'TEST / USDT', type: 'crypto', basecurrency: 'TEST',
                    currency: 'USDT', timezone: 'Etc/UTC', mintick: 0.01, pricescale: 100, minmove: 1,
                    pointvalue: 1, mincontract: 0.00001, session: '24x7', volumetype: 'base',
                };
            },
        };
        const engine = new PineTS(provider, 'TEST;heikinashi', 'D');
        const source = `//@version=5
indicator("single transform")
v = request.security(ticker.heikinashi("TEST"), "D", close)
plot(v, "v")
`;
        const context = await engine.run(source);
        const values = context.plots.v.data.map((point: { value: number }) => point.value);

        // The provider saw only the clean ticker, never the modifier.
        expect(seen.every((t) => !t.includes('heikinashi'))).toBe(true);
        // Single transform: exactly the manual HA closes of the STANDARD feed.
        expect(values).toEqual([11, 13, 12, 12.75, 15]);
    });

    it('same-tf shortcut is chart-type aware: standard request on a heikinashi chart builds a secondary', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC;heikinashi', 'D', null, RANGE[0], RANGE[1]);
        const { result } = await pineTS.run((context) => {
            // Same timeframe, EXPLICITLY standard: must not shortcut to the
            // chart's Heikin-Ashi series. It builds a standard secondary.
            const viaStd = request.security(ticker.standard(syminfo.tickerid), 'D', close);
            // Same timeframe, chart's own tickerid (modifier included): shortcut path
            // and the chart's transformed Heikin-Ashi close.
            const viaSelf = request.security(syminfo.tickerid, 'D', close);
            return { viaStd, viaSelf };
        });
        expect(Number.isFinite(result.viaStd[0])).toBe(true);
        expect(Number.isFinite(result.viaSelf[0])).toBe(true);
    });
});
