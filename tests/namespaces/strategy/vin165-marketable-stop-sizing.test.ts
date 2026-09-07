import { expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// VIN-165: original TradingView BCHUSDT 240 already-triggered stop witness,
// captured 2026-09-07: five percent of equity with .1% commission.
const source = "//@version=5\nstrategy(\"Already triggered stop sizing witness\", initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=5, margin_long=0, margin_short=0, commission_type=strategy.commission.percent, commission_value=0.1, process_orders_on_close=true)\nif time == timestamp(\"UTC\", 2020, 3, 16, 0, 0)\n    strategy.entry(\"Short\", strategy.short, stop=close*1.2)\nif time == timestamp(\"UTC\", 2020, 3, 16, 4, 0)\n    strategy.close_all(\"remainder\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\n";
const candles = [[179.61, 178.2, 184.41, 174.4], [159.31, 179.63, 179.95, 158], [150.85, 159.16, 164.84, 147.14], [172.56,150.85,174,150.04]].map(([close,open,high,low],i)=>({
    openTime: Date.parse('2020-03-16T00:00:00Z')+i*14_400_000,
    closeTime: Date.parse('2020-03-16T00:00:00Z')+(i+1)*14_400_000-1,
    open,high,low,close,volume:1,
}));
it.each([true, false])('VIN-165 sizes an already-triggered short stop using the market reference (POC=%s)', async (poc) => {
    const provider = { configure(){}, getQtyStep(){return .0001}, async getMarketData(){return candles}, async getSymbolInfo(){return {prefix:'BINANCE',ticker:'BCHUSDT',tickerid:'BINANCE:BCHUSDT',type:'crypto',currency:'USDT',mintick:.1,mincontract:.0001,pointvalue:1,timezone:'Etc/UTC',session:'24x7'};} };
    const result = await new PineTS(provider as any, 'BCHUSDT', '240').run(poc ? source : source.replace('process_orders_on_close=true', 'process_orders_on_close=false'));
    expect(result.strategy!.closedtrades).toHaveLength(1);
    expect(result.strategy!.closedtrades[0].size).toBeCloseTo(-2.7811,12);
    expect(result.strategy!.closedtrades[0].entry_price).toBe(179.6);
    expect(result.strategy!.closedtrades[0].exit_price).toBe(poc ? 159.3 : 159.2);
});
