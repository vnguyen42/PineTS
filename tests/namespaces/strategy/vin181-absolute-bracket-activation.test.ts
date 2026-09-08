import {expect,it} from 'vitest';
import {PineTS} from '../../../src/PineTS.class';
// VIN181 native absolute exits: once, reaction at the endpoint, and smaller per-activation qty.
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
const cases = [
  {name:"cof-absolute-varip", source:"//@version=5\nstrategy(\"COF absolute bracket submitted once\", initial_capital=100000, pyramiding=3, calc_on_order_fills=true, commission_type=strategy.commission.percent, commission_value=0.1, margin_long=0, margin_short=0)\nif time == timestamp(\"UTC\", 2020, 3, 15, 0, 0) and strategy.position_size == 0\n    strategy.entry(\"old\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 15, 4, 0) and strategy.opentrades == 1\n    strategy.entry(\"DCA\", strategy.long, qty=2)\nif time == timestamp(\"UTC\", 2020, 3, 15, 8, 0) and strategy.opentrades == 2\n    strategy.entry(\"DCA\", strategy.long, qty=2)\nvarip bool exitSent = false\nif time == timestamp(\"UTC\", 2020, 3, 15, 12, 0) and not exitSent\n    exitSent := true\n    strategy.exit(\"absolute\", from_entry=\"DCA\", qty=3, limit=179)\nif time == timestamp(\"UTC\", 2020, 3, 17, 4, 0)\n    strategy.close_all(\"cleanup\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\nplot(strategy.netprofit, \"Net profit\")\nplot(strategy.closedtrades + 0, \"Closed trades\")\n",
   trades:[["absolute", 1.0, 179.0], ["absolute", 1.0, 179.0], ["absolute", 1.0, 179.0], ["absolute", 1.0, 179.0], ["cleanup", 1.0, 182.2]],
   plots: [
    [0.0, 100000.0, 0.0, 0.0],
    [3.0, 100006.099, -0.501, 0.0],
    [3.0, 100023.199, -0.501, 0.0],
    [1.0, 100036.5334, 38.633399999999995, 4.0],
    [1.0, 100038.73340000001, 38.633399999999995, 4.0],
    [1.0, 100042.0334, 38.633399999999995, 4.0],
    [1.0, 100043.43340000001, 38.633399999999995, 4.0],
    [1.0, 100023.1334, 38.633399999999995, 4.0],
    [1.0, 100014.6334, 38.633399999999995, 4.0],
    [1.0, 100036.43340000001, 38.633399999999995, 4.0],
    [1.0, 100032.3334, 38.633399999999995, 4.0],
    [1.0, 100036.23340000001, 38.633399999999995, 4.0],
    [1.0, 100043.93340000001, 38.633399999999995, 4.0],
    [1.0, 100046.0334, 38.633399999999995, 4.0],
    [0.0, 100045.8512, 45.8512, 5.0],
   ]},
  {name:"cof-absolute-decision", source:"//@version=5\nstrategy(\"COF absolute quantity decision after fill\", initial_capital=100000, pyramiding=3, calc_on_order_fills=true, commission_type=strategy.commission.percent, commission_value=0.1, margin_long=0, margin_short=0)\nif time == timestamp(\"UTC\", 2020, 3, 15, 0, 0) and strategy.position_size == 0\n    strategy.entry(\"old\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 15, 4, 0) and strategy.opentrades == 1\n    strategy.entry(\"DCA\", strategy.long, qty=2)\nif time == timestamp(\"UTC\", 2020, 3, 15, 8, 0) and strategy.opentrades == 2\n    strategy.entry(\"DCA\", strategy.long, qty=2)\nvarip bool exitSent = false\nif time == timestamp(\"UTC\", 2020, 3, 15, 12, 0) and not exitSent\n    exitSent := true\n    strategy.exit(\"absolute\", from_entry=\"DCA\", qty=3, limit=179)\nif strategy.position_size == 1 and strategy.closedtrades >= 4\n    strategy.close_all(\"after-four-units\")\nif time == timestamp(\"UTC\", 2020, 3, 17, 4, 0)\n    strategy.close_all(\"cleanup\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\nplot(strategy.netprofit, \"Net profit\")\nplot(strategy.closedtrades + 0, \"Closed trades\")\n",
   trades:[["absolute", 1.0, 179.0], ["absolute", 1.0, 179.0], ["absolute", 1.0, 179.0], ["absolute", 1.0, 179.0], ["after-four-units", 1.0, 179.8]],
   plots: [
    [0.0, 100000.0, 0.0, 0.0],
    [3.0, 100006.099, -0.501, 0.0],
    [3.0, 100023.199, -0.501, 0.0],
    [0.0, 100043.4536, 43.453599999999994, 5.0],
    [0.0, 100043.4536, 43.453599999999994, 5.0],
    [0.0, 100043.4536, 43.453599999999994, 5.0],
    [0.0, 100043.4536, 43.453599999999994, 5.0],
    [0.0, 100043.4536, 43.453599999999994, 5.0],
    [0.0, 100043.4536, 43.453599999999994, 5.0],
    [0.0, 100043.4536, 43.453599999999994, 5.0],
    [0.0, 100043.4536, 43.453599999999994, 5.0],
    [0.0, 100043.4536, 43.453599999999994, 5.0],
    [0.0, 100043.4536, 43.453599999999994, 5.0],
    [0.0, 100043.4536, 43.453599999999994, 5.0],
    [0.0, 100043.4536, 43.453599999999994, 5.0],
   ]},
  {name:"cof-absolute-small", source:"//@version=5\nstrategy(\"COF absolute small quantity per activation\", initial_capital=100000, pyramiding=3, calc_on_order_fills=true, commission_type=strategy.commission.percent, commission_value=0.1, margin_long=0, margin_short=0)\nif time == timestamp(\"UTC\", 2020, 3, 15, 0, 0) and strategy.position_size == 0\n    strategy.entry(\"old\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 15, 4, 0) and strategy.opentrades == 1\n    strategy.entry(\"DCA\", strategy.long, qty=2)\nif time == timestamp(\"UTC\", 2020, 3, 15, 8, 0) and strategy.opentrades == 2\n    strategy.entry(\"DCA\", strategy.long, qty=2)\nvarip bool exitSent = false\nif time == timestamp(\"UTC\", 2020, 3, 15, 12, 0) and not exitSent\n    exitSent := true\n    strategy.exit(\"absolute\", from_entry=\"DCA\", qty=1, limit=179)\nif time == timestamp(\"UTC\", 2020, 3, 17, 4, 0)\n    strategy.close_all(\"cleanup\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\nplot(strategy.netprofit, \"Net profit\")\nplot(strategy.closedtrades + 0, \"Closed trades\")\n",
   trades:[["absolute", 1.0, 179.0], ["absolute", 1.0, 179.0], ["cleanup", 1.0, 182.2], ["cleanup", 2.0, 182.2]],
   plots: [
    [0.0, 100000.0, 0.0, 0.0],
    [3.0, 100006.099, -0.501, 0.0],
    [3.0, 100023.199, -0.501, 0.0],
    [3.0, 100024.2914, 22.7914, 2.0],
    [3.0, 100030.89140000001, 22.7914, 2.0],
    [3.0, 100040.7914, 22.7914, 2.0],
    [3.0, 100044.9914, 22.7914, 2.0],
    [3.0, 99984.0914, 22.7914, 2.0],
    [3.0, 99958.5914, 22.7914, 2.0],
    [3.0, 100023.9914, 22.7914, 2.0],
    [3.0, 100011.6914, 22.7914, 2.0],
    [3.0, 100023.39140000001, 22.7914, 2.0],
    [3.0, 100046.4914, 22.7914, 2.0],
    [3.0, 100052.7914, 22.7914, 2.0],
    [0.0, 100052.2448, 52.244800000000026, 4.0],
   ]},
 ];
for(const c of cases) it(c.name,async()=>{
 const feed={configure(){},getQtyStep(){return .0001},async getMarketData(){return bars.map(([t,open,high,low,close])=>({openTime:t,closeTime:t+14400000-1,open,high,low,close,volume:1}));},async getSymbolInfo(){return{prefix:'BINANCE',ticker:'BCHUSDT',type:'crypto',currency:'USDT',basecurrency:'BCH',mintick:.1,mincontract:.0001,pointvalue:1,timezone:'Etc/UTC',session:'24x7'}}};
 const r=await new PineTS(feed as any,'BCHUSDT','240').run(c.source);
 expect(r.strategy!.closedtrades).toHaveLength(c.trades.length);
 r.strategy!.closedtrades.forEach((t,i)=>{
  expect(t.exit_comment ?? t.exit_id).toBe(c.trades[i][0]);
  expect(t.size).toBe(c.trades[i][1]);
  expect(t.exit_price).toBeCloseTo(c.trades[i][2] as number,10);
 });
 expect(r.strategy!.opentrades).toHaveLength(0);
 for(const [i,name] of ['Position','Equity','Net profit','Closed trades'].entries()){
  r.plots[name].data.forEach((p,j)=>{expect(p.time).toBe(bars[j][0]);expect(p.value).toBeCloseTo(c.plots[j][i],8);});
 }
});
