import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// VIN-160: original time-only probe reproduces the real ETH 1502 residual.
// TradingView CSV ETH_odd_fraction_witness_BINANCE_ETHUSDT_2026-09-07.csv:
// 23.4227 / 2 floors to 11.7113, and FIFO dust changes later average prices.
const candles = [
    [1637740800000, 4269.37, 4342.27, 4254, 4292.28, 68774.0779],
    [1637755200000, 4292.28, 4310.58, 4167.65, 4252.35, 113517.632],
    [1637769600000, 4252.35, 4267.12, 4198.84, 4211.88, 65344.9516],
    [1637784000000, 4212, 4282.19, 4200.09, 4269.36, 46252.4335],
    [1637798400000, 4270.1, 4336, 4248.27, 4317.2, 74096.8227],
    [1637812800000, 4317.21, 4323.97, 4263.34, 4295.39, 49142.1093],
    [1637827200000, 4295.4, 4391.98, 4270.65, 4386.96, 83307.6684],
    [1637841600000, 4387.37, 4500, 4382.39, 4475.65, 111758.3891],
    [1637856000000, 4475.65, 4530, 4459.79, 4502.04, 81404.1475],
    [1637870400000, 4502.05, 4550, 4468.35, 4524.85, 46159.1064],
    [1637884800000, 4524.48, 4551, 4425.27, 4426.63, 75548.7353],
    [1637899200000, 4426.62, 4447.87, 4313, 4343.45, 80850.0744],
    [1637913600000, 4343.45, 4343.45, 3980, 3985.44, 310703.4157],
    [1637928000000, 3984.92, 4126.69, 3913, 4063.94, 139072.2232],
    [1637942400000, 4063.95, 4114.53, 4023, 4082.94, 61768.0587],
    [1637956800000, 4082.94, 4127.78, 4027.08, 4041.2, 52302.6539],
].map(([openTime, open, high, low, close, volume]) => ({
    openTime, open, high, low, close, volume, closeTime: openTime + 14_400_000,
}));
const source = `//@version=5
strategy("ETH odd fraction witness", overlay=true, calc_on_order_fills=true, pyramiding=10, initial_capital=100000, margin_long=0, margin_short=0)
if time == timestamp("UTC", 2021, 11, 24, 8, 0)
    strategy.entry("seed", strategy.long, qty=1)
if time == timestamp("UTC", 2021, 11, 24, 16, 0)
    strategy.close_all()
if time == timestamp("UTC", 2021, 11, 24, 20, 0)
    strategy.entry("buy", strategy.long, qty=23.4227)
strategy.exit("Tg1", "buy", limit=strategy.position_avg_price * 1.05, qty_percent=50)
strategy.exit("Tg2", "buy", limit=strategy.position_avg_price * 1.10, qty_percent=100)
if time == timestamp("UTC", 2021, 11, 26, 12, 0)
    strategy.close_all()
`;
const expected = [
    [1637755200000, 1637784000000, 4292.28, 4212.0, 1.0],
    [1637784000000, 1637841600000, 4212.0, 4453.15, 11.7113],
    [1637784000000, 1637841600000, 4212.0, 4453.15, 11.7113],
    [1637784000000, 1637841600000, 4212.0, 4453.15, 0.0001],
    [1637784000000, 1637841600000, 4200.09, 4453.15, 11.7112],
    [1637784000000, 1637841600000, 4200.09, 4453.15, 11.7113],
    [1637784000000, 1637942400000, 4200.09, 4063.95, 0.0002],
    [1637784000000, 1637942400000, 4282.19, 4063.95, 23.4227],
    [1637798400000, 1637942400000, 4270.1, 4063.95, 23.4227],
];

describe('VIN-160 COF percent exits respect the instrument quantity step', () => {
    it('preserves the two dust rows and the later full lots on real ETH bars', async () => {
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

// VIN-160: real 2017 ETH entry, quantity 331.9832. Multiplying by 50
// before dividing by 100 introduces an extra ULP and loses a quantity step.
it('does not floor a valid half one extra step through percentage arithmetic', async () => {
    const data = [
        [1507276800000, 299.81, 302.9, 298.58, 301.22],
        [1507291200000, 301.89, 303.89, 298.24, 301.67],
        [1507392000000, 310.01, 311.68, 307.86, 308.02],
        [1507406400000, 308.02, 318.5, 306.34, 311.01],
        [1507579200000, 290.14, 300, 288.8, 297.19],
        [1507593600000, 297.35, 299.12, 293.55, 298.55],
    ].map(([openTime, open, high, low, close]) => ({
        openTime, open, high, low, close, volume: 1, closeTime: openTime + 14_400_000,
    }));
    const provider = {
        configure() {},
        getQtyStep() { return 0.00009999999999999999; },
        async getMarketData() { return data; },
        async getSymbolInfo() {
            return { ticker: 'ETHUSDT', tickerid: 'BINANCE:ETHUSDT', mintick: 0.01,
                mincontract: 0.0001, pointvalue: 1, type: 'crypto', currency: 'USDT',
                timezone: 'Etc/UTC', session: '24x7' };
        },
    };
    const result = await new PineTS(provider as any, 'ETHUSDT', '240').run(`//@version=5
strategy("ETH exact half", calc_on_order_fills=true, initial_capital=100000, margin_long=0, margin_short=0)
if bar_index == 0
    strategy.entry("buy", strategy.long, qty=331.9832)
strategy.exit("Tg1", "buy", limit=strategy.position_avg_price * 1.05, qty_percent=50)
if bar_index == 4
    strategy.close_all()`);
    expect(result.strategy!.opentrades).toHaveLength(0);
    const trades = result.strategy!.closedtrades;
    expect(trades).toHaveLength(2);
    expect(trades.map(t => t.exit_time)).toEqual([1507406400000, 1507593600000]);
    for (const trade of trades) expect(trade.size).toBeCloseTo(165.9916, 8);
    expect(trades[0].entry_price).toBeCloseTo(301.89, 8);
    expect(trades[0].exit_price).toBeCloseTo(316.99, 8);
    expect(trades[1].exit_price).toBeCloseTo(297.35, 8);
});
