// VIN-158: immediate-close-without-POC, Studio R2.2 T1/T2 July 2026 windows.
// Oracle: ../research/engine-export/tv-verification.json and three window CSVs.
// Requires the real research candles and sources in the parent parity checkout.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PineTS } from '../../../src/PineTS.class';
const dir = path.resolve(process.cwd(), '../research/engine-export');
const candles = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).candles;
const symbolInfo = { ticker: 'BTCUSDT', tickerid: 'BINANCE:BTCUSDT', type: 'crypto', currency: 'USDT', basecurrency: 'BTC', timezone: 'Etc/UTC', mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1, mincontract: 0.00001, session: '24x7' };
const run = async (source: string, bars: any[]) => new PineTS({configure() {}, async getMarketData() {return bars;}, async getSymbolInfo() {return symbolInfo;}} as any, 'BTCUSDT', '60').run(source);
describe('immediate close without POC on real BTCUSDT candles', () => {
    for (const name of ['t1', 't2']) it(`closes Studio ${name} at the final permitted close with fees and slippage`, async () => {
        const source = fs.readFileSync(path.join(dir, `pinets-${name}.pine`), 'utf8')
            .replace('1785369600000', '1784073600000')
            .replace('input.bool(false, "Force flat', 'input.bool(true, "Force flat');
        const bars = candles.filter((c: any) => c.openTime < 1784073600000);
        const s = (await run(source, bars)).strategy!;
        expect(s.opentrades).toHaveLength(0);
        const last = s.closedtrades.at(-1)!;
        expect(last.exit_bar_index).toBe(bars.length - 1);
        expect(last.exit_price).toBeCloseTo(bars.at(-1).close - 0.01, 8);
        expect(last.commission).toBeCloseTo(last.size * (last.entry_price + last.exit_price!) * 0.001, 8);
        expect(s.pending_orders).toHaveLength(0);
    });
    it('does not advance another market entry or an ordinary close and does not recalculate', async () => {
        const bars = candles.slice(0, 8);
        const source = `//@version=6
strategy("Immediate mixed orders", initial_capital=10000, pyramiding=3, commission_type=strategy.commission.percent, commission_value=0.1, slippage=1, margin_long=100, calc_on_order_fills=false, process_orders_on_close=false, close_entries_rule="ANY")
var int evaluations = 0
evaluations += 1
if bar_index == 0
    strategy.entry("L", strategy.long, qty=0.01)
    strategy.entry("M", strategy.long, qty=0.01)
if bar_index == 2
    strategy.entry("P", strategy.long, qty=0.01)
    strategy.close("L", immediately=true)
    strategy.close("M")
plot(evaluations, "evaluations")`;
        const result = await run(source, bars), s = result.strategy!;
        const immediate = s.closedtrades.find(t => t.entry_id === 'L')!;
        const ordinary = s.closedtrades.find(t => t.entry_id === 'M')!;
        const pending = s.opentrades.find(t => t.entry_id === 'P')!;
        expect(immediate.exit_bar_index).toBe(2);
        expect(immediate.exit_price).toBeCloseTo(bars[2].close - 0.01, 8);
        expect(ordinary.exit_bar_index).toBe(3);
        expect(ordinary.exit_price).toBeCloseTo(bars[3].open - 0.01, 8);
        expect(pending.entry_bar_index).toBe(3);
        expect(pending.entry_price).toBeCloseTo(bars[3].open + 0.01, 8);
        expect(result.plots.evaluations.data.map((p: any) => p.value)).toEqual(bars.map((_: any, i: number) => i + 1));
    });
});
