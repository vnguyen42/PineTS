import {expect,it} from 'vitest';
import {PineTS} from '../../../src/PineTS.class';

// Public2030 native: DCA2 crosses HIGH->LOW, then the newly submitted DCA3
// executes at LOW, not at its already-passed limit or the next bar's OPEN.
it('fills a fresh limit at the endpoint after an interior COF entry',async()=>{
 const bars = [
  [1618718400000,55000.01,56527.04,53924.76,56180.34],
  [1618732800000,56184.51,56498,53064.66,53308.92],
  [1618747200000,53299.32,55774.23,53200,55452.45],
 ];
 const feed = {configure(){},getQtyStep(){return .00001},async getMarketData(){return bars.map(([openTime,open,high,low,close])=>({openTime,open,high,low,close,closeTime:openTime+14400000-1,volume:1}))},async getSymbolInfo(){return {prefix:'BINANCE',ticker:'BTCUSDT',tickerid:'BINANCE:BTCUSDT',type:'crypto',currency:'USDT',mintick:.01,pointvalue:1,mincontract:.00001,timezone:'Etc/UTC',session:'24x7'}}};
 const ctx=await new PineTS(feed,'BTCUSDT','240').run(`//@version=5
strategy("2030 interior limit entry", pyramiding=3, calc_on_order_fills=true, margin_long=0)
if time == 1618718400000
    strategy.entry("FE1",strategy.long,qty=.00115)
if strategy.opentrades == 1
    strategy.entry("DCA2",strategy.long,qty=.00113,limit=55052.88)
if strategy.opentrades == 2
    strategy.entry("DCA3",strategy.long,qty=.00111,limit=53895.89)
`);
 expect(ctx.strategy.opentrades.map(t=>[t.entry_id,t.entry_time])).toEqual([
  ['FE1',1618732800000],['DCA2',1618732800000],['DCA3',1618732800000],
 ]);
 [56184.51,55052.88,53064.66].forEach((price,i)=>expect(ctx.strategy.opentrades[i].entry_price).toBeCloseTo(price,8));
});
