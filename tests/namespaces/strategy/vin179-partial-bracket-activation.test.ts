import {expect,it} from 'vitest';
import {PineTS} from '../../../src/PineTS.class';
// Native BCH partial TP/stop: oracle-archives/vin179-20260908, with and without inactive daily risk.
const bars = [
  [1584230400000, 167.08, 170.0, 165.44, 166.88],
  [1584244800000, 166.96, 172.3, 166.96, 169.21],
  [1584259200000, 169.22, 179.0, 167.75, 174.86],
  [1584273600000, 174.85, 179.81, 170.07, 172.71],
  [1584288000000, 172.71, 176.56, 171.28, 174.93],
  [1584302400000, 174.95, 190.69, 170.94, 178.2],
  [1584316800000, 178.2, 184.41, 174.4, 179.61],
  [1584331200000, 179.63, 179.95, 158.0, 159.31],
  [1584345600000, 159.16, 164.84, 147.14, 150.85],
  [1584360000000, 150.85, 174.0, 150.04, 172.56],
  [1584374400000, 172.52, 176.0, 165.37, 168.46],
  [1584388800000, 168.39, 172.77, 162.67, 172.41],
  [1584403200000, 172.45, 184.64, 168.73, 180.1],
  [1584417600000, 179.97, 186.78, 176.31, 182.17],
  [1584432000000, 182.17, 187.59, 177.13, 180.81],
];
const source = "//@version=5\nstrategy(\"BCH partial TP then stop path control\", overlay=true, initial_capital=100000, pyramiding=2, calc_on_order_fills=false, process_orders_on_close=false, commission_type=strategy.commission.percent, commission_value=0.1, slippage=0, margin_long=0, margin_short=0)\n// No intraday risk rule.\nif time == timestamp(\"UTC\", 2020, 3, 15, 0, 0)\n    strategy.entry(\"first\", strategy.long, qty=2)\nif time == timestamp(\"UTC\", 2020, 3, 15, 4, 0)\n    strategy.entry(\"second\", strategy.long, qty=4)\nif time == timestamp(\"UTC\", 2020, 3, 15, 8, 0)\n    strategy.exit(\"partial-TP\", qty_percent=50, limit=179)\nif time == timestamp(\"UTC\", 2020, 3, 15, 12, 0)\n    strategy.exit(\"remaining-stop\", stop=170.1)\nif time == timestamp(\"UTC\", 2020, 3, 17, 4, 0)\n    strategy.close_all(\"cleanup\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\nplot(strategy.netprofit, \"Net profit\")\nplot(strategy.closedtrades, \"Closed trades\")\n";
const nativePlots = [
  [1584230400000, 0.0, 100000.0, 0.0, 0.0],
  [1584244800000, 2.0, 100004.06599999999, -0.334, 0.0],
  [1584259200000, 6.0, 100037.5892, -1.0108, 0.0],
  [1584273600000, 3.0, 100042.7522, 32.25219999999999, 3.0],
  [1584288000000, 3.0, 100049.35220000001, 32.25219999999999, 3.0],
  [1584302400000, 3.0, 100059.2522, 32.25219999999999, 3.0],
  [1584316800000, 3.0, 100063.4522, 32.25219999999999, 3.0],
  [1584331200000, 0.0, 100034.4419, 34.4419, 5.0],
  [1584345600000, 0.0, 100034.4419, 34.4419, 5.0],
  [1584360000000, 0.0, 100034.4419, 34.4419, 5.0],
  [1584374400000, 0.0, 100034.4419, 34.4419, 5.0],
  [1584388800000, 0.0, 100034.4419, 34.4419, 5.0],
  [1584403200000, 0.0, 100034.4419, 34.4419, 5.0],
  [1584417600000, 0.0, 100034.4419, 34.4419, 5.0],
  [1584432000000, 0.0, 100034.4419, 34.4419, 5.0],
];
const nativeMoney = [[1584244800000, 1584273600000, 167.0, 11.65, 0.35], [1584244800000, 1584273600000, 167.0, 11.65, 0.35], [1584259200000, 1584273600000, 169.2, 9.45, 0.35], [1584259200000, 1584331200000, 169.2, 0.56, 0.34], [1584259200000, 1584331200000, 169.2, 1.12, 0.68]];
for(const risk of [false,true]) it(`native partial bracket allocations with risk=${risk}`,async()=>{
 const feed={configure(){},getQtyStep(){return .0001},async getMarketData(){return bars.map(([t,open,high,low,close])=>({openTime:t,closeTime:t+14400000-1,open,high,low,close,volume:1}));},async getSymbolInfo(){return{prefix:'BINANCE',ticker:'BCHUSDT',type:'crypto',currency:'USDT',basecurrency:'BCH',mintick:.1,mincontract:.0001,pointvalue:1,timezone:'Etc/UTC',session:'24x7'}}};
 const pine=risk?source.replace('if time ==', 'strategy.risk.max_intraday_loss(1000000, strategy.cash)\nif time =='):source;
 const r=await new PineTS(feed as any,'BCHUSDT','240').run(pine);
 expect(r.strategy!.closedtrades.map(t=>[t.entry_id,t.exit_id,t.size])).toEqual([
 ['first','partial-TP',1],['first','partial-TP',1],['second','partial-TP',1],
 ['second','remaining-stop',1],['second','remaining-stop',2],
 ]);
 r.strategy!.closedtrades.forEach((t,i)=>{
  expect(t.exit_price).toBeCloseTo(i<3?179:170.1,10);
  expect([t.entry_time,t.exit_time,t.entry_price]).toEqual(nativeMoney[i].slice(0,3));
  expect(Math.abs(t.profit-nativeMoney[i][3])).toBeLessThan(.0051);
  expect(Math.abs(t.commission-nativeMoney[i][4])).toBeLessThan(.0051);
 });
 for(const [i,field] of ['Position','Equity','Net profit'].entries()) {
  r.plots[field].data.forEach((p,j)=>{expect(p.time).toBe(nativePlots[j][0]);expect(p.value).toBeCloseTo(nativePlots[j][i+1],8);});
 }
 expect(r.strategy!.opentrades).toHaveLength(0);

});
