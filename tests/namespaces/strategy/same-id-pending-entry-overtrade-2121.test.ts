// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Context } from '../../../src/context';
import { Order } from '../../../src/namespaces/strategy/types';

/**
 * Same-ID pending entry OVERTRADE on contiguous same-id calls — TV rule
 * proven on the 2121 ledger (VIN-135, SAME_ID_PENDING_ENTRY_OVERTRADE,
 * NASDAQ:MARA/60, oracle-archives/tv-vin95/captures/2121).
 *
 * 2121 (three supertrend blocks, all reusing the ids "LONG"/"SHORT",
 * pyramiding=1): at b39 close both ST1 and ST2 flip LONG. The FIRST call
 * sees position −15 and submits a REVERSAL order of qty 30; the SECOND
 * same-id call REPLACES the pending order, and TV recomputes its quantity
 * against the position PROJECTED forward by the order it replaces
 * (−15 + 30 = +15, same side) — so the replacement is a plain qty-15 order.
 * At the next open it fills CLOSE-ONLY against the −15 position: the short
 * is flattened and NO long chunk is ever opened. The engine's old
 * replacement kept the first call's qty 30, booked a phantom +15 lot
 * (the 611 extras of 2121) and — via that phantom position — rejected the
 * next same-side entry through the pyramiding cap (the 186 TV-missing
 * trades, e.g. the TV LONG b431→432 at 37.44).
 *
 * This test replays the shape on synthetic flat bars: call A opens +15,
 * call B reverses to −15, the b2 double-call re-submits id "L" while the
 * reversal order is pending, call C goes short again. TV's ledger has NO
 * long trade between the two shorts and the second short is a plain qty-15
 * order; the pre-fix engine books LONG b3→b4 (qty 30 pending, qty 30 fill).
 */

const mintick = 0.01;

class OvertradeProvider {
    constructor(private readonly candles: unknown[]) {}
    configure() {}
    async getMarketData() {
        return this.candles;
    }
    async getSymbolInfo() {
        return {
            ticker: 'MARA', tickerid: 'TEST:MARA', main_tickerid: 'TEST:MARA',
            prefix: 'TEST', root: 'MARA', description: 'MARA / USD', type: 'stock',
            basecurrency: 'USD', currency: 'USD', timezone: 'Etc/UTC',
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

// Flat O=C bars so every fill is at a bar open, none crosses a level.
//   b0: entry LONG (id "L")          → fills b1 open, pos +15
//   b1: entry SHORT (id "S")         → fills b2 open, pos −15 (reversal q30)
//   b2: TWO same-id LONG calls       → first: reversal q30 pending; second:
//                                     same-id replacement (TV: qty 15 — the
//                                     2121 b39 double call)
//   b3: pending LONG fills b3 open   → TV: close-only (no lot); engine
//                                     pre-fix: reversal lot +15; then:
//   b3: entry SHORT (id "S")         → TV: plain qty 15 (pos 0); pre-fix:
//                                     reversal qty 30 vs the phantom +15
//   b4: SHORT fills b4 open, pos −15 → the only SHORT lot of the episode
const CANDLES = [
    candle(100, 100, 100, 100, 0),
    candle(100, 100, 100, 100, 1),
    candle(100, 100, 100, 100, 2),
    candle(100, 100, 100, 100, 3),
    candle(100, 100, 100, 100, 4),
    candle(100, 100, 100, 100, 5),
];

const SOURCE = `
//@version=4
strategy('2121 overtrade shape', pyramiding=1, default_qty_value=15)
if bar_index == 0
    strategy.entry('L', strategy.long)
if bar_index == 1
    strategy.entry('S', strategy.short)
if bar_index == 2
    strategy.entry('L', strategy.long)
    strategy.entry('L', strategy.long)
if bar_index == 3
    strategy.entry('S', strategy.short)`;

type StrategyContext = Context & { strategy: NonNullable<Context['strategy']> };

function assertStrategy(context: Context): asserts context is StrategyContext {
    if (!context.strategy) throw new Error('strategy test context was not initialized');
}

describe('strategy same-ID pending entry overtrade on contiguous calls (2121 SAME_ID_PENDING_ENTRY_OVERTRADE)', () => {
    it('recomputes the same-ID replacement qty against the projected position — b39 double LONG shape (q30 → q15)', async () => {
        // Run only through bar 2: the double call's replacement order is
        // still pending at the end of b2 processing (it fills at b3 open).
        const engine = new PineTS(new OvertradeProvider(CANDLES.slice(0, 3)) as never, 'MARA', 'D');
        const context = await engine.run(SOURCE);
        assertStrategy(context);
        const strategy = context.strategy;

        const pendingLong = strategy.pending_orders
            .filter((order: Order) => order.status === 'pending' && order.id === 'L')
            .slice(-1)[0];
        expect(pendingLong).toBeDefined();
        // TV: the same-id replacement resubmits the PLAIN requested qty
        // (15) against the projected +15 — not the first call's qty 30.
        expect(pendingLong.qty).toBe(15);
    });

    it('books NO phantom long lot between the two shorts — the q15 close-only fill flattens without opening (2121 611-extras shape)', async () => {
        const engine = new PineTS(new OvertradeProvider(CANDLES) as never, 'MARA', 'D');
        const context = await engine.run(SOURCE);
        assertStrategy(context);
        const strategy = context.strategy;
        // The episode books TWO closed trades — the initial LONG (flattened
        // by the b2-open reversal SHORT) and the SHORT itself (flattened
        // close-only by the qty-15 LONG at b3 open) — plus one OPEN short
        // lot from b4. NEVER a lot entered at b3 (the phantom LONG the
        // pre-fix engine books via its qty-30 replacement/fill).
        expect(strategy.closedtrades).toHaveLength(2);
        expect(strategy.closedtrades.some((trade) => trade.entry_bar_index === 3)).toBe(false);
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_id).toBe('S');
        expect(strategy.opentrades[0].entry_bar_index).toBe(4);
        expect(strategy.position_size).toBe(-15);
    });
});