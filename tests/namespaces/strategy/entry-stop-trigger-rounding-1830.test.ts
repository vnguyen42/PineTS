// Famille : entry-stop-trigger-rounding — target 1830 (CME:6E1! 60, tick
// 0.00005, Bollinger stop entries). A strategy.entry stop level rounds in its
// trigger direction: buy stop up, sell stop down. Rounding away from the
// signal close agrees only while the stop lies beyond the close; 1830 places
// stops a fraction of a tick on the wrong side of it:
//   - bar 7133: buy stop 1.0887143 under the 1.08875 close → TV keeps a stop at
//     1.08875 and fills it on bar 7134 (open 1.0887, high 1.0891) at 1.08875;
//     the engine rounded it down to 1.0887, called it marketable and filled at
//     the 1.0887 open;
//   - bar 14298: sell stop 1.1433226 above the 1.1433 close → TV fills at 1.1433
//     on bar 14299 (open 1.1434), not at the open.
import { describe, expect, it } from 'vitest';
import { PineTS } from 'index';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { initializeStrategy } from '../../../src/namespaces/strategy/utils';

const HOUR = 3_600_000;
type Bar = { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };

function bars(ohlc: Array<[number, number, number, number]>): Bar[] {
    const start = Date.UTC(2024, 2, 14, 16);
    return ohlc.map(([open, high, low, close], i) => ({ openTime: start + i * HOUR, closeTime: start + (i + 1) * HOUR, open, high, low, close, volume: 1 }));
}

function provider(data: Bar[]) {
    return {
        configure() {},
        async getMarketData() {
            return data.map((bar) => ({ ...bar }));
        },
        async getSymbolInfo(ticker: string) {
            return { ticker, tickerid: ticker, prefix: 'CME', type: 'futures', session: '24x7', timezone: 'America/Chicago', currency: 'USD', mintick: 0.00005, pricescale: 100000, minmove: 5, pointvalue: 125000 };
        },
    };
}

async function fillOf(data: Bar[], side: 'long' | 'short', stop: number) {
    const context = await new PineTS(provider(data) as any, 'CME:6E1!', '60').run(`
//@version=5
strategy('1830 stop rounding', default_qty_value=1)
if bar_index == 1
    strategy.entry('E', strategy.${side}, stop=${stop})`);
    const strategy = context.strategy;
    if (!strategy) throw new Error('strategy state was not initialized');
    expect(strategy.opentrades).toHaveLength(1);
    return [strategy.opentrades[0].entry_bar_index, strategy.opentrades[0].entry_price];
}

function contextWithMintick(mintick: number, close: number) {
    const context = new Context({ marketData: [], source: [], tickerId: 'CME:6E1!', timeframe: '60' });
    context.pine.syminfo = { type: 'futures', mintick, pointvalue: 1 };
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
    context.idx = 0;
    context.data.open = new Series([close]);
    context.data.high = new Series([close]);
    context.data.low = new Series([close]);
    context.data.close = new Series([close]);
    context.data.openTime = new Series([0]);
    return context;
}

function placedStop(mintick: number, close: number, side: 'long' | 'short', stop: number): number | undefined {
    const context = contextWithMintick(mintick, close);
    entry(context)('E', side, { stop });
    return context.strategy!.pending_orders[0]?.stop;
}

describe('1830 — entry stop rounded in its trigger direction', () => {
    it('buy stop a fraction under the close fills at the rounded-up level (bar 7134)', async () => {
        const [bar, price] = await fillOf(bars([
            [1.08885, 1.08935, 1.08855, 1.08875],
            [1.08875, 1.089, 1.08815, 1.08875], // signal: stop 1.0887143
            [1.0887, 1.0891, 1.0885, 1.0886],
        ]), 'long', 1.0887143);
        expect(bar).toBe(2);
        expect(price).toBeCloseTo(1.08875, 10);
    });

    it('sell stop a fraction above the close fills at the rounded-down level (bar 14299)', async () => {
        const [bar, price] = await fillOf(bars([
            [1.1434, 1.1438, 1.1423, 1.143],
            [1.1431, 1.14475, 1.14295, 1.1433], // signal: stop 1.1433226
            [1.1434, 1.1438, 1.14235, 1.1425],
        ]), 'short', 1.1433226);
        expect(bar).toBe(2);
        expect(price).toBeCloseTo(1.1433, 10);
    });

    it('keeps the canonical rounding cases', () => {
        // (1) on the grid: unchanged, float noise absorbed.
        expect(placedStop(0.01, 1, 'long', 0.07)).toBe(0.07);
        expect(placedStop(0.01, 1, 'short', 7.000000000000001)).toBe(7);
        // (2) a real fraction rounds in the trigger direction.
        expect(placedStop(0.01, 0.05, 'long', 0.073)).toBeCloseTo(0.08, 12);
        expect(placedStop(0.01, 0.09, 'short', 0.073)).toBeCloseTo(0.07, 12);
        // (3) upstream subtraction noise is absorbed.
        expect(placedStop(0.01, 0.5, 'long', 0.1 - 9 * 0.01)).toBeCloseTo(0.01, 12);
        // (4) a sub-noise fraction is preserved (buy stop: next tick up).
        expect(placedStop(1, 0, 'long', 5e-10)).toBe(1);
        // A stop beyond the close rounds as before (1565 NYSE:BE short stop 21.619 → 21.61).
        expect(placedStop(0.01, 22.84, 'short', 21.619)).toBe(21.61);
    });
});
