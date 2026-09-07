import { expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// Native BCHUSDT 240 captures, 2026-09-07: VIN-166 POC history and
// close reaction. COF and POC were both confirmed in the effective TV settings.
// Sources, CSV registers and charts: oracle-archives/vin164-20260907/vin166-followup.
const candles = `1584230400,167.08,170,165.44,166.88
1584244800,166.96,172.3,166.96,169.21
1584259200,169.22,179,167.75,174.86
1584273600,174.85,179.81,170.07,172.71
1584288000,172.71,176.56,171.28,174.93
1584302400,174.95,190.69,170.94,178.2
1584316800,178.2,184.41,174.4,179.61
1584331200,179.63,179.95,158,159.31
1584345600,159.16,164.84,147.14,150.85
1584360000,150.85,174,150.04,172.56
1584374400,172.52,176,165.37,168.46
1584388800,168.39,172.77,162.67,172.41
1584403200,172.45,184.64,168.73,180.1
1584417600,179.97,186.78,176.31,182.17
1584432000,182.17,187.59,177.13,180.81
1584446400,180.88,184.37,172.67,183.31
1584460800,183.53,186.9,181.97,184.54`.split('\n').map(row => {
    const [time, open, high, low, close] = row.split(',').map(Number);
    return { openTime: time * 1000, closeTime: time * 1000 + 14_400_000 - 1, open, high, low, close, volume: 1 };
});
function provider(feed = candles) {
    return { feed, configure() {}, getQtyStep() { return .0001; },
        async getMarketData() { return this.feed; },
        async getSymbolInfo() { return { prefix: 'BINANCE', ticker: 'BCHUSDT', tickerid: 'BINANCE:BCHUSDT',
            type: 'crypto', currency: 'USDT', basecurrency: 'BCH', mintick: .1, pointvalue: 1,
            mincontract: .0001, session: '24x7', timezone: 'Etc/UTC' }; },
    };
}
const historySource = `//@version=5
strategy("VIN166 POC history native window", overlay=true, initial_capital=10000, calc_on_order_fills=true, process_orders_on_close=true, pyramiding=100, default_qty_type=strategy.fixed, default_qty_value=1, margin_long=0, margin_short=0)
if time >= timestamp("UTC", 2020, 3, 15, 20, 0) and time <= timestamp("UTC", 2020, 3, 16, 12, 0)
    strategy.entry("L" + str.tostring(bar_index), strategy.long)
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.position_size[1], "Previous position")`;
const reactionSource = `//@version=5
strategy("VIN166 POC close fill reaction", overlay=true, initial_capital=10000, calc_on_order_fills=true, process_orders_on_close=true, pyramiding=10, default_qty_type=strategy.fixed, default_qty_value=1, margin_long=0, margin_short=0)
varip bool saw_after_fill = false
if time == timestamp("UTC", 2020, 3, 15, 20, 0)
    if strategy.position_size == 0
        strategy.entry("L", strategy.long)
    if strategy.position_size > 0
        saw_after_fill := true
        strategy.close_all("cof-reaction")
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.position_size[1], "Previous position")
plot(saw_after_fill ? 1 : 0, "Saw post-fill")`;
it('matches five native close entries and the pre-fill history, in batch and snapshot updateTail', async () => {
    const batch = await new PineTS(provider() as any, 'BCHUSDT', '240').run(historySource);
    expect(batch.strategy!.closedtrades.map(t => [t.entry_time, t.entry_price, t.exit_time, t.exit_price, t.size])).toEqual(
        [178.2, 179.6, 159.3, 150.8, 172.6].map((price, i) => [1584302400000 + i * 14_400_000, price, 1584417600000, 182.2, 1]),
    );
    expect(batch.strategy!.opentrades).toHaveLength(0);
    expect(batch.plots.Position.data.slice(5, 11).map(p => p.value)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(batch.plots['Previous position'].data.slice(5, 11).map(p => p.value)).toEqual([0, 0, 1, 2, 3, 4]);
    const feed = provider(candles.slice(0, 8));
    const engine = new PineTS(feed as any, 'BCHUSDT', '240');
    const tail = await engine.run(historySource);
    feed.feed = candles;
    await engine.updateTail(tail);
    expect(tail.strategy!.closedtrades).toEqual(batch.strategy!.closedtrades);
    expect(tail.strategy!._series_history).toEqual(batch.strategy!._series_history);
    expect(tail.plots.Position.data).toEqual(batch.plots.Position.data);
    expect(tail.plots['Previous position'].data).toEqual(batch.plots['Previous position'].data);
});
it('does not execute the close-fill reaction even when COF is enabled', async () => {
    const result = await new PineTS(provider() as any, 'BCHUSDT', '240').run(reactionSource);
    expect(result.plots['Saw post-fill'].data.map(p => p.value)).toEqual(candles.map(() => 0));
    expect(result.strategy!.closedtrades.map(t => [t.entry_time, t.entry_price, t.exit_time, t.exit_price, t.size, t.exit_comment])).toEqual([
        [1584302400000, 178.2, 1584417600000, 182.2, 1, 'final'],
    ]);
    expect(result.strategy!.opentrades).toHaveLength(0);
});
