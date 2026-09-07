import { expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// VIN-161: original UNIUSDT 4h probe captured 2026-09-07. The close
// deficit .052389812 covers .00801067 units at 6.54 but only .00799844
// at the next open 6.55. TV truncates at that fill: .007 * 4 = .028.
const candles = [
    [1664812800000, 6.48, 6.55, 6.41, 6.54],
    [1664827200000, 6.55, 6.81, 6.54, 6.63],
    [1664841600000, 6.63, 6.83, 6.57, 6.64],
    [1664856000000, 6.63, 6.71, 6.57, 6.64],
].map(([openTime, open, high, low, close]) => ({
    openTime, open, high, low, close, volume: 1, closeTime: openTime + 14_400_000,
}));
it('converts the frozen covered money to contracts at the deferred execution price', async () => {
    const provider = {
        configure() {}, getQtyStep() { return .001; },
        async getMarketData() { return candles; },
        async getSymbolInfo() { return { ticker: 'UNIUSDT', tickerid: 'BINANCE:UNIUSDT',
            mintick: .001, mincontract: .001, pointvalue: 1, type: 'crypto',
            currency: 'USDT', timezone: 'Etc/UTC', session: '24x7' }; },
    };
    const r = await new PineTS(provider as any, 'UNIUSDT', '240').run(`//@version=6
strategy("UNI frozen covered money witness", initial_capital=137.820157156, margin_long=100, margin_short=100, commission_type=strategy.commission.percent, commission_value=0.04, process_orders_on_close=true)
if time == timestamp("UTC", 2022, 10, 3, 16, 0)
    strategy.entry("L", strategy.long, qty=21.073)
if time == timestamp("UTC", 2022, 10, 4, 0, 0)
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
    expect(trades[0]).toMatchObject({ entry_price: 6.54, exit_price: 6.55,
        entry_time: 1664812800000, exit_time: 1664827200000, exit_id: 'Margin call' });
    expect(trades[0].size).toBeCloseTo(.028, 9);
    expect(trades[1]).toMatchObject({ entry_price: 6.54, exit_price: 6.64, exit_time: 1664841600000 });
    expect(trades[1].size).toBeCloseTo(21.045, 9);
    expect(r.strategy!.opentrades).toHaveLength(0);
    expect(r.plots['Position'].data.find(p => p.time === 1664827200000)!.value).toBeCloseTo(21.045, 9);
    expect(r.plots['Equity'].data.find(p => p.time === 1664827200000)!.value).toBeCloseTo(139.659286828, 9);
});
