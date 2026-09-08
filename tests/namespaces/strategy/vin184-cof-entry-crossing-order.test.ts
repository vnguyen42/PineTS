import {expect,it} from 'vitest';
import {PineTS} from '../../../src/PineTS.class';

// Public2030: pending queue DCA5/DCA4/DCA3 before 21 June 2021 04:00.
// Native FIFO later consumes DCA3 first (row46), consistent with HIGH->LOW
// crossings DCA3/DCA4/DCA5. Raw source/CSV: vin181-20260908/public2030-tv.
it('executes competing interior limits in path order before adding FIFO lots',async()=>{
 const bars=[
  [1624233600000,35600.17,35750,34566.82,34649.63],
  [1624248000000,34651.86,34725.82,32266,33025.5],
 ];
 const feed={configure(){},getQtyStep(){return .00001},async getMarketData(){return bars.map(([openTime,open,high,low,close])=>({openTime,open,high,low,close,closeTime:openTime+14400000-1,volume:1}))},async getSymbolInfo(){return{prefix:'BINANCE',ticker:'BTCUSDT',tickerid:'BINANCE:BTCUSDT',type:'crypto',currency:'USDT',mintick:.01,pointvalue:1,mincontract:.00001,timezone:'Etc/UTC',session:'24x7'}}};
 const ctx=await new PineTS(feed,'BTCUSDT','240').run(`//@version=5
strategy("2030 conditional entry sequence",pyramiding=3,calc_on_order_fills=true,margin_long=0)
if time == 1624233600000
    strategy.entry("DCA5",strategy.long,qty=.00199,limit=32693.47)
    strategy.entry("DCA4",strategy.long,qty=.00202,limit=33579.47)
    strategy.entry("DCA3",strategy.long,qty=.00193,limit=34359.51)
`);
 expect(ctx.strategy.opentrades.map(t=>[t.entry_id,t.entry_time])).toEqual([
  ['DCA3',1624248000000],['DCA4',1624248000000],['DCA5',1624248000000],
 ]);
 [34359.51,33579.47,32693.47].forEach((p,i)=>expect(ctx.strategy.opentrades[i].entry_price).toBeCloseTo(p,8));
 [.00193,.00202,.00199].forEach((q,i)=>expect(ctx.strategy.opentrades[i].size).toBeCloseTo(q,12));
});
