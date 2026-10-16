// Famille : trail-armed-at-open — target 2280 (CME_MINI:ES1! 60). A trailing
// stop armed by the bar's OPEN (the open is already beyond trail_price) rides
// from that open: on a bar whose adverse extreme comes first, the stop is
// tested on the way there. TV 2280:
//   - bar 11225 (long): trail_price 6001.25, the weekend gap opens at 6006,
//     path open → 6005.5 low → 6011 high; offset 2 ticks → TV exits at 6005.5
//     (the engine took the peak at the high and exited at 6010.5);
//   - bar 14911 (short): trail_price 6289, the gap opens at 6274, path open →
//     6280.5 high → 6263 low; TV exits at 6274.25, not 6263.25.
import { describe, expect, it } from 'vitest';
import { PineTS } from 'index';

const HOUR = 3_600_000;
type Bar = { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };

function bars(ohlc: Array<[number, number, number, number]>): Bar[] {
    const start = Date.UTC(2024, 10, 22, 14);
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

async function run(data: Bar[], side: 'long' | 'short', trailPrice: number, offset: number) {
    const context = await new PineTS(provider(data) as any, 'CME_MINI:ES1!', '60').run(`
//@version=5
strategy('2280 trail armed at open', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('E', strategy.${side})
strategy.exit('TP', from_entry='E', trail_price=${trailPrice}, trail_offset=${offset})`);
    const strategy = context.strategy;
    if (!strategy) throw new Error('strategy state was not initialized');
    return strategy;
}

describe('2280 — trailing stop armed at the open', () => {
    it('long: rides from the gap open through the low first (bar 11225)', async () => {
        const strategy = await run(bars([
            [5965.25, 5993.25, 5963, 5991.25],
            [5990.75, 5992, 5962.75, 5989.5], // long fills at 5990.75
            [6006, 6011, 6005.5, 6008.75], // gap open above trail_price 6001.25
        ]), 'long', 6001.25, 2.0034);

        expect(strategy.closedtrades).toHaveLength(1);
        expect([strategy.closedtrades[0].exit_bar_index, strategy.closedtrades[0].exit_price]).toEqual([2, 6005.5]);
    });

    it('short: rides from the gap open through the high first (bar 14911)', async () => {
        const strategy = await run(bars([
            [6307.5, 6311.25, 6295, 6299],
            [6299.25, 6300, 6293.25, 6294], // short fills at 6299.25
            [6274, 6280.5, 6263, 6278.5], // gap open below trail_price 6289
        ]), 'short', 6289, 1.9968);

        expect(strategy.closedtrades).toHaveLength(1);
        expect([strategy.closedtrades[0].exit_bar_index, strategy.closedtrades[0].exit_price]).toEqual([2, 6274.25]);
    });

    it('keeps the favorable-extreme peak when the trail arms inside the bar', async () => {
        // Armed on the way up (open 5995 below trail_price 6001.25), the
        // adverse low comes first and cannot use the open as peak.
        const strategy = await run(bars([
            [5965.25, 5993.25, 5963, 5991.25],
            [5990.75, 5992, 5962.75, 5989.5],
            [5995, 6011, 5994, 6010.75],
        ]), 'long', 6001.25, 2.0034);

        expect(strategy.closedtrades).toHaveLength(0);
        expect(strategy.opentrades).toHaveLength(1);
    });

    for (const [order, entryPrice] of [['stop=105', 105], ['limit=98', 98]] as const) {
        it(`does not ride from the open for a position entered later in the bar (review repro, ${order})`, async () => {
            // The trail is armed by the 100 open (trail_price 99), but the
            // long only fills on the bar's path: the 96 low cannot trigger a
            // stop ridden from the open. Peak 106, 3-point offset → stop 103,
            // touched on the next bar.
            const data = bars([
                [100, 101, 99, 100],
                [100, 106, 96, 104],
                [104, 105, 103, 104],
            ]);
            const context = await new PineTS(provider(data) as any, 'CME_MINI:ES1!', '60').run(`
//@version=5
strategy('2280 trail armed at open, mid-bar entry', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, ${order})
strategy.exit('X', from_entry='L', trail_price=99, trail_offset=12)`);
            const strategy = context.strategy;
            if (!strategy) throw new Error('strategy state was not initialized');

            expect(strategy.closedtrades).toHaveLength(1);
            expect([strategy.closedtrades[0].entry_bar_index, strategy.closedtrades[0].entry_price]).toEqual([1, entryPrice]);
            expect([strategy.closedtrades[0].exit_bar_index, strategy.closedtrades[0].exit_price]).toEqual([2, 103]);
        });
    }
});
