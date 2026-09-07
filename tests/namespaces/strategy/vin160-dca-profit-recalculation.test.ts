import { expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// VIN-160: the real BTC DCA script 2030 changed after the ETH COF fix.
// TradingView's reduced witness and matching OHLC were checked 2026-09-07.
// The entry fill must allow recalculation before the later take-profit fill.
it.each(['profit=close * 0.03 / syminfo.mintick', 'limit=40413.37 + close * 0.03'])(
    'VIN-160 recalculates the first DCA activation before its TP fills (%s)', async (exitArgument) => {
    const candles = [
        [1705665600000, 41475.37, 41488.2, 40718, 40894.71, 9260.88788],
        [1705680000000, 40894.71, 41979, 40280, 41814.27, 16100.60089],
    ].map(([openTime, open, high, low, close, volume]) => ({
        openTime, open, high, low, close, volume, closeTime: openTime + 14_400_000 - 1,
    }));
    const provider = {
        configure() {},
        async getMarketData() { return candles; },
        async getSymbolInfo() {
            return {
                ticker: 'BTCUSDT', tickerid: 'BINANCE:BTCUSDT', main_tickerid: 'BINANCE:BTCUSDT',
                prefix: 'BINANCE', root: 'BTC', description: 'BTC / USDT', type: 'crypto',
                basecurrency: 'BTC', currency: 'USDT', timezone: 'Etc/UTC', session: '24x7',
                mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1, mincontract: 0.00001,
            };
        },
    };
    const source = `//@version=5
strategy("DCA pending profit before fill recalculation", overlay=true, pyramiding=99, initial_capital=500000, calc_on_order_fills=true, commission_type=strategy.commission.percent, commission_value=0.075)
if time == timestamp("UTC", 2024, 1, 19, 12, 0)
    strategy.entry("DCA", strategy.long, qty=1, limit=40413.37)
strategy.exit("TP", "DCA", ${exitArgument})`;
    const result = await new PineTS(provider as any, 'BTCUSDT', '240').run(source);
    expect(result.strategy!.opentrades).toHaveLength(0);
    expect(result.strategy!.closedtrades).toHaveLength(1);
    const trade = result.strategy!.closedtrades[0];
    expect(trade.entry_time).toBe(1705680000000);
    expect(trade.exit_time).toBe(1705680000000);
    expect(trade.entry_price).toBe(40413.37);
    expect(trade.exit_price).toBe(41667.8);
    expect(trade.size).toBe(1);
    expect(trade.commission).toBeCloseTo(61.5608775, 8);
    expect(trade.profit).toBeCloseTo(1192.8691225, 8);
});
