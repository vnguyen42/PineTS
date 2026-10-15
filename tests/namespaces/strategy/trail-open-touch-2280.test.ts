// Famille : trail-open-touch — target 2280 (CME_MINI:ES1! 60). An armed
// trailing stop whose level equals the next bar's open executes at that open.
// TV 2280 trade 1821: trail_price 4160.25 armed on bar 1823 (high 4160.5),
// offset 1.9998 ticks (whole 1) → stop 4160.25; bar 1824 opens at 4160.25 and
// TV exits there. The engine required the open strictly beyond the stop and
// exited at 4161.5 later in the bar.
import { describe, expect, it } from 'vitest';
import { PineTS } from 'index';

const HOUR = 3_600_000;
type Bar = { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };

function bars(ohlc: Array<[number, number, number, number]>): Bar[] {
    const start = Date.UTC(2023, 3, 24, 16);
    return ohlc.map(([open, high, low, close], i) => ({ openTime: start + i * HOUR, closeTime: start + (i + 1) * HOUR, open, high, low, close, volume: 1 }));
}

function provider(data: Bar[]) {
    return {
        configure() {},
        async getMarketData() {
            return data.map((bar) => ({ ...bar }));
        },
        async getSymbolInfo(ticker: string) {
            return { ticker, tickerid: ticker, prefix: 'CME_MINI', type: 'futures', session: '24x7', timezone: 'America/Chicago', currency: 'USD', mintick: 0.25, pricescale: 4, minmove: 1, pointvalue: 50 };
        },
    };
}

describe('2280 — trailing stop touched by the open', () => {
    it('exits at the open that equals the armed stop (bar 1824)', async () => {
        const data = bars([
            [4142, 4150.75, 4139, 4150.25], // signal (2280 bar 1820)
            [4150.25, 4156.25, 4147, 4155.25], // long fills at 4150.25
            [4155.25, 4157.5, 4150.25, 4154.25],
            [4154.25, 4160.5, 4154.25, 4160.5], // trail armed, peak 4160.5
            [4160.25, 4161.75, 4156.5, 4157.5], // open 4160.25 = stop
        ]);
        const context = await new PineTS(provider(data) as any, 'CME_MINI:ES1!', '60').run(`
//@version=5
strategy('2280 trail open touch', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('Long', strategy.long)
strategy.exit('TP', from_entry='Long', trail_price=4160.25, trail_offset=bar_index >= 3 ? 1.9998 : 2.0048)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_bar_index).toBe(4);
        expect(strategy.closedtrades[0].exit_price).toBe(4160.25);
    });
});
