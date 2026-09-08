import {expect,it} from 'vitest';
import {PineTS} from '../../../src/PineTS.class';

// Native public2030 on 4 April 2023 08UTC: Exit_8 crosses at28302.93,
// then a newly submitted DCA7 limit fills at HIGH28444.44, not the next OPEN.
it('fills a fresh limit at the endpoint after an interior COF exit',async()=>{
 const bars=[
  [1680580800000,27855.06,28145,27775.37,28021.3],
  [1680595200000,28021.31,28444.44,27931.2,28289.52],
  [1680609600000,28289.51,28399,27947.59,28030.04],
 ];
 const feed={configure(){},getQtyStep(){return .00001},async getMarketData(){return bars.map(([openTime,open,high,low,close])=>({openTime,open,high,low,close,closeTime:openTime+14400000-1,volume:1}))},async getSymbolInfo(){return{prefix:'BINANCE',ticker:'BTCUSDT',tickerid:'BINANCE:BTCUSDT',type:'crypto',currency:'USDT',mintick:.01,pointvalue:1,mincontract:.00001,timezone:'Etc/UTC',session:'24x7'}}};
 const ctx=await new PineTS(feed,'BTCUSDT','240').run(`//@version=5
strategy("2030 limit after exit",pyramiding=2,calc_on_order_fills=true,margin_long=0)
if time == 1680580800000
    strategy.entry("old",strategy.long,qty=.001)
if strategy.closedtrades == 0
    strategy.exit("Exit_8",from_entry="old",limit=28302.93)
varip bool sent = false
if strategy.closedtrades == 1 and not sent
    sent := true
    strategy.entry("DCA7",strategy.long,qty=.001,limit=35600.86)
`);
 expect(ctx.strategy.closedtrades).toHaveLength(1);
 expect(ctx.strategy.closedtrades[0].exit_price).toBeCloseTo(28302.93,8);
 expect(ctx.strategy.opentrades).toHaveLength(1);
 const t=ctx.strategy.opentrades[0];
 expect([t.entry_id,t.entry_time,t.size]).toEqual(['DCA7',1680595200000,.001]);
 expect(t.entry_price).toBeCloseTo(28444.44,8);
});
