import { expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// VIN-168: native BCHUSDT 240 cash, percent and realized-loss captures,
// 2026-09-07. A realized loss halts NEW requests, but pending-150 survives.
// No liquidation occurs. OHLC and expected plots cover the same 17 bars.
const bars = [[1584230400000, 167.08, 170.0, 165.44, 166.88], [1584244800000, 166.96, 172.3, 166.96, 169.21], [1584259200000, 169.22, 179.0, 167.75, 174.86], [1584273600000, 174.85, 179.81, 170.07, 172.71], [1584288000000, 172.71, 176.56, 171.28, 174.93], [1584302400000, 174.95, 190.69, 170.94, 178.2], [1584316800000, 178.2, 184.41, 174.4, 179.61], [1584331200000, 179.63, 179.95, 158.0, 159.31], [1584345600000, 159.16, 164.84, 147.14, 150.85], [1584360000000, 150.85, 174.0, 150.04, 172.56], [1584374400000, 172.52, 176.0, 165.37, 168.46], [1584388800000, 168.39, 172.77, 162.67, 172.41], [1584403200000, 172.45, 184.64, 168.73, 180.1], [1584417600000, 179.97, 186.78, 176.31, 182.17], [1584432000000, 182.17, 187.59, 177.13, 180.81], [1584446400000, 180.88, 184.37, 172.67, 183.31], [1584460800000, 183.53, 186.9, 181.97, 184.54]];
const cashSource = `//@version=5
strategy("VIN168 drawdown cash witness", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=false, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)
strategy.risk.max_drawdown(15, strategy.cash)
if time == timestamp("UTC", 2020, 3, 15, 20, 0)
    strategy.entry("first", strategy.long, qty=1)
    strategy.entry("pending-150", strategy.long, qty=1, limit=150)
if time == timestamp("UTC", 2020, 3, 16, 12, 0)
    strategy.entry("same-day-attempt", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 0, 0)
    strategy.entry("next-day-attempt", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")`;
const cases = [
 {name: 'cash', source: cashSource, plots: {
  "Position": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0, 3.0, 4.0, 0.0, 0.0, 0.0],
  "Equity": [1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1001.4, 981.1, 973.4, 1017.0, 1004.8, 1016.5, 1039.6000000000001, 1048.1, 1048.1000000000001, 1048.1000000000001, 1048.1000000000001],
  "Net profit": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 48.10000000000005, 48.10000000000005, 48.10000000000005],
 }},
 {name: 'percent', source: cashSource.replace('drawdown cash witness', 'drawdown percent witness').replace('max_drawdown(15, strategy.cash)', 'max_drawdown(1.5, strategy.percent_of_equity)'), plots: {
  "Position": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0, 3.0, 4.0, 0.0, 0.0, 0.0],
  "Equity": [1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1001.4, 981.1, 973.4, 1017.0, 1004.8, 1016.5, 1039.6000000000001, 1048.1, 1048.1000000000001, 1048.1000000000001, 1048.1000000000001],
  "Net profit": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 48.10000000000005, 48.10000000000005, 48.10000000000005],
 }},
 {name: 'realized-loss', source: cashSource.replace('drawdown cash witness', 'drawdown realized loss witness').replace('if time == timestamp("UTC", 2020, 3, 16, 12, 0)', 'if time == timestamp("UTC", 2020, 3, 16, 4, 0)\n    strategy.close_all("realize-loss")\nif time == timestamp("UTC", 2020, 3, 16, 12, 0)'), plots: {
  "Position": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  "Equity": [1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1001.4, 981.1, 981.8, 1003.6, 999.5, 1003.4, 1011.1, 1013.2, 1011.8, 1014.3, 1015.5],
  "Net profit": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -19.0, -19.0, -19.0, -19.0, -19.0, -19.0, -19.0, -19.0, -19.0],
 }},
];
function provider() {
 return { configure() {}, getQtyStep() { return .0001; },
  async getMarketData() { return bars.map(([time,open,high,low,close])=>({openTime:time,closeTime:time+14_400_000-1,open,high,low,close,volume:1})); },
  async getSymbolInfo() { return {prefix:'BINANCE',ticker:'BCHUSDT',tickerid:'BINANCE:BCHUSDT',type:'crypto',currency:'USDT',basecurrency:'BCH',mintick:.1,pointvalue:1,mincontract:.0001,session:'24x7',timezone:'Etc/UTC'}; },
 };
}
// Public source 1592 uses named value/type arguments; exercise that same syntax.
const namedCase = cases.find(c => c.name === 'realized-loss')!;
cases.push({...namedCase, source: namedCase.source.replace(
 'strategy.risk.max_drawdown(15, strategy.cash)',
 'float condmaxdrawdown = 15\nstrategy.risk.max_drawdown(value=condmaxdrawdown, type=strategy.cash)',
)});
for (const [index, c] of cases.entries()) it(`VIN-168 matches native ${c.name} case ${index} trades and plotted equity`, async () => {
 const r = await new PineTS(provider() as any, 'BCHUSDT', '240').run(c.source);
 const s = r.strategy!;
 if (c.name === 'realized-loss') {
  expect(s.closedtrades.map(t=>[t.entry_time,t.entry_price,t.exit_time,t.exit_price,t.size,t.profit,t.commission,t.exit_comment])).toEqual([
   [1584316800000,178.2,1584345600000,159.2,1,-19,0,'realize-loss'],
  ]);
  expect(s.opentrades.map(t=>[t.entry_id,t.entry_time,t.entry_price,t.size,t.commission])).toEqual([
   ['pending-150',1584345600000,150,1,0],
  ]);
 } else {
  expect(s.closedtrades.map(t=>[t.entry_id,t.entry_time,t.entry_price,t.exit_time,t.exit_price,t.size,t.commission,t.exit_comment])).toEqual([
   ['first',1584316800000,178.2,1584432000000,182.2,1,0,'final'],
   ['pending-150',1584345600000,150,1584432000000,182.2,1,0,'final'],
   ['same-day-attempt',1584374400000,172.5,1584432000000,182.2,1,0,'final'],
   ['next-day-attempt',1584417600000,180,1584432000000,182.2,1,0,'final'],
  ]);
  expect(s.opentrades).toHaveLength(0);
  expect(s.netprofit).toBeCloseTo(48.1, 10);
 }
 for (const [channel,expected] of Object.entries(c.plots)) {
  const actual = r.plots[channel].data.map(p=>p.value);
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v,i)=>expect(actual[i]).toBeCloseTo(v,10));
 }
});
