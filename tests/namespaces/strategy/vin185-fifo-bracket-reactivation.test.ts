import {expect,it} from 'vitest';
import {PineTS} from '../../../src/PineTS.class';

// Reduced lifecycle from native public2030 rows67/68: a valid new profit
// bracket must still consume the remainder of a physical FIFO lot touched
// by its predecessor. Activation exclusions continue to prevent refills.
it('lets a new profit activation consume an older FIFO remainder',async()=>{
 const bars=[
  [1584244800000,166.96,172.3,166.96,169.21],
  [1584259200000,169.22,179,167.75,174.86],
  [1584273600000,174.85,179.81,170.07,172.71],
 ];
 const feed={configure(){},getQtyStep(){return .0001},async getMarketData(){return bars.map(([openTime,open,high,low,close])=>({openTime,open,high,low,close,closeTime:openTime+14400000-1,volume:1}))},async getSymbolInfo(){return{prefix:'BINANCE',ticker:'BCHUSDT',tickerid:'BINANCE:BCHUSDT',type:'crypto',currency:'USDT',mintick:.1,pointvalue:1,mincontract:.0001,timezone:'Etc/UTC',session:'24x7'}}};
 const ctx=await new PineTS(feed,'BCHUSDT','240').run(`//@version=5
strategy("FIFO profit reactivation",pyramiding=5,calc_on_order_fills=true,margin_long=0)
if time == 1584244800000
    strategy.entry("old",strategy.long,qty=3)
varip bool firstSent = false
varip bool nextSent = false
if time == 1584259200000 and strategy.opentrades == 1 and not firstSent
    firstSent := true
    strategy.entry("A",strategy.long,qty=1)
if strategy.closedtrades == 1 and not nextSent
    nextSent := true
    strategy.entry("A",strategy.long,qty=1)
if strategy.position_size > 0 and strategy.closedtrades < 2
    strategy.exit("profit",from_entry="A",profit=20)
`);
 expect(ctx.strategy.closedtrades.map(t=>[t.entry_id,t.size])).toEqual([['old',1],['old',1]]);
});
