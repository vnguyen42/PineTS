import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// VIN-161: original ETHUSDT 4h TradingView probe, 2026-09-07.
// A short with 100% margin still has a liquidation price; liquidation
// floors the covered quantity to 0.0001 before multiplying it by four.
const candles = [
    [1772438400000, 1941.65, 1967.13, 1920, 1947.81],
    [1772452800000, 1947.8, 2065.48, 1921.7, 2047.33],
    [1772467200000, 2047.33, 2090, 2017.15, 2043.57],
    [1772481600000, 2043.56, 2058.59, 2024.32, 2027.35],
    [1772496000000, 2027.34, 2041.48, 1998, 2008.88],
    [1772510400000, 2008.88, 2019.4, 1987.5, 1996.33],
    [1772524800000, 1996.32, 2000.53, 1939.1, 1961.28],
    [1772539200000, 1961.28, 1990.07, 1929.56, 1969.22],
    [1772553600000, 1969.21, 2014.12, 1958.76, 1986.02],
    [1772568000000, 1986.03, 2001.63, 1959.35, 1982.8],
    [1772582400000, 1982.81, 1998.66, 1945.08, 1960.9],
    [1772596800000, 1960.89, 2010, 1950.65, 2006.55],
].map(([openTime, open, high, low, close]) => ({
    openTime, open, high, low, close, volume: 1, closeTime: openTime + 14_400_000,
}));
const source = `//@version=6
strategy("Margin short 100 witness", initial_capital=10000, margin_long=100, margin_short=100)
if time == timestamp("UTC", 2026, 3, 2, 8, 0)
    strategy.entry("S", strategy.short, qty=5)
if time == timestamp("UTC", 2026, 3, 4, 0, 0)
    strategy.close_all()
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
`;
async function run() {
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
    return new PineTS(provider as any, 'ETHUSDT', '240').run(source);
}

describe('VIN-161 short 100% margin on real ETH bars', () => {
    it('matches the margin call, remaining position and subsequent close', async () => {
        const result = await run();
        const trades = result.strategy!.closedtrades;
        expect(result.strategy!.opentrades).toHaveLength(0);
        expect(trades).toHaveLength(2);
        expect(trades[0]).toMatchObject({ entry_time: 1772452800000,
            exit_time: 1772452800000, entry_price: 1947.8, exit_price: 2065.48, exit_id: 'Margin call' });
        expect(trades[0].size).toBeCloseTo(-1.7732, 8);
        expect(trades[1]).toMatchObject({ entry_time: 1772452800000,
            exit_time: 1772596800000, entry_price: 1947.8, exit_price: 1960.89 });
        expect(trades[1].size).toBeCloseTo(-3.2268, 8);
        expect(trades[0].profit).toBeCloseTo((1947.8 - 2065.48) * 1.7732, 8);
        expect(trades[1].profit).toBeCloseTo((1947.8 - 1960.89) * 3.2268, 8);
    });

    it('reports the finite short liquidation price after the partial call', async () => {
        const result = await run();
        const point = result.plots['Liquidation price'].data.find(p => p.time === 1772452800000)!;
        expect(point.value).toBeCloseTo(2491.09, 8);
        const equity = result.plots['Equity'].data.find(p => p.time === 1772452800000)!;
        expect(equity.value).toBeCloseTo(10000 + (1947.8 - 2065.48) * 1.7732 + (1947.8 - 2047.33) * 3.2268, 8);
    });
});
