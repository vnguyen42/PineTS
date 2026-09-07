import { expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// VIN-165: original TradingView BCHUSDT 240 variable-percentage witness,
// captured 2026-09-07. A five-percent input closes .05, retaining .95.
const source = "//@version=5\nstrategy(\"Function close options witness\", initial_capital=10000, margin_long=0, margin_short=0, process_orders_on_close=true)\npercent = input.int(5)\ntake() =>\n    strategy.close(\"Long\", qty_percent=percent)\nif time == timestamp(\"UTC\", 2020, 3, 16, 0, 0)\n    strategy.entry(\"Long\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 16, 4, 0)\n    take()\nplot(strategy.position_size, \"Position\")\n\nif time == timestamp(\"UTC\", 2020, 3, 16, 8, 0)\n    strategy.close_all(\"remainder\")\n";
const candles = [[179.61, 178.2, 184.41, 174.4], [159.31, 179.63, 179.95, 158], [150.85, 159.16, 164.84, 147.14], [172.56,150.85,174,150.04]].map(([close,open,high,low],i)=>({
    openTime: Date.parse('2020-03-16T00:00:00Z')+i*14_400_000,
    closeTime: Date.parse('2020-03-16T00:00:00Z')+(i+1)*14_400_000-1,
    open,high,low,close,volume:1,
}));
it.each([true, false])('preserves input close percentage (wrapped=%s)', async (wrapped) => {
    const provider = { configure(){}, getQtyStep(){return .0001}, async getMarketData(){return candles}, async getSymbolInfo(){return {prefix:'BINANCE',ticker:'BCHUSDT',tickerid:'BINANCE:BCHUSDT',type:'crypto',currency:'USDT',mintick:.1,mincontract:.0001,pointvalue:1,timezone:'Etc/UTC',session:'24x7'};} };
    const result = await new PineTS(provider as any, 'BCHUSDT', '240').run(wrapped ? source : source.replace('    take()', '    strategy.close("Long", qty_percent=percent)'));
    expect(result.strategy!.closedtrades.map(t=>t.size)).toEqual([.05,.95]);
    expect(result.strategy!.closedtrades.map(t=>t.exit_price)).toEqual([159.3,150.8]);
    expect(result.strategy!.opentrades).toHaveLength(0);
});
