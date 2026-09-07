import { expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// Original TradingView LDOUSDT 4h probe, captured 2026-09-07.
// Assert the exact average representation: a one-ULP difference changes
// math.round(percent / 100 * average / tick) and moves exits by one tick.
const cases = [
    { start: 1682035200000, average: 2.1710000000000003, exits: [2.0624, 2.0624, 2.0624, 2.0624], candles: [
        [2.14, 2.188, 2.132, 2.171],
        [2.171, 2.178, 2.12, 2.175],
        [2.175, 2.189, 2.112, 2.117],
        [2.118, 2.139, 2.087, 2.119],
        [2.12, 2.132, 2.0, 2.018],
        [2.018, 2.062, 1.998, 2.045],
    ] },
    { start: 1691985600000, average: 1.8350000000000002, exits: [1.7432, 1.7432, 1.7432, 1.7432], candles: [
        [1.828, 1.837, 1.827, 1.835],
        [1.835, 1.842, 1.83, 1.832],
        [1.832, 1.855, 1.83, 1.85],
        [1.851, 1.858, 1.832, 1.84],
        [1.84, 1.848, 1.838, 1.848],
        [1.848, 1.855, 1.825, 1.83],
        [1.831, 1.831, 1.815, 1.822],
        [1.823, 1.827, 1.812, 1.812],
        [1.813, 1.823, 1.811, 1.815],
        [1.815, 1.817, 1.652, 1.705],
        [1.705, 1.734, 1.701, 1.731],
    ] },
    { start: 1752004800000, average: 0.7250000000000001, exits: [0.7468, 0.7613, 0.783, 0.7975], candles: [
        [0.727, 0.727, 0.717, 0.725],
        [0.725, 0.727, 0.709, 0.71],
        [0.709, 0.733, 0.709, 0.727],
        [0.727, 0.737, 0.724, 0.735],
        [0.735, 0.757, 0.733, 0.745],
        [0.745, 0.791, 0.742, 0.784],
        [0.785, 0.805, 0.778, 0.797],
        [0.797, 0.805, 0.786, 0.792],
    ] },
];
const source = `//@version=6
strategy("LDO average price rounding witness", initial_capital=10000, margin_long=0, margin_short=0, precision=16)
if time == 1682035200000 or time == 1691985600000 or time == 1752004800000
    strategy.entry("Long", strategy.long, qty=1)
percent(p) =>
    strategy.position_size != 0 ? math.round(p / 100 * strategy.position_avg_price / syminfo.mintick) : float(na)
strategy.exit("TP1", "Long", qty_percent=5, profit=percent(3), loss=percent(5))
strategy.exit("TP2", "Long", qty_percent=5, profit=percent(5), loss=percent(5))
strategy.exit("TP3", "Long", qty_percent=5, profit=percent(8), loss=percent(5))
strategy.exit("TP4", "Long", qty_percent=5, profit=percent(10), loss=percent(5))
if time == 1682539200000 or time == 1692878400000 or time == 1752235200000
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.position_avg_price, "Average price")
plot(5.0 / 100 * strategy.position_avg_price / syminfo.mintick, "Five percent raw")
plot(percent(5), "Five percent ticks")
plot(percent(3), "Three percent ticks")
plot(syminfo.mintick, "Tick")
`;

it.each(cases)('preserves the broker average and four partial exit prices at $start', async (test) => {
    const candles = test.candles.map(([open, high, low, close], i) => ({
        openTime: test.start + i * 14_400_000, closeTime: test.start + (i + 1) * 14_400_000 - 1,
        open, high, low, close, volume: 1,
    }));
    const provider = { configure() {}, getQtyStep() { return .01; },
        async getMarketData() { return candles; },
        async getSymbolInfo() { return { ticker: 'LDOUSDT', tickerid: 'BINANCE:LDOUSDT',
            type: 'crypto', currency: 'USDT', timezone: 'Etc/UTC', session: '24x7',
            mintick: .0001, mincontract: .01, pointvalue: 1 }; },
    };
    const result = await new PineTS(provider as any, 'LDOUSDT', '240').run(source);
    const averages = result.plots['Average price'].data.slice(1);
    for (const point of averages) expect(point.value).toBe(test.average);
    expect(result.strategy!.closedtrades).toHaveLength(test.exits.length);
    for (const [i, price] of test.exits.entries()) {
        expect(result.strategy!.closedtrades[i].exit_price).toBeCloseTo(price, 12);
    }
    for (const trade of result.strategy!.closedtrades) expect(trade.size).toBe(.05);
    expect(result.strategy!.position_size).toBeCloseTo(.8, 12);
});

it('keeps the weighted average between ticks after a FIFO partial close', async () => {
    const candles = cases[0].candles.map(([open, high, low, close], i) => ({
        openTime: cases[0].start + i * 14_400_000,
        closeTime: cases[0].start + (i + 1) * 14_400_000 - 1,
        open, high, low, close, volume: 1,
    }));
    const provider = { configure() {}, getQtyStep() { return .01; },
        async getMarketData() { return candles; },
        async getSymbolInfo() { return { ticker: 'LDOUSDT', tickerid: 'BINANCE:LDOUSDT',
            type: 'crypto', currency: 'USDT', timezone: 'Etc/UTC', session: '24x7',
            mintick: .0001, mincontract: .01, pointvalue: 1 }; },
    };
    const result = await new PineTS(provider as any, 'LDOUSDT', '240').run(`//@version=6
strategy("LDO weighted average representation witness", initial_capital=10000, pyramiding=2, margin_long=0, margin_short=0, precision=16)
if time == 1682035200000
    strategy.entry("A", strategy.long, qty=1)
if time == 1682049600000
    strategy.entry("B", strategy.long, qty=2)
if time == 1682064000000
    strategy.close("A", qty=0.5)
if time == 1682121600000
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.position_avg_price, "Average price")
plot(strategy.opentrades.entry_price(0), "First entry price")
plot(strategy.opentrades.entry_price(1), "Second entry price")
plot(5.0/100*strategy.position_avg_price/syminfo.mintick, "Five percent raw")
`);
    expect(result.plots['Average price'].data.slice(1).map(p => p.value)).toEqual([
        2.1710000000000003, 2.173666666666667,
        2.1742000000000004, 2.1742000000000004, 2.1742000000000004,
    ]);
    expect(result.strategy!.closedtrades).toHaveLength(1);
    expect(result.strategy!.closedtrades[0].size).toBe(.5);
    expect(result.strategy!.position_size).toBe(2.5);
});
