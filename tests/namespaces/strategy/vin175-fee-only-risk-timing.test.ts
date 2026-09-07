import {expect,it} from 'vitest';
import {PineTS} from '../../../src/PineTS.class';
// Real signal/fill and New York day-boundary bars only. Complete captures/replays
// are retained in oracle-archives/vin175-20260908; no synthetic OHLC.
const cases = [
  { name: "extended-day-boundary", crypto: false,
    source: `//@version=5
strategy("VIN175 AAPL extended day boundaries", overlay=true, initial_capital=100000, pyramiding=1, calc_on_order_fills=false, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.cash_per_order, commission_value=30, margin_long=0, margin_short=0)
// NASDAQ:AAPL, 15 minutes, EXTENDED hours. Dates use New York winter time.
strategy.risk.max_intraday_loss(1, strategy.cash)
if time == timestamp("America/New_York", 2026, 2, 23, 18, 0)
    strategy.entry("before-UTC-midnight", strategy.long, qty=1)
if time == timestamp("America/New_York", 2026, 2, 23, 19, 0)
    strategy.entry("after-UTC-midnight", strategy.long, qty=1)
if time == timestamp("America/New_York", 2026, 2, 24, 4, 0)
    strategy.entry("next-premarket", strategy.long, qty=1)
if time == timestamp("America/New_York", 2026, 2, 24, 9, 30)
    strategy.entry("regular-open", strategy.long, qty=1)

plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")
`,
    bars: [
      [1771886700000, 266.87, 266.87, 266.86, 266.87],
      [1771887600000, 266.87, 267.5, 266.78, 267.4],
      [1771888500000, 267.3, 267.3, 266.78, 267.25],
      [1771889400000, 267.2, 267.38, 267.13, 267.37],
      [1771891200000, 266.96, 267.24, 266.96, 267.24],
      [1771892100000, 267.25, 267.51, 266.86, 266.86],
      [1771923600000, 267.3, 267.3, 266.54, 266.98],
      [1771924500000, 267.01, 267.01, 266.77, 266.93],
      [1771943400000, 267.92, 274.25, 267.73, 274.2],
      [1771944300000, 274.22, 274.89, 273.63, 274.08],
    ],
    trades: [[1771888500000, 267.3, 1771888500000, 266.78, 1.0, -60.52, 60.0], [1771924500000, 267.01, 1771924500000, 266.77, 1.0, -60.24, 60.0]],
  },
  { name: "extended-distinct-open", crypto: false,
    source: `//@version=5
strategy("VIN175 AAPL distinct open day boundary", overlay=true, initial_capital=100000, pyramiding=1, calc_on_order_fills=false, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.cash_per_order, commission_value=30, margin_long=0, margin_short=0)
// NASDAQ:AAPL, 15 minutes, EXTENDED hours. Dates use New York winter time.
strategy.risk.max_intraday_loss(1, strategy.cash)
if time == timestamp("America/New_York", 2026, 2, 23, 18, 15)
    strategy.entry("before-UTC-midnight", strategy.long, qty=1)
if time == timestamp("America/New_York", 2026, 2, 23, 19, 0)
    strategy.entry("after-UTC-midnight", strategy.long, qty=1)
if time == timestamp("America/New_York", 2026, 2, 24, 4, 0)
    strategy.entry("next-premarket", strategy.long, qty=1)
if time == timestamp("America/New_York", 2026, 2, 24, 9, 30)
    strategy.entry("regular-open", strategy.long, qty=1)

plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")
`,
    bars: [
      [1771886700000, 266.87, 266.87, 266.86, 266.87],
      [1771887600000, 266.87, 267.5, 266.78, 267.4],
      [1771888500000, 267.3, 267.3, 266.78, 267.25],
      [1771889400000, 267.2, 267.38, 267.13, 267.37],
      [1771891200000, 266.96, 267.24, 266.96, 267.24],
      [1771892100000, 267.25, 267.51, 266.86, 266.86],
      [1771923600000, 267.3, 267.3, 266.54, 266.98],
      [1771924500000, 267.01, 267.01, 266.77, 266.93],
      [1771943400000, 267.92, 274.25, 267.73, 274.2],
      [1771944300000, 274.22, 274.89, 273.63, 274.08],
    ],
    trades: [[1771889400000, 267.2, 1771889400000, 267.13, 1.0, -60.07, 60.0], [1771924500000, 267.01, 1771924500000, 266.77, 1.0, -60.24, 60.0]],
  },
  { name: "fee-only-favorable-first", crypto: true,
    source: `//@version=5
strategy("Fee-only loss check on favorable first move", initial_capital=100000, calc_on_order_fills=false, process_orders_on_close=false, commission_type=strategy.commission.cash_per_order, commission_value=30, slippage=0, margin_long=0, margin_short=0)
strategy.risk.max_intraday_loss(1, strategy.cash)
if time == timestamp("UTC", 2020, 3, 16, 0, 0)
    strategy.entry("fee-only", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("cleanup")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")
`,
    bars: [
      [1584302400000, 174.95, 190.69, 170.94, 178.2],
      [1584316800000, 178.2, 184.41, 174.4, 179.61],
      [1584331200000, 179.63, 179.95, 158.0, 159.31],
      [1584345600000, 159.16, 164.84, 147.14, 150.85],
    ],
    trades: [[1584331200000, 179.6, 1584331200000, 179.9, 1.0, -59.7, 60.0]],
  }
];
for (const c of cases) it(`VIN175 native fee-only timing ${c.name}`, async()=>{
 const tf=c.crypto?'240':'15'; const step=c.crypto ? .0001 : 1;
 const feed={configure(){},getQtyStep(){return step;},async getMarketData(){return c.bars.map(([time,open,high,low,close])=>({openTime:time,closeTime:time+Number(tf)*60000-1,open,high,low,close,volume:1}));},async getSymbolInfo(){return {prefix:c.crypto?'BINANCE':'BATS',ticker:c.crypto?'BCHUSDT':'AAPL',type:c.crypto?'crypto':'stock',currency:c.crypto?'USDT':'USD',mintick:c.crypto ? .1 : .01,mincontract:step,pointvalue:1,timezone:c.crypto?'Etc/UTC':'America/New_York',session:c.crypto?'24x7':'0400-2000'};}};
 const r=await new PineTS(feed as any,c.crypto?'BCHUSDT':'AAPL',tf).run(c.source);
 expect(r.strategy!.closedtrades).toHaveLength(c.trades.length);
 expect(r.strategy!.opentrades).toHaveLength(0);
 c.trades.forEach((v,i)=>{const t=r.strategy!.closedtrades[i];const actual=[t.entry_time,t.entry_price,t.exit_time,t.exit_price,t.size,t.profit,t.commission];v.forEach((x,j)=>expect(actual[j]).toBeCloseTo(x,8));});
 const net = c.trades.reduce((sum,t)=>sum+t[5],0);
 expect(r.strategy!.netprofit).toBeCloseTo(net,8);
 expect(r.plots.Equity.data.at(-1)!.value).toBeCloseTo(100000+net,8);
 expect(r.plots.Position.data.every(p=>p.value===0)).toBe(true);
});
