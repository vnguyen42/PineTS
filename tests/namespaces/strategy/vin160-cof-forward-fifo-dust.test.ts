import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// VIN-160: original time-only probe reproduces the real ETH 1502 residual.
// TradingView CSV ETH_forward_odd_fraction_corrected_seed_BINANCE_ETHUSDT_2026-09-07.csv:
// A later activation must consume the 0.0001 FIFO remainder of the forward fill.
const candles = [
    [1772409600000, 1939.71, 1989.23, 1937.42, 1972.3, 69056.6329],
    [1772424000000, 1972.3, 1983.6, 1925.53, 1941.66, 58667.3787],
    [1772438400000, 1941.65, 1967.13, 1920, 1947.81, 61905.2816],
    [1772452800000, 1947.8, 2065.48, 1921.7, 2047.33, 181807.1215],
    [1772467200000, 2047.33, 2090, 2017.15, 2043.57, 122416.9126],
    [1772481600000, 2043.56, 2058.59, 2024.32, 2027.35, 83553.0476],
    [1772496000000, 2027.34, 2041.48, 1998, 2008.88, 72387.9676],
    [1772510400000, 2008.88, 2019.4, 1987.5, 1996.33, 54747.8134],
    [1772524800000, 1996.32, 2000.53, 1939.1, 1961.28, 94656.1381],
    [1772539200000, 1961.28, 1990.07, 1929.56, 1969.22, 138896.9913],
    [1772553600000, 1969.21, 2014.12, 1958.76, 1986.02, 112467.8933],
    [1772568000000, 1986.03, 2001.63, 1959.35, 1982.8, 36173.0497],
    [1772582400000, 1982.81, 1998.66, 1945.08, 1960.9, 62339.7285],
    [1772596800000, 1960.89, 2010, 1950.65, 2006.55, 52487.5859],
    [1772611200000, 2006.55, 2092.9, 2000.47, 2054.97, 187331.0723],
    [1772625600000, 2054.97, 2157.67, 2036.37, 2150.23, 202994.5808],
    [1772640000000, 2150.23, 2199, 2129.13, 2177.51, 171810.7114],
    [1772654400000, 2177.51, 2179.66, 2116.67, 2127.28, 60681.1363],
    [1772668800000, 2127.28, 2141.93, 2107.5, 2120.15, 54056.4032],
    [1772683200000, 2120.15, 2144.2, 2095.71, 2104.96, 54039.2126],
    [1772697600000, 2104.96, 2163.66, 2093.63, 2137.92, 70522.7353],
    [1772712000000, 2137.92, 2142.95, 2067.54, 2086.96, 124518.7575],
    [1772726400000, 2086.95, 2093.7, 2054.75, 2074.36, 89377.0807],
    [1772740800000, 2074.37, 2099.36, 2069.72, 2072.86, 39643.6233],
    [1772755200000, 2072.86, 2093.33, 2061.79, 2083.8, 39076.4167],
    [1772769600000, 2083.81, 2087.66, 2058.84, 2082.83, 45370.5524],
    [1772784000000, 2082.83, 2082.83, 2045.79, 2051.03, 50661.1023],
    [1772798400000, 2051.03, 2062.12, 1966.24, 1978.01, 172028.7426],
    [1772812800000, 1978, 1993.3, 1955.95, 1983.75, 75044.6173],
    [1772827200000, 1983.75, 1989.91, 1969.26, 1978.68, 29416.3256],
    [1772841600000, 1978.68, 1996.04, 1971.79, 1980.21, 27984.3292],
    [1772856000000, 1980.22, 1984.19, 1964.34, 1982.94, 40763.1763],
    [1772870400000, 1982.94, 1994.98, 1975.38, 1988.91, 29519.2921],
].map(([openTime, open, high, low, close, volume]) => ({
    openTime, open, high, low, close, volume, closeTime: openTime + 14_400_000,
}));
const source = `//@version=5
strategy("ETH forward odd fraction witness", overlay=true, calc_on_order_fills=true, pyramiding=10, initial_capital=100000, margin_long=0, margin_short=0)
if time == timestamp("UTC", 2026, 3, 2, 0, 0)
    strategy.entry("seed", strategy.long, qty=1)
if time == timestamp("UTC", 2026, 3, 2, 8, 0)
    strategy.close_all()
if time == timestamp("UTC", 2026, 3, 2, 12, 0)
    strategy.entry("buy", strategy.long, qty=48.8441)
strategy.exit("Tg1", "buy", limit=strategy.position_avg_price * 1.05, qty_percent=50)
strategy.exit("Tg2", "buy", limit=strategy.position_avg_price * 1.10, qty_percent=100)
if time == timestamp("UTC", 2026, 3, 7, 0, 0)
    strategy.close_all()
`;
const expected = [
    [1772424000000, 1772452800000, 1972.3, 1947.8, 1.0],
    [1772452800000, 1772452800000, 1947.8, 2045.19, 24.422],
    [1772452800000, 1772452800000, 1947.8, 2045.19, 24.422],
    [1772452800000, 1772452800000, 1947.8, 2065.48, 0.0001],
    [1772452800000, 1772452800000, 1921.7, 2065.48, 24.4219],
    [1772452800000, 1772625600000, 1921.7, 2130.94, 24.422],
    [1772452800000, 1772856000000, 1921.7, 1980.22, 0.0002],
    [1772452800000, 1772856000000, 2065.48, 1980.22, 48.8441],
    [1772467200000, 1772856000000, 2047.33, 1980.22, 48.8441],
];

// Unequal high-entry size proves that its own bracket supplies the 5-unit exit.
const differentSizeExpected = [
    [1772424000000, 1772452800000, 1972.3, 1947.8, 1.0],
    [1772452800000, 1772452800000, 1947.8, 2045.19, 24.422],
    [1772452800000, 1772452800000, 1947.8, 2045.19, 24.422],
    [1772452800000, 1772452800000, 1947.8, 2065.48, 0.0001],
    [1772452800000, 1772452800000, 1921.7, 2065.48, 4.9999],
    [1772452800000, 1772467200000, 1921.7, 2047.33, 5.0],
    [1772452800000, 1772640000000, 1921.7, 2164.24, 24.4221],
    [1772452800000, 1772640000000, 1921.7, 2164.24, 14.4221],
    [1772452800000, 1772640000000, 2065.48, 2164.24, 10.0],
    [1772467200000, 1772640000000, 2047.33, 2164.24, 5.0],
    [1772467200000, 1772640000000, 2047.33, 2164.24, 5.0],
];

describe('VIN-160 COF percent exits respect the instrument quantity step', () => {
    it.each([
        { label: 'equal-sized entries', source, expected },
        { label: 'smaller high entry',
            source: source.replace('qty=48.8441', 'qty=strategy.closedtrades >= 3 ? 10 : 48.8441'),
            expected: differentSizeExpected },
    ])('preserves activation rights and physical FIFO for $label', async ({ source, expected }) => {
        const provider = {
            configure() {},
            getQtyStep() { return 0.0001; },
            async getMarketData() { return candles; },
            async getSymbolInfo() {
                return { ticker: 'ETHUSDT', tickerid: 'BINANCE:ETHUSDT', mintick: 0.01,
                    mincontract: 0.0001, pointvalue: 1, type: 'crypto', currency: 'USDT',
                    timezone: 'Etc/UTC', session: '24x7' };
            },
        };
        const result = await new PineTS(provider as any, 'ETHUSDT', '240').run(source);
        expect(result.strategy!.opentrades).toHaveLength(0);
        expect(result.strategy!.closedtrades).toHaveLength(expected.length);
        for (const [i, values] of expected.entries()) {
            const [entryTime, exitTime, entryPrice, exitPrice, size] = values;
            const trade = result.strategy!.closedtrades[i];
            expect(trade.entry_time).toBe(entryTime);
            expect(trade.exit_time).toBe(exitTime);
            expect(trade.entry_price).toBeCloseTo(entryPrice, 8);
            expect(trade.exit_price).toBeCloseTo(exitPrice, 8);
            expect(Math.abs(trade.size)).toBeCloseTo(size, 8);
            expect(trade.profit).toBeCloseTo((exitPrice - entryPrice) * size, 6);
        }
    });
});
