import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, openTrade, processExitOrders } from '../../../src/namespaces/strategy/utils';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { Series } from '../../../src/Series';

/**
 * VIN-1763a — "touch exact" (binary noise) on the conditional-exit broker
 * path.
 *
 * Oracle: oracle-archives/tv-vin141/captures/1763 (spec §4, row 1). TV
 * fills a stop when a bar's high/low REACHES the level to within binary
 * representation noise (TV operates on displayed prices — VIN-136). The
 * engine missed such touches by ~1e-16 and filled one or two bars later:
 * SHORT b657 @1.07248, stop 1.07448 ; bar 672 high = 1.0744799999999999
 * (noise below 1.07448) → TV fills the stop at 1.07448 on bar 672, the
 * engine waited for bar 674.
 *
 * The predicate under test is the single centralized tolerance
 * (magnitude-relative 1e-12×max(1,|level|), never a fixed EPS / ULP) used
 * ONLY for the touch test: the fill price stays at the literal level, and
 * ranking / order inversion never see the tolerance. The canonical four
 * rounding cases (HARNESS) are covered by the pre-existing
 * round-to-mintick / trailing-parity tests and must stay green.
 *
 * Familles défendues par ce fichier (identification passe A_VERIFIER) :
 * - touch exact isLevelTouched (1763a) — tolérance bruit binaire 1e-12×max(1,|level|)
 *   centralisée dans isLevelTouched ; prix de fill = niveau littéral (fork 8c6a0bc)
 * - PARTIAL_BRACKET_RESERVATION_SAME_TICK (1763) — 2 réservations q500 à égalité de tick
 *   jamais agrégées en q1000 (b1184/b6286 ; le variant b8181 2-prix reste ouvert, non asserté)
 */
function makeContext(mintick: number) {
    const context: any = new Context({
        marketData: [],
        source: [],
        tickerId: 'FX:EURUSD',
        timeframe: '60',
    } as any);
    context.idx = 0;
    context.data.open = new Series([1.07]);
    context.data.high = new Series([1.07]);
    context.data.low = new Series([1.07]);
    context.data.close = new Series([1.07]);
    context.data.openTime = new Series([0]);
    context.pine = { syminfo: { mintick, pointvalue: 1 } } as any;
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
    return context;
}

function setBar(context: any, idx: number, open: number, high: number, low: number, close: number, openTime = idx * 3_600_000) {
    context.idx = idx;
    context.data.open = new Series([open, open]);
    context.data.high = new Series([high, high]);
    context.data.low = new Series([low, low]);
    context.data.close = new Series([close, close]);
    context.data.openTime = new Series([openTime, openTime]);
}

describe('Strategy — 1763 touch exact (binary noise)', () => {
    it('fills the 1763 short stop on the same bar when the high is 1e-16 below the level, at the literal level', () => {
        // 1763 SHORT b657 @1.07248, SL1 = EP + 200×mintick = 1.07448.
        // Bar 672 (2023-02-09 06:00): open 1.07356, high
        // 1.0744799999999999 (binary noise), low 1.07334, close 1.07397.
        // TV fills 2×500 @1.07448 on bar 672; the engine used to wait for
        // bar 674 (high 1.07594).
        const context = makeContext(0.00001);
        setBar(context, 0, 1.07248, 1.07248, 1.07248, 1.07248);
        openTrade(context, 'sell', -1, 1000, 1.07248, 0);
        exit(context)('exit3', 'sell', { stop: 1.07448, qty_percent: 50 });
        exit(context)('exit4', 'sell', { stop: 1.07448 });

        setBar(context, 1, 1.07356, 1.0744799999999999, 1.07334, 1.07397, 1675922400000);
        expect(processExitOrders(context, 'intrabar')).toBe(2);

        // Two separate reservations (order ID / activation segment kept
        // apart): 500 + 500 at the literal level, same bar — not merged.
        expect(context.strategy.closedtrades).toHaveLength(2);
        expect(context.strategy.closedtrades[0].size).toBe(-500);
        expect(context.strategy.closedtrades[1].size).toBe(-500);
        expect(context.strategy.closedtrades[0].exit_price).toBe(1.07448);
        expect(context.strategy.closedtrades[1].exit_price).toBe(1.07448);
        expect(context.strategy.position_size).toBe(0);
    });
    it('keeps sibling reservations separate when the full bracket fills before the 50% bracket', () => {
        // The 1596 EURJPY pattern queues these two siblings on the same
        // evaluation: the partial bracket reserves 50%, while its uncapped
        // sibling must receive only the remaining 50%. The full bracket
        // reaches its stop first; the partial bracket must remain live for
        // the later take-profit.
        const context = makeContext(0.01);
        setBar(context, 0, 1, 1, 1, 1);
        openTrade(context, 'sell', -1, 1000, 1, 0);
        exit(context)('partial', 'sell', { qty_percent: 50, profit: 10 });
        exit(context)('full', 'sell', { stop: 1.1 });
        // Transpiled strategy.exit calls can leave the newest sibling first
        // in the pending queue; reservation order must still follow callsite
        // order (partial before full), as it does in the EURJPY replay.
        context.strategy.pending_orders.reverse();

        setBar(context, 1, 1.05, 1.1, 1.02, 1.08, 3_600_000);
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0].size).toBe(-500);
        expect(context.strategy.closedtrades[0].exit_price).toBe(1.1);
        expect(context.strategy.pending_orders.filter((order: { category?: string }) => order.category === 'exit')).toHaveLength(1);
        expect(context.strategy.position_size).toBe(-500);

        setBar(context, 2, 0.95, 0.98, 0.9, 0.93, 7_200_000);
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.closedtrades).toHaveLength(2);
        expect(context.strategy.closedtrades[1].size).toBe(-500);
        expect(context.strategy.closedtrades[1].exit_price).toBe(0.9);
        expect(context.strategy.position_size).toBe(0);
    });


    it('keeps the exit pending when the high is genuinely below the stop (beyond the noise tolerance)', () => {
        const context = makeContext(0.00001);
        setBar(context, 0, 1.07248, 1.07248, 1.07248, 1.07248);
        openTrade(context, 'sell', -1, 1000, 1.07248, 0);
        exit(context)('exit3', 'sell', { stop: 1.07448, qty_percent: 50 });
        exit(context)('exit4', 'sell', { stop: 1.07448 });

        // 2e-5 below the stop — an order of magnitude above the 1e-12
        // relative tolerance: no touch, whatever the representation noise.
        setBar(context, 1, 1.07356, 1.07446, 1.07334, 1.07397, 1675922400000);
        expect(processExitOrders(context, 'intrabar')).toBe(0);
        expect(context.strategy.closedtrades).toHaveLength(0);
        expect(context.strategy.pending_orders.filter((order: any) => order.category === 'exit')).toHaveLength(2);
    });

    it('touches a high-magnitude level (19000.5) within its relative tolerance and fills at the literal level', () => {
        // |19000.49999999999 − 19000.5| = 1.09e-11 < 1e-12×19000.5 = 1.9e-8
        // (magnitude-relative band — a fixed EPS would not scale here).
        const context = makeContext(0.01);
        setBar(context, 0, 19000, 19000, 19000, 19000);
        openTrade(context, 'sell', -1, 1, 19000, 0);
        context.strategy.pending_orders.push({
            id: 'sl', direction: 0, qty: 0, type: 'market', category: 'exit',
            from_entry: '', stop: 19000.5, status: 'pending', bar: 0, time: 0,
        });

        setBar(context, 1, 19000.2, 19000.49999999999, 19000.1, 19000.2, 3_600_000);
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0].exit_price).toBe(19000.5); // literal level, never a snapped value
    });
});