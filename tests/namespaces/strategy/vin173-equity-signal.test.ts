import { expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
// BCH240 OHLC reused from VIN170; fee expectations are the native VIN173 partial-no-cof capture.
const bars = [[1584144000000, 177.46, 180.4, 170.47, 178.44], [1584158400000, 178.4, 179.55, 171.71, 175.2], [1584172800000, 175.2, 176.29, 163.94, 172.12], [1584187200000, 172.03, 172.24, 166.39, 169.41], [1584201600000, 169.35, 173.56, 168.21, 171.23], [1584216000000, 171.32, 172.16, 164.0, 167.2], [1584230400000, 167.08, 170.0, 165.44, 166.88], [1584244800000, 166.96, 172.3, 166.96, 169.21], [1584259200000, 169.22, 179.0, 167.75, 174.86], [1584273600000, 174.85, 179.81, 170.07, 172.71], [1584288000000, 172.71, 176.56, 171.28, 174.93], [1584302400000, 174.95, 190.69, 170.94, 178.2], [1584316800000, 178.2, 184.41, 174.4, 179.61], [1584331200000, 179.63, 179.95, 158.0, 159.31], [1584345600000, 159.16, 164.84, 147.14, 150.85], [1584360000000, 150.85, 174.0, 150.04, 172.56], [1584374400000, 172.52, 176.0, 165.37, 168.46], [1584388800000, 168.39, 172.77, 162.67, 172.41], [1584403200000, 172.45, 184.64, 168.73, 180.1], [1584417600000, 179.97, 186.78, 176.31, 182.17], [1584432000000, 182.17, 187.59, 177.13, 180.81], [1584446400000, 180.88, 184.37, 172.67, 183.31], [1584460800000, 183.53, 186.9, 181.97, 184.54]];
function provider() {
 return { configure() {}, getQtyStep() { return .0001; },
  async getMarketData() { return bars.map(([time,open,high,low,close])=>({openTime:time,closeTime:time+14_400_000-1,open,high,low,close,volume:1})); },
  async getSymbolInfo() { return {prefix:'BINANCE',ticker:'BCHUSDT',tickerid:'BINANCE:BCHUSDT',type:'crypto',currency:'USDT',basecurrency:'BCH',mintick:.1,pointvalue:1,mincontract:.0001,session:'24x7',timezone:'Etc/UTC'}; },
 };
}

it('VIN173 native one cash commission is allocated over both lots of one close order', async () => {
 const r = await new PineTS(provider() as any, 'BCHUSDT', '240').run(`//@version=5
strategy("Equity signal after partial-no-cof false", overlay=true, initial_capital=1000, pyramiding=3, calc_on_order_fills=false, process_orders_on_close=false, commission_type=strategy.commission.cash_per_order, commission_value=3, margin_long=0, margin_short=0)
strategy.risk.max_position_size(6)
varip bool reduced = false
varip bool sized = false
varip float signalEquity = na
varip float signalNet = na
varip float signalOpen = na
varip float requestedQty = na
if time == timestamp("UTC", 2020, 3, 15, 20, 0)
    strategy.entry("initial", strategy.long, qty=4)
if time == timestamp("UTC", 2020, 3, 16, 0, 0) and strategy.position_size > 0 and not reduced
    strategy.close("initial", qty=2)
    reduced := true
if strategy.closedtrades > 0 and not sized
    signalEquity := strategy.equity
    signalNet := strategy.netprofit
    signalOpen := strategy.openprofit
    requestedQty := math.floor(strategy.equity / 100)
    strategy.entry("sized-after-loss", strategy.long, qty=requestedQty)
    sized := true
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(signalEquity, "Signal equity")
plot(signalNet, "Signal net")
plot(signalOpen, "Signal open")
plot(requestedQty, "Requested qty")
`);
 expect(r.strategy!.closedtrades).toHaveLength(3);
 const expected = [[2,179.6,-1.7,4.5],[2,182.2,5.5,2.5],[4,182.2,87,5]];
 expected.forEach((v,i)=> {const t=r.strategy!.closedtrades[i]; [t.size,t.exit_price,t.profit,t.commission].forEach((x,j)=>expect(x).toBeCloseTo(v[j],9));});
 expect(r.strategy!.netprofit).toBeCloseTo(90.8,9);
 expect(r.plots['Signal equity'].data.at(-1)!.value).toBeCloseTo(959,9);
});

it('VIN173 keeps separate wildcard bracket commissions before FIFO allocation', async () => {
 const r=await new PineTS(provider() as any,'BCHUSDT','240').run(`//@version=5
strategy("Equity signal after partial-no-cof false", overlay=true, initial_capital=1000, pyramiding=3, calc_on_order_fills=false, process_orders_on_close=false, commission_type=strategy.commission.cash_per_order, commission_value=3, margin_long=0, margin_short=0)
strategy.risk.max_position_size(6)
varip bool reduced = false
varip bool sized = false
varip float signalEquity = na
varip float signalNet = na
varip float signalOpen = na
varip float requestedQty = na
if time == timestamp("UTC", 2020, 3, 15, 20, 0)
    strategy.entry("initial", strategy.long, qty=4)
if time == timestamp("UTC", 2020, 3, 16, 0, 0) and strategy.position_size > 0 and not reduced
    strategy.close("initial", qty=2)
    reduced := true
if strategy.closedtrades > 0 and not sized
    signalEquity := strategy.equity
    signalNet := strategy.netprofit
    signalOpen := strategy.openprofit
    requestedQty := math.floor(strategy.equity / 100)
    strategy.entry("sized-after-loss", strategy.long, qty=requestedQty)
    sized := true
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.exit("final", limit=close)
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")
plot(strategy.openprofit, "Open profit")
plot(signalEquity, "Signal equity")
plot(signalNet, "Signal net")
plot(signalOpen, "Signal open")
plot(requestedQty, "Requested qty")
`);
 expect(r.strategy!.closedtrades).toHaveLength(4);
 const expected=[[2,-1.7,4.5],[2,5,3],[2,43,3],[2,41.5,4.5]];
 expected.forEach((v,i)=>{const t=r.strategy!.closedtrades[i];[t.size,t.profit,t.commission].forEach((x,j)=>expect(x).toBeCloseTo(v[j],9));});
 expect(r.strategy!.netprofit).toBeCloseTo(87.8,9);
});
