import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// VIN-161: original UNIUSDT 4h TradingView gap probes captured 2026-09-07.
const candles = [
    [1614470400000, 23.5538, 24.127, 21.3282, 21.444],
    [1614484800000, 21.4598, 21.9283, 20.5523, 21.3525],
    [1614499200000, 21.3501, 22.35, 21.3482, 22.0094],
    [1614513600000, 22.0276, 22.0683, 20.5, 20.6975],
    [1621584000000, 25.756, 26.519, 25.117, 25.788],
    [1621598400000, 25.766, 26.198, 21.21, 21.422],
    [1621612800000, 21.442, 22.66, 20.623, 21.104],
    [1621627200000, 21.096, 22.268, 18.819, 21.945],
    [1621641600000, 21.943, 22.624, 20.265, 20.616],
].map(([openTime, open, high, low, close]) => ({
    openTime, open, high, low, close, volume: 1, closeTime: openTime + 14_400_000,
}));
const provider = {
    configure() {}, getQtyStep() { return .001; },
    async getMarketData() { return candles; },
    async getSymbolInfo() { return { ticker: 'UNIUSDT', tickerid: 'BINANCE:UNIUSDT',
        mintick: .001, mincontract: .001, pointvalue: 1, type: 'crypto',
        currency: 'USDT', timezone: 'Etc/UTC', session: '24x7' }; },
};
const cases = [
    { name: "adverse-may", entryTime: 1621598400000, entryPrice: 21.422, source: `//@version=6
strategy("UNI adverse-may witness", initial_capital=166.1695295482, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 5, 21, 12, 0)
    strategy.entry("S", strategy.short, qty=7.756)
if time == timestamp("UTC", 2021, 5, 21, 20, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.064, 21.442, 1621612800000, 1], [3.128, 22.66, 1621612800000, 1], [4.564, 21.945, 1621627200000, 0]] },
    { name: "adverse-feb", entryTime: 1614470400000, entryPrice: 21.444, source: `//@version=6
strategy("UNI adverse-feb witness", initial_capital=153.4400650572, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 2, 28, 0, 0)
    strategy.entry("S", strategy.short, qty=7.155)
if time == timestamp("UTC", 2021, 2, 28, 8, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.008, 21.46, 1614484800000, 1], [0.02, 21.46, 1614484800000, 1], [1.156, 21.928, 1614484800000, 1], [5.971, 22.009, 1614499200000, 0]] },
    { name: "adverse-may-capital", entryTime: 1621598400000, entryPrice: 21.422, source: `//@version=6
strategy("UNI adverse-may capital witness", initial_capital=166.15, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 5, 21, 12, 0)
    strategy.entry("S", strategy.short, qty=7.756)
if time == timestamp("UTC", 2021, 5, 21, 20, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.012, 21.442, 1621612800000, 1], [0.02, 21.442, 1621612800000, 1], [3.264, 22.66, 1621612800000, 1], [4.46, 21.945, 1621627200000, 0]] },
    { name: "adverse-may-same-cash", entryTime: 1621598400000, entryPrice: 21.422, source: `//@version=6
strategy("UNI adverse-may same cash doubled fee witness", initial_capital=166.235989161, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.08, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 5, 21, 12, 0)
    strategy.entry("S", strategy.short, qty=7.756)
if time == timestamp("UTC", 2021, 5, 21, 20, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.064, 21.442, 1621612800000, 1], [3.128, 22.66, 1621612800000, 1], [4.564, 21.945, 1621627200000, 0]] },
    { name: "adverse-may-tenfold", entryTime: 1621598400000, entryPrice: 21.422, source: `//@version=6
strategy("UNI adverse-may tenfold witness", initial_capital=1661.695295482, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 5, 21, 12, 0)
    strategy.entry("S", strategy.short, qty=77.56)
if time == timestamp("UTC", 2021, 5, 21, 20, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.664, 21.442, 1621612800000, 1], [31.18, 22.66, 1621612800000, 1], [45.716, 21.945, 1621627200000, 0]] },
    { name: "adverse-may-same-step", entryTime: 1621598400000, entryPrice: 21.422, source: `//@version=6
strategy("UNI adverse-may same step witness", initial_capital=166.152, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 5, 21, 12, 0)
    strategy.entry("S", strategy.short, qty=7.756)
if time == timestamp("UTC", 2021, 5, 21, 20, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.068, 21.442, 1621612800000, 1], [3.112, 22.66, 1621612800000, 1], [4.576, 21.945, 1621627200000, 0]] },
    { name: "adverse-may-reaction", entryTime: 1621598400000, entryPrice: 21.422, source: `//@version=6
strategy("UNI adverse-may margin reaction witness", initial_capital=166.1695295482, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true, calc_on_order_fills=true)
if time == timestamp("UTC", 2021, 5, 21, 12, 0)
    strategy.entry("S", strategy.short, qty=7.756)
if strategy.closedtrades > 0 and strategy.position_size != 0
    strategy.close_all(immediately=true)
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.064, 21.442, 1621612800000, 1], [7.692, 20.623, 1621612800000, 0]] },
    { name: "feb-raw-boundary", entryTime: 1614470400000, entryPrice: 21.444, source: `//@version=6
strategy("UNI adverse-feb raw-boundary witness", initial_capital=153.4355, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 2, 28, 0, 0)
    strategy.entry("S", strategy.short, qty=7.155)
if time == timestamp("UTC", 2021, 2, 28, 8, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.052, 21.46, 1614484800000, 1], [1.06, 21.928, 1614484800000, 1], [6.043, 22.009, 1614499200000, 0]] },
    { name: "feb-fee-boundary", entryTime: 1614470400000, entryPrice: 21.444, source: `//@version=6
strategy("UNI adverse-feb fee-boundary witness", initial_capital=153.436155064, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 2, 28, 0, 0)
    strategy.entry("S", strategy.short, qty=7.155)
if time == timestamp("UTC", 2021, 2, 28, 8, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.008, 21.46, 1614484800000, 1], [0.02, 21.46, 1614484800000, 1], [1.156, 21.928, 1614484800000, 1], [5.971, 22.009, 1614499200000, 0]] },
    { name: "long50-gap", entryTime: 1621584000000, entryPrice: 25.788, source: `//@version=6
strategy("UNI long50-gap witness", initial_capital=77.3858912, margin_long=50, margin_short=50, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 5, 21, 8, 0)
    strategy.entry("L", strategy.long, qty=6)
if time == timestamp("UTC", 2021, 5, 21, 16, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.012, 25.766, 1621598400000, 1], [5.124, 21.21, 1621598400000, 1], [0.864, 21.104, 1621612800000, 0]] },
    { name: "long50-gap-lower", entryTime: 1621584000000, entryPrice: 25.788, source: `//@version=6
strategy("UNI long50-gap-lower witness", initial_capital=77.3658912, margin_long=50, margin_short=50, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 5, 21, 8, 0)
    strategy.entry("L", strategy.long, qty=6)
if time == timestamp("UTC", 2021, 5, 21, 16, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.016, 25.766, 1621598400000, 1], [5.108, 21.21, 1621598400000, 1], [0.876, 21.104, 1621612800000, 0]] },
    { name: "short50-gap", entryTime: 1621598400000, entryPrice: 21.422, source: `//@version=6
strategy("UNI adverse-may short half margin witness", initial_capital=83.0950135482, margin_long=50, margin_short=50, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 5, 21, 12, 0)
    strategy.entry("S", strategy.short, qty=7.756)
if time == timestamp("UTC", 2021, 5, 21, 20, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.016, 21.442, 1621612800000, 1], [0.04, 21.442, 1621612800000, 1], [4.852, 22.66, 1621612800000, 1], [2.848, 21.945, 1621627200000, 0]] },
    { name: "short-margin-9999", entryTime: 1621598400000, entryPrice: 21.422, source: `//@version=6
strategy("UNI adverse-may margin 9999 witness", initial_capital=166.1529146450, margin_long=99.99, margin_short=99.99, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 5, 21, 12, 0)
    strategy.entry("S", strategy.short, qty=7.756)
if time == timestamp("UTC", 2021, 5, 21, 20, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.064, 21.442, 1621612800000, 1], [3.128, 22.66, 1621612800000, 1], [4.564, 21.945, 1621627200000, 0]] },
    { name: "short-margin-999", entryTime: 1621598400000, entryPrice: 21.422, source: `//@version=6
strategy("UNI adverse-may margin 999 witness", initial_capital=166.0033805162, margin_long=99.9, margin_short=99.9, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 5, 21, 12, 0)
    strategy.entry("S", strategy.short, qty=7.756)
if time == timestamp("UTC", 2021, 5, 21, 20, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.064, 21.442, 1621612800000, 1], [3.128, 22.66, 1621612800000, 1], [4.564, 21.945, 1621627200000, 0]] },
    { name: "short50-refusal", entryTime: 1621598400000, entryPrice: 21.422, source: `//@version=6
strategy("UNI adverse-may short half margin refusal witness", initial_capital=83.1289756128, margin_long=50, margin_short=50, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2021, 5, 21, 12, 0)
    strategy.entry("S", strategy.short, qty=7.756)
if time == timestamp("UTC", 2021, 5, 21, 20, 0)
    strategy.close_all()
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.margin_liquidation_price, "Liquidation price")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(strategy.position_avg_price, "Average price")
`, expected: [[0.088, 21.442, 1621612800000, 1], [4.696, 22.66, 1621612800000, 1], [2.972, 21.945, 1621627200000, 0]] },
 ];
describe('VIN-161 deferred margin order admission', () => {
    it.each(cases)('$name matches the real TV liquidation sequence', async ({ source, expected, entryTime, entryPrice }) => {
        const r = await new PineTS(provider as any, 'UNIUSDT', '240').run(source);
        expect(r.strategy!.opentrades).toHaveLength(0);
        const trades = r.strategy!.closedtrades;
        expect(trades).toHaveLength(expected.length);
        for (let i = 0; i < expected.length; i++) {
            expect(Math.abs(trades[i].size)).toBeCloseTo(expected[i][0], 9);
            expect(trades[i].exit_price).toBe(expected[i][1]);
            expect(trades[i].exit_time).toBe(expected[i][2]);
            expect(trades[i].exit_id === 'Margin call').toBe(expected[i][3] === 1);
            expect(trades[i].entry_time).toBe(entryTime);
            expect(trades[i].entry_price).toBe(entryPrice);
        }
    });
});
