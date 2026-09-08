import {expect,it} from 'vitest';
import {PineTS} from '../../../src/PineTS.class';

// Four native public2030 DCA2 entries: the original expression is below the
// creation OPEN but above the final CLOSE. Raw OHLC and fills are archived in
// vin182-20260908/tick-reference and vin181-20260908/public2030-tv.
const cases = [
 {price:55052.88,bars:[
  [1618718400000,55000.01,56527.04,53924.76,56180.34],
  [1618732800000,56184.51,56498,53064.66,53308.92],
 ]},
 {price:38552.39,bars:[
  [1621440000000,37310.14,40442,36111,39342.93],
  [1621454400000,39337.45,40200,36600.01,36690.09],
 ]},
 {price:57114.08,bars:[
  [1720108800000,58140,58676.24,57752.27,58283.62],
  [1720123200000,58283.62,58813.13,56866,57050.01],
 ]},
 {price:90306.76,bars:[
  [1740441600000,91552.88,92540.69,90912.01,92153.93],
  [1740456000000,92153.93,92327.88,88200,89320.01],
 ]},
];
it.each(cases)('rounds the COF limit away from its creation point ($price)',async({price,bars})=>{
 const feed={configure(){},getQtyStep(){return .00001},async getMarketData(){return bars.map(([openTime,open,high,low,close])=>({openTime,open,high,low,close,closeTime:openTime+14400000-1,volume:1}))},async getSymbolInfo(){return{prefix:'BINANCE',ticker:'BTCUSDT',tickerid:'BINANCE:BTCUSDT',type:'crypto',currency:'USDT',mintick:.01,pointvalue:1,mincontract:.00001,timezone:'Etc/UTC',session:'24x7'}}};
 const ctx=await new PineTS(feed,'BTCUSDT','240').run(`//@version=5
strategy("2030 DCA2 quantization",pyramiding=2,calc_on_order_fills=true,margin_long=0)
var float entry_price = na
if time == ${bars[0][0]}
    entry_price := close
    strategy.entry("FE1",strategy.long,qty=.001)
if strategy.opentrades == 1
    base_number = math.pow(entry_price,1.0/8)
    dca_level = (entry_price-math.pow(base_number,1))*(1-(math.pow(1+2.0/100,1)-1))
    strategy.entry("DCA2",strategy.long,qty=.001,limit=dca_level)
`);
 expect(ctx.strategy.opentrades).toHaveLength(2);
 const dca=ctx.strategy.opentrades[1];
 expect([dca.entry_id,dca.entry_time,dca.size]).toEqual(['DCA2',bars[1][0],.001]);
 expect(dca.entry_price).toBeCloseTo(price,8);
});
