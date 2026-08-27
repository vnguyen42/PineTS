// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

/**
 * Same-ID pending entry coalescing — TV rule proven on the 2444 ledger
 * (SAME_ID_PENDING_ENTRY_OVERTRADE, oracle-archives/tv-vin95-b/2444).
 *
 * TV keeps AT MOST ONE pending entry order per ID. Re-calling
 * `strategy.entry(id, …)` while a pending entry with that id exists MODIFIES
 * the pending order in place — whatever the pyramiding setting, the position
 * state, or the price definition. A direction flip cancels the old order and
 * places a brand-new one (VIN-75, unchanged).
 *
 * 2444 (AAVEUSDT/60, pyramiding=5): five same-ID stop submissions b285–b289
 * while flat were coalesced by TV into the last level instead of stacking;
 * the old engine behavior (VIN-75 coexistence hypothesis: flat + free
 * pyramiding slot + changed level → stack another pending) booked four stale
 * fills at b296 that TV never made, then skipped the real q2 lot at b333.
 * These tests replay the same shape on synthetic bars: they must fail on the
 * pre-fix engine (worktree 4ca51c3) and pass with the coalescing rule.
 */

const mintick = 0.01;

class SameIdProvider {
    constructor(private readonly candles: any[]) {}
    configure() {}
    async getMarketData() {
        return this.candles;
    }
    async getSymbolInfo() {
        return {
            ticker: 'AAVEUSDT', tickerid: 'TEST:AAVEUSDT', main_tickerid: 'TEST:AAVEUSDT',
            prefix: 'TEST', root: 'AAVE', description: 'AAVE / USDT', type: 'crypto',
            basecurrency: 'AAVE', currency: 'USDT', timezone: 'Etc/UTC',
            mintick, pricescale: 100, minmove: 1, pointvalue: 1, mincontract: 0.00001,
            session: '24x7', volumetype: 'base',
        };
    }
}

function candle(open: number, high: number, low: number, close: number, bar: number) {
    return {
        openTime: bar * 86_400_000, open, high, low, close, volume: 1000,
        closeTime: bar * 86_400_000 + 86_399_999,
    };
}

// Bars 0–7 submit one same-ID long stop per bar (flat, pyramiding=5 — free
// slots at the first submissions). Bar 8 crosses ALL stale levels: a stacking
// engine books five fills, the coalescing engine books only the last
// submitted level. Bar 9 re-enters with qty = position_size + 1 (the 2444
// sizing idiom), bar 10 crosses it.
const CANDLES = [
    candle(100, 100.5, 99.5, 100, 0),
    candle(100, 100.8, 99.6, 100.4, 1),
    candle(100.4, 100.9, 99.8, 100.2, 2),
    candle(100.2, 101, 99.7, 100.6, 3),
    candle(100.6, 101.2, 100, 100.5, 4),
    candle(100.5, 101, 99.9, 100.3, 5),
    candle(100.3, 101.5, 100, 100.8, 6),
    candle(100.8, 102, 100.2, 100.9, 7),
    candle(100.9, 106, 100.3, 103, 8),     // crosses 105.46 / 105.24 / 105.17 / 105.08 / 104.90 / 104.52
    candle(103, 103.4, 102.4, 102.6, 9),   // position_size == 1 → qty-2 submission
    candle(102.6, 103.6, 102.1, 103.1, 10), // crosses the second stop
    candle(103.1, 103.5, 102.7, 103, 11),
];

const SOURCE = `
//@version=5
strategy('same-id coalesce 2444 shape', pyramiding=5, default_qty_type=strategy.fixed, default_qty_value=1)
levels = array.from(105.46, 105.24, 105.17, 105.08, 104.90, 104.82, 104.76, 104.52)
if bar_index < 8
    strategy.entry('L', strategy.long, 1, stop = levels.get(bar_index))
if bar_index == 9 and strategy.position_size == 1
    strategy.entry('L', strategy.long, 2, stop = 103.2)
if bar_index == 10 and strategy.position_size == 3
    strategy.exit('X', 'L', limit = 104)`;

// The same script truncated to the first phase: only the eight submissions.
const SOURCE_LEG1 = SOURCE.replace(
    "if bar_index == 9 and strategy.position_size == 1\n    strategy.entry('L', strategy.long, 2, stop = 103.2)\nif bar_index == 10 and strategy.position_size == 3\n    strategy.exit('X', 'L', limit = 104)",
    '',
);

describe('strategy same-ID pending entry coalescing (2121/2444 family)', () => {
    it('coalesces repeated same-ID stops into the LAST submission while flat with free pyramiding slots (2444 b285-b296 shape)', async () => {
        const engine = new PineTS(new SameIdProvider(CANDLES.slice(0, 9)) as any, 'AAVEUSDT', 'D');
        const context = await engine.run(SOURCE_LEG1);
        const strategy = context.strategy as any;

        // Exactly ONE fill from the eight submissions — the last level 104.52,
        // never the four stale 105.x stops (TV: fill b293 @104.52, no fills at
        // b296; the pre-fix engine booked 4 extra fills there).
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_price).toBe(104.52);
        expect(strategy.opentrades[0].size).toBe(1);
        expect(strategy.opentrades[0].entry_bar_index).toBe(8);
    });

    it('sizes the re-entry from the coalesced position (qty = position_size + 1 fills q2 — 2444 b333 shape)', async () => {
        const engine = new PineTS(new SameIdProvider(CANDLES) as any, 'AAVEUSDT', 'D');
        const context = await engine.run(SOURCE);
        const strategy = context.strategy as any;

        // Position 1 after the coalesced fill → the bar-9 call re-submits the
        // SAME id with qty 2; the bar-10 crossing fills it at 103.2. The exit
        // bracket then covers both lots (limit 104).
        expect(strategy.position_size).toBe(3);
        expect(strategy.opentrades).toHaveLength(2);
        expect(strategy.opentrades[1].entry_price).toBe(103.2);
        expect(strategy.opentrades[1].size).toBe(2);
        expect(strategy.closedtrades).toHaveLength(0);
    });

    it('keeps a single live pending order per ID across a bar-by-bar resubmission cycle (queue position preserved)', async () => {
        const source = `
//@version=5
strategy('same-id single pending', pyramiding=3, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index < 3
    strategy.entry('E', strategy.long, 1, limit = 98 - bar_index)`;

        const engine = new PineTS(new SameIdProvider(CANDLES.slice(0, 4)) as any, 'AAVEUSDT', 'D');
        const context = await engine.run(source);
        const strategy = context.strategy as any;

        expect(strategy.pending_orders).toHaveLength(1);
        expect(strategy.pending_orders[0]).toMatchObject({ id: 'E', limit: 96, bar: 2 });
    });
});