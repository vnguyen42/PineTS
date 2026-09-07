import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// VIN-161: original UNIUSDT 4h probes captured on TradingView 2026-09-07.
// Historical OHLC retains four decimals while broker valuation uses mintick .001.
const candles = [
    [1601812800000, 3.7748, 3.8, 3.6212, 3.6525],
    [1601827200000, 3.6525, 3.8015, 3.61, 3.7248],
    [1601841600000, 3.7243, 3.7632, 3.66, 3.7262],
    [1601856000000, 3.7235, 3.8, 3.7038, 3.7116],
    [1602921600000, 3.0582, 3.0828, 3.0024, 3.0292],
    [1602936000000, 3.0283, 3.0853, 3.0038, 3.0186],
    [1602950400000, 3.0192, 3.0307, 2.99, 3.018],
    [1602964800000, 3.0181, 3.0737, 3.01, 3.0566],
    [1602979200000, 3.0574, 3.0866, 3.0472, 3.0741],
    [1618444800000, 36.0631, 38.525, 35.5813, 38.3687],
    [1618459200000, 38.4035, 39.2, 37.4997, 38.1],
    [1618473600000, 38.0639, 38.287, 36.5544, 37.473],
    [1618488000000, 37.4997, 39.6, 37.4749, 38.498],
].map(([openTime, open, high, low, close]) => ({
    openTime, open, high, low, close, volume: 1, closeTime: openTime + 14_400_000,
}));
async function run(source: string) {
    const provider = {
        configure() {}, getQtyStep() { return .001; },
        async getMarketData() { return candles; },
        async getSymbolInfo() { return { ticker: 'UNIUSDT', tickerid: 'BINANCE:UNIUSDT',
            mintick: .001, mincontract: .001, pointvalue: 1, type: 'crypto',
            currency: 'USDT', timezone: 'Etc/UTC', session: '24x7' }; },
    };
    return new PineTS(provider as any, 'UNIUSDT', '240').run(source);
}
describe('VIN-161 broker valuation on historical sub-tick UNI prices', () => {
    it('uses the broker tick for both margin deficit and liquidation execution', async () => {
        const r = await run(`//@version=6
strategy("UNI POC zero fee witness", initial_capital=100, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0, process_orders_on_close=true)
riskCapital = strategy.equity * (1.0 / 100.0)
stopDistance = close * (1.0 / 100.0)
qty = riskCapital / stopDistance
if time == timestamp("UTC", 2020, 10, 17, 8, 0)
    strategy.entry("S", strategy.short, qty=qty)
if time == timestamp("UTC", 2020, 10, 17, 20, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`);
        const trades = r.strategy!.closedtrades;
        expect(trades).toHaveLength(2);
        expect(trades[0]).toMatchObject({ exit_id: 'Margin call', exit_time: 1602936000000, exit_price: 3.085 });
        expect(trades[0].size).toBeCloseTo(-4.784, 9);
        expect(trades[1].size).toBeCloseTo(-28.228, 9);
        expect(trades[1].exit_price).toBe(3.057);
        const equity = r.plots['Equity'].data.find(p => p.time === 1602936000000)!;
        expect(equity.value).toBeCloseTo(100.014376, 9);
    });
    it('marks both long and short open equity at the broker tick without margin requirements', async () => {
        const r = await run(`//@version=5
strategy("Margin default v5 witness", initial_capital=100)
if time == timestamp("UTC", 2020, 10, 4, 12, 0)
    strategy.entry("L", strategy.long, qty=100)
if time == timestamp("UTC", 2020, 10, 4, 20, 0)
    strategy.close_all()
if time == timestamp("UTC", 2020, 10, 17, 8, 0)
    strategy.entry("S", strategy.short, qty=100)
if time == timestamp("UTC", 2020, 10, 17, 20, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
`);
        expect(r.strategy!.closedtrades).toHaveLength(2);
        for (const [time, expected] of [[1601827200000, 107.2], [1601841600000, 107.3],
            [1602936000000, 108], [1602964800000, 104.2]]) {
            expect(r.plots['Equity'].data.find(p => p.time === time)!.value).toBeCloseTo(expected, 9);
        }
    });
    it('executes a fee-induced close margin deficit at the next favorable open', async () => {
        const r = await run(`//@version=6
strategy("UNI POC margin fee witness", initial_capital=100, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
qty = strategy.equity * (1.0 / 100.0) / (close * (1.0 / 100.0))
if time == timestamp("UTC", 2020, 10, 17, 8, 0)
    strategy.entry("S", strategy.short, qty=qty)
if time == timestamp("UTC", 2020, 10, 17, 20, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`);
        const trades = r.strategy!.closedtrades;
        expect(trades).toHaveLength(3);
        for (const [i, size, price] of [[0, -.044, 3.028], [1, -4.656, 3.085], [2, -28.312, 3.057]]) {
            expect(trades[i].size).toBeCloseTo(size, 9);
            expect(trades[i].exit_price).toBe(price);
        }
        expect(trades[0].exit_time).toBe(1602936000000);
        for (const [name, value] of [['Position', -28.312], ['Equity', 99.976631864],
            ['Liquidation price', 3.276], ['Net profit', -.306488136],
            ['Open profit', .28312], ['Average price', 3.029]] as const) {
            expect(r.plots[name].data.find(p => p.time === 1602936000000)!.value).toBeCloseTo(value, 9);
        }
    });

    it('recalculates after the deferred open liquidation before reaching the high', async () => {
        const r = await run(`//@version=6
strategy("UNI margin COF reaction witness", initial_capital=100, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true, calc_on_order_fills=true)
qty = strategy.equity * (1.0 / 100.0) / (close * (1.0 / 100.0))
if time == timestamp("UTC", 2020, 10, 17, 8, 0)
    strategy.entry("S", strategy.short, qty=qty)
if strategy.closedtrades > 0 and strategy.position_size != 0
    strategy.close_all(immediately=true)
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`);
        const trades = r.strategy!.closedtrades;
        expect(trades).toHaveLength(2);
        expect(trades[0].size).toBeCloseTo(-.044, 9);
        expect(trades[1].size).toBeCloseTo(-32.968, 9);
        for (const trade of trades) {
            expect(trade.exit_time).toBe(1602936000000);
            expect(trade.exit_price).toBe(3.028);
        }
    });

    it('keeps an extreme margin liquidation distinct from a deferred open COF fill', async () => {
        const r = await run(`//@version=6
strategy("UNI margin COF zero reaction witness", initial_capital=100, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0, process_orders_on_close=true, calc_on_order_fills=true)
qty = strategy.equity * (1.0 / 100.0) / (close * (1.0 / 100.0))
if time == timestamp("UTC", 2020, 10, 17, 8, 0)
    strategy.entry("S", strategy.short, qty=qty)
if strategy.closedtrades > 0 and strategy.position_size != 0
    strategy.close_all(immediately=true)
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`);
        const trades = r.strategy!.closedtrades;
        expect(trades).toHaveLength(2);
        expect(trades[0].size).toBeCloseTo(-4.784, 9);
        expect(trades[0].exit_price).toBe(3.085);
        expect(trades[1].size).toBeCloseTo(-28.228, 9);
        expect(trades[1].exit_price).toBe(3.019);
        expect(trades[1].exit_time).toBe(1602936000000);
        // TV plots the normal close execution before its immediate exit.
        // A second COF execution at the final tick would expose a flat book.
        for (const [name, value] of [['Position', -28.228], ['Equity', 100.014376],
            ['Liquidation price', 3.282], ['Net profit', -.267904],
            ['Open profit', .28228], ['Average price', 3.029]] as const) {
            expect(r.plots[name].data.find(p => p.time === 1602936000000)!.value).toBeCloseTo(value, 9);
        }
    });

    it.each([1, 7])('liquidates one unit for a sub-contract cover independently of default qty %s', async (defaultQty) => {
        const r = await run(`//@version=6
strategy("UNI sub-contract cover witness", initial_capital=152.937059612, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 4, 15, 0, 0)
    strategy.entry("L", strategy.long, qty=3.985)
if time == timestamp("UTC", 2021, 4, 15, 8, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`.replace('initial_capital=', `default_qty_value=${defaultQty}, initial_capital=`));
        const trades = r.strategy!.closedtrades;
        expect(trades).toHaveLength(2);
        expect(trades[0]).toMatchObject({ exit_id: 'Margin call', exit_time: 1618459200000,
            exit_price: 38.404, size: 1 });
        expect(trades[1].size).toBeCloseTo(2.985, 9);
        expect(trades[1].exit_price).toBe(37.473);
    });

});
