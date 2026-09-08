import {expect,it} from 'vitest';
import {PineTS} from '../../../src/PineTS.class';
// VIN180: native with-risk BCH bracket capture, including the direct Closed trades plot.
const bars = [
  [1584230400000, 167.08, 170.0, 165.44, 166.88, 0],
  [1584244800000, 166.96, 172.3, 166.96, 169.21, 0],
  [1584259200000, 169.22, 179.0, 167.75, 174.86, 0],
  [1584273600000, 174.85, 179.81, 170.07, 172.71, 3],
  [1584288000000, 172.71, 176.56, 171.28, 174.93, 3],
  [1584302400000, 174.95, 190.69, 170.94, 178.2, 3],
  [1584316800000, 178.2, 184.41, 174.4, 179.61, 3],
  [1584331200000, 179.63, 179.95, 158.0, 159.31, 5],
  [1584345600000, 159.16, 164.84, 147.14, 150.85, 5],
  [1584360000000, 150.85, 174.0, 150.04, 172.56, 5],
  [1584374400000, 172.52, 176.0, 165.37, 168.46, 5],
  [1584388800000, 168.39, 172.77, 162.67, 172.41, 5],
  [1584403200000, 172.45, 184.64, 168.73, 180.1, 5],
  [1584417600000, 179.97, 186.78, 176.31, 182.17, 5],
  [1584432000000, 182.17, 187.59, 177.13, 180.81, 5],
];
const source = "//@version=5\nstrategy(\"BCH partial TP then stop path control\", overlay=true, initial_capital=100000, pyramiding=2, calc_on_order_fills=false, process_orders_on_close=false, commission_type=strategy.commission.percent, commission_value=0.1, slippage=0, margin_long=0, margin_short=0)\nstrategy.risk.max_intraday_loss(1000000, strategy.cash)\nif time == timestamp(\"UTC\", 2020, 3, 15, 0, 0)\n    strategy.entry(\"first\", strategy.long, qty=2)\nif time == timestamp(\"UTC\", 2020, 3, 15, 4, 0)\n    strategy.entry(\"second\", strategy.long, qty=4)\nif time == timestamp(\"UTC\", 2020, 3, 15, 8, 0)\n    strategy.exit(\"partial-TP\", qty_percent=50, limit=179)\nif time == timestamp(\"UTC\", 2020, 3, 15, 12, 0)\n    strategy.exit(\"remaining-stop\", stop=170.1)\nif time == timestamp(\"UTC\", 2020, 3, 17, 4, 0)\n    strategy.close_all(\"cleanup\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\nplot(strategy.netprofit, \"Net profit\")\nplot(strategy.closedtrades, \"Closed trades\")\n\nplot(strategy.opentrades, \"Open trades\")\nplot(strategy.closedtrades.profit(0), \"First closed profit\")\nplot(strategy.opentrades.entry_price(0), \"First open price\")\nplot(series=close, title=\"Named close\")\nplot(series=strategy.closedtrades, title=\"Named closed\")\n";
it('plots the snapshotted trade counts without consuming their titles or namespace methods',async()=>{
 const feed={configure(){},getQtyStep(){return .0001},async getMarketData(){return bars.map(([t,open,high,low,close])=>({openTime:t,closeTime:t+14400000-1,open,high,low,close,volume:1}));},async getSymbolInfo(){return{prefix:'BINANCE',ticker:'BCHUSDT',type:'crypto',currency:'USDT',basecurrency:'BCH',mintick:.1,mincontract:.0001,pointvalue:1,timezone:'Etc/UTC',session:'24x7'}}};
 const r=await new PineTS(feed as any,'BCHUSDT','240').run(source);
 expect(r.plots['Closed trades']?.data.map(p=>p.value)).toEqual(bars.map(b=>b[5]));
 expect(r.plots['Named closed']?.data.map(p=>p.value)).toEqual(bars.map(b=>b[5]));
 expect(r.plots['Open trades']?.data.map(p=>p.value)).toEqual(bars.map((b,i)=>i===0?0:i===1?1:i===2?2:b[5]===3?1:0));
 expect(r.plots['First closed profit'].data.at(-1)!.value).toBeCloseTo(11.654,10);
 expect(r.plots['First open price'].data[1].value).toBe(167);
 expect(r.plots['Named close'].data.map(p=>p.value)).toEqual(bars.map(b=>b[4]));
 expect(r.strategy!.closedtrades).toHaveLength(5);
});
