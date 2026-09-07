import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// VIN-160, real ETH script 1502. TradingView probes 2 and 4, 2026-09-07:
// oracle-archives/vin160-20260907/{probe2,probe4}-tv.csv in the parent lab.
// These seven real Binance bars suffice for the time-only witness. TradingView
// also logged the target bar OHLC exactly: 3890.06/4084.91/3852.06/4081.66.
// The two exits at 4084.57 must precede recalculation after the low entry.
const candles = [
    [1760947200000, 4055.03, 4070.92, 4012.21, 4035.02, 73033.7035],
    [1760961600000, 4035.03, 4049.51, 4002.07, 4003.98, 117292.0188],
    [1761033600000, 3892.95, 3897.77, 3851, 3890.07, 46017.1815],
    [1761048000000, 3890.06, 4084.91, 3852.06, 4081.66, 176194.3139],
    [1761062400000, 4081.66, 4110, 3965.47, 3995.69, 143288.4239],
    [1761105600000, 3859.58, 3884.34, 3838.31, 3868.72, 51818.2304],
    [1761120000000, 3868.72, 3868.91, 3770.02, 3829, 84899.402],
].map(([openTime, open, high, low, close, volume]) => ({
    openTime, open, high, low, close, volume, closeTime: openTime + 14_400_000 - 1,
}));

function source(percent: number) {
    return `//@version=5
strategy("ETH COF exits witness 2", overlay=true, calc_on_order_fills=true, pyramiding=10, initial_capital=100000, margin_long=0, margin_short=0)
if time == timestamp("UTC", 2025, 10, 20, 8, 0)
    strategy.entry("seed", strategy.long, qty=1)
if time == timestamp("UTC", 2025, 10, 21, 8, 0)
    strategy.close_all()
if time == timestamp("UTC", 2025, 10, 21, 12, 0)
    strategy.entry("buy", strategy.long, qty=24.4998)
strategy.exit("Tg1", "buy", limit=strategy.position_avg_price * 1.05, qty_percent=${percent})
${percent === 50 ? 'strategy.exit("Tg2", "buy", limit=strategy.position_avg_price * 1.10, qty_percent=100)' : ''}
if time >= timestamp("UTC", 2025, 10, 22, 4, 0)
    strategy.close_all()`;
}

const targetTime = 1761048000000;
const finalTime = 1761120000000;
const seed = [1760961600000, targetTime, 4035.03, 3890.06, 1];

async function verify(percent: number, expected: number[][]) {
    const provider = {
        configure() {},
        async getMarketData() { return candles; },
        async getSymbolInfo() {
            return {
                ticker: 'ETHUSDT', tickerid: 'BINANCE:ETHUSDT', main_tickerid: 'BINANCE:ETHUSDT',
                prefix: 'BINANCE', root: 'ETH', description: 'ETH / USDT', type: 'crypto',
                basecurrency: 'ETH', currency: 'USDT', timezone: 'Etc/UTC', session: '24x7',
                mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1, mincontract: 0.0001,
            };
        },
    };
    const result = await new PineTS(provider as any, 'ETHUSDT', '240').run(source(percent));
    const trades = result.strategy!.closedtrades;
    expect(result.strategy!.opentrades).toHaveLength(0);
    expect(trades).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) {
        const [entryTime, exitTime, entryPrice, exitPrice, size] = expected[i];
        const trade = trades[i];
        expect(trade.entry_time).toBe(entryTime);
        expect(trade.exit_time).toBe(exitTime);
        expect(trade.entry_price).toBeCloseTo(entryPrice, 8);
        expect(trade.exit_price).toBeCloseTo(exitPrice, 8);
        expect(Math.abs(trade.size)).toBeCloseTo(size, 8);
        expect(trade.profit).toBeCloseTo((exitPrice - entryPrice) * size, 6);
    }
}

describe('VIN-160 COF exits before recalculation after a pyramiding fill', () => {
    it('matches both 50% brackets, FIFO fractions and the surviving high entry', async () => {
        await verify(50, [seed,
            [targetTime, targetTime, 3890.06, 4084.57, 12.2499],
            [targetTime, targetTime, 3890.06, 4084.57, 12.2499],
            [targetTime, targetTime, 3852.06, 4084.91, 12.2499],
            [targetTime, finalTime, 3852.06, 3868.72, 12.2499],
            [targetTime, finalTime, 4084.91, 3868.72, 24.4998],
            [1761062400000, finalTime, 4081.66, 3868.72, 24.4998],
        ]);
    });

    it('matches one 100% bracket and defers reentry after the forward TP fill', async () => {
        await verify(100, [seed,
            [targetTime, targetTime, 3890.06, 4084.57, 24.4998],
            [targetTime, targetTime, 3852.06, 4084.57, 24.4998],
            [targetTime, finalTime, 4084.91, 3868.72, 24.4998],
            [1761062400000, finalTime, 4081.66, 3868.72, 24.4998],
        ]);
    });
});
