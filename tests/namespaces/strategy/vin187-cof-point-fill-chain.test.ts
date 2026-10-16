import {expect,it} from 'vitest';
import {PineTS} from '../../../src/PineTS.class';

// VIN-187, public2030 'Simple RSI+PA+DCA' (BINANCE:BTCUSDT 4h, COF, pyramiding).
// A fresh LIMIT that fills at a path point chains: the next fresh LIMIT is
// checked at the following point only, and the terminal CLOSE is never such
// a point. Native ledger rows 248-273.

const feed=(bars:number[][])=>({configure(){},getQtyStep(){return .00001},async getMarketData(){return bars.map(([openTime,open,high,low,close])=>({openTime,open,high,low,close,closeTime:openTime+14400000-1,volume:1}))},async getSymbolInfo(){return{prefix:'BINANCE',ticker:'BTCUSDT',tickerid:'BINANCE:BTCUSDT',type:'crypto',currency:'USDT',mintick:.01,pointvalue:1,mincontract:.00001,timezone:'Etc/UTC',session:'24x7'}}});
const entries=(ctx:any)=>[...ctx.strategy.closedtrades,...ctx.strategy.opentrades]
 .map((t:any)=>[t.entry_id,t.entry_time,t.entry_price]).sort((a:any,b:any)=>a[1]-b[1]||a[0].localeCompare(b[0]));

// 5 Aug 2024 04UTC (OPEN->HIGH->LOW->CLOSE): Exit_7 crosses inside OPEN->HIGH at
// 53916.9, the fresh DCA6 fills at HIGH 54576.71, the fresh DCA7 (52683.07) fills
// at LOW 49000; its TP crosses inside LOW->CLOSE at 50580.23 and the next fresh
// DCA7, marketable at the close, fills at the next open 52674.2.
it('chains fresh limits after a point fill and defers the close to the next open',async()=>{
 const bars=[
  [1722798000000,53600,53800,53400,53500],
  [1722812400000,53500,53700,53300,53600],
  [1722830400000,53890.87,54576.71,49000,52674.19],
  [1722844800000,52674.2,53218.37,50633.47,51340],
 ];
 const ctx=await new PineTS(feed(bars),'BTCUSDT','240').run(`//@version=5
strategy("vin187 point chain",pyramiding=10,calc_on_order_fills=true,margin_long=0,close_entries_rule="ANY")
if bar_index == 0
    strategy.entry("old",strategy.long,qty=.001)
if strategy.closedtrades == 0
    strategy.exit("Exit_7",from_entry="old",limit=53916.9)
if bar_index == 2 and strategy.closedtrades == 1 and strategy.opentrades == 0
    strategy.entry("DCA6",strategy.long,qty=.001,limit=56726.39)
if bar_index == 2 and strategy.closedtrades == 1 and strategy.opentrades == 1
    strategy.entry("DCA7",strategy.long,qty=.001,limit=52683.07)
strategy.exit("tp7",from_entry="DCA7",profit=158022.57)
if bar_index == 2 and strategy.closedtrades == 2
    strategy.entry("DCA7b",strategy.long,qty=.001,limit=52683.07)
`);
 expect(ctx.strategy.closedtrades.map((t:any)=>[t.entry_id,t.exit_price])).toEqual([['old',53916.9],['DCA7',50580.23]]);
 expect(entries(ctx)).toEqual([
  ['old',1722812400000,53500],
  ['DCA6',1722830400000,54576.71],
  ['DCA7',1722830400000,49000],
  ['DCA7b',1722844800000,52674.2],
 ]);
});

// 6 Aug 2024 04UTC (OPEN->LOW->HIGH->CLOSE): the pending DCA2 fills at the open;
// the fresh DCA3, marketable there, fills at that open; then DCA4 at LOW 55255,
// DCA5 at HIGH 56169.48, and DCA6 at the next open 55998.02.
it('fills a fresh marketable limit at the open, then chains point by point',async()=>{
 const bars=[
  [1722902400000,54018.82,56276,53950,55665.73],
  [1722916800000,55665.73,56169.48,55255,55999.99],
  [1722931200000,55998.02,56122,54600.01,55210.01],
 ];
 const ctx=await new PineTS(feed(bars),'BTCUSDT','240').run(`//@version=5
strategy("vin187 open chain",pyramiding=10,calc_on_order_fills=true,margin_long=0)
if bar_index == 0
    strategy.entry("DCA2",strategy.long,qty=.001,limit=63038.11)
n = strategy.opentrades
if bar_index == 1 and n >= 1 and n < 5
    strategy.entry("DCA" + str.tostring(n + 2),strategy.long,qty=.001,limit=60331.5)
`);
 expect(entries(ctx)).toEqual([
  ['DCA2',1722916800000,55665.73],
  ['DCA3',1722916800000,55665.73],
  ['DCA4',1722916800000,55255],
  ['DCA5',1722916800000,56169.48],
  ['DCA6',1722931200000,55998.02],
 ]);
});
