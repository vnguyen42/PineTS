import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { Series } from '../../../src/Series';

// Mechanism: margin-gate-tolerance-1ulp (revealing id 2841).
//
// MEDIUM consigned by the L1 review of commit 6280977 (JOURNAL.md
// 2026-09-02): the pre-trade margin gate compared STRICTLY
// (`requiredMargin > availableEquity`), so at the frontier of the
// "percent_of_equity 100 % + margin 100 %" family ~4.5 % of draws were
// cancelled on a single rounding ulp: the float `requiredMargin` lands at
// nextUp(availableEquity) while the exact arithmetic is <= the equity.
// Result: legitimate entries silently vanish. A 200 000-draw probe pinned
// the ~4.5 % share.
//
// This test pins the magnitude-relative tolerance
// 1e-12 × max(1, |availableEquity|) — never a fixed EPS — with the four
// canonical cases of the branch:
//   1. exact frontier    (requiredMargin == availableEquity)  -> admitted
//   2. 1-ulp noise       (nextUp(availableEquity) from realistic float
//                         ops)                                 -> admitted
//   3. real exceed       (requiredMargin > equity + tolerance) -> rejected
//   4. margin 0 (v5 default, no gate) with NEGATIVE equity      -> admitted
//
// Case 2's witness arithmetic (parent 6280977 rejects it, the fix admits):
//   EQUITY 100, price 4882.8125, qty = trunc6(100 / price) = 0.02048 —
//   the same trunc6(equity / close) chain as the 2841 archive family.
//   Exact product: 0.02048 × 4882.8125 = 100 exactly (0.02048 = 2^11/10^5,
//   4882.8125 = 5^7/2^4). Float chain of computeRequiredMargin
//   ((qty × price × pointValue × marginPct) / 100, marginPct = 100):
//   100.00000000000001 = nextUp(100) -> strict `>` cancelled the entry.

const EQUITY = 100;
const PRICE = 4882.8125;
const MINTICK = 0.001;
// Same trunc6(equity / price) sizing path as the percent_of_equity family.
const QTY = Math.floor((EQUITY / PRICE) * 1e6) / 1e6;

function makeContext(config: Record<string, unknown> = {}) {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'BINANCE:BCHUSDT',
        timeframe: '240',
    });
    context.idx = 0;
    context.data.open = new Series([1]);
    context.data.high = new Series([1]);
    context.data.low = new Series([1]);
    context.data.close = new Series([1]);
    context.data.openTime = new Series([0]);
    context.pine = { syminfo: { mintick: MINTICK, pointvalue: 1, type: 'crypto' } };
    initializeStrategy(context, {
        default_qty_type: 'fixed',
        default_qty_value: 1,
        initial_capital: EQUITY,
        margin_long: 100,
        margin_short: 100,
        ...config,
    });
    return context;
}

function setBar(context: Context, idx: number, open: number, high = open, low = open, close = open) {
    context.idx = idx;
    context.data.open = new Series([open, open]);
    context.data.high = new Series([high, high]);
    context.data.low = new Series([low, low]);
    context.data.close = new Series([close, close]);
    context.data.openTime = new Series([idx * 86_400_000, idx * 86_400_000]);
}

describe('margin-gate-tolerance-1ulp (2841)', () => {
    it('admits an entry exactly ON the frontier (requiredMargin == availableEquity)', () => {
        // qty 1 @ price 100, 100 % margin: requiredMargin = 100 == equity.
        // The strict `>` comparison already admitted this case; the
        // tolerance must not disturb it.
        const context = makeContext();
        entry(context)('M', 'long', 1);
        setBar(context, 1, 100, 100, 100, 100);

        const fills = processStrategyOrders(context);

        expect(fills).toBe(1);
        expect(context.strategy.opentrades[0].size).toBe(1);
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.pending_orders.length).toBe(0);
    });

    it('absorbs a 1-ulp upstream rounding overshoot and admits the entry', () => {
        // The witness: QTY = trunc6(100 / 4882.8125) = 0.02048 with an exact
        // notional of exactly 100, but the float chain
        // (0.02048 × 4882.8125 × 1 × 100) / 100 evaluates to
        // 100.00000000000001 = nextUp(100) — strictly greater than equity on
        // the parent (6280977), which silently cancelled the entry. The
        // magnitude-relative tolerance 1e-12 × max(1, |equity|) = 1e-10
        // absorbs the single ulp (1.42e-14) while the exact arithmetic stays
        // within budget.
        expect(QTY).toBe(0.02048);
        expect((Math.abs(QTY) * PRICE * 1 * 100) / 100).toBeGreaterThan(EQUITY);
        expect((Math.abs(QTY) * PRICE * 1 * 100) / 100 - EQUITY).toBeLessThanOrEqual(
            Math.pow(2, Math.floor(Math.log2(EQUITY))) * Number.EPSILON,
        );

        const context = makeContext();
        entry(context)('M', 'long', QTY);
        setBar(context, 1, PRICE, PRICE, PRICE, PRICE);

        const fills = processStrategyOrders(context);

        expect(fills).toBe(1);
        const trade = context.strategy.opentrades[0];
        expect(trade.size).toBe(QTY);
        expect(context.strategy.position_size).toBe(QTY);
        expect(context.strategy.pending_orders.length).toBe(0);
    });

    it('still rejects a genuinely out-of-budget entry (requiredMargin well above equity + tolerance)', () => {
        // qty 1 @ price 200, 100 % margin: requiredMargin = 200 — twice the
        // equity, far beyond the 1e-10 tolerance. The real-deficit rejection
        // must be bit-identical to the strict comparison.
        const context = makeContext();
        entry(context)('M', 'long', 1);
        setBar(context, 1, 200, 200, 200, 200);

        const fills = processStrategyOrders(context);

        expect(fills).toBe(0);
        expect(context.strategy.opentrades.length).toBe(0);
        expect(context.strategy.closedtrades.length).toBe(0);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.pending_orders.length).toBe(0); // cancelled, not left pending
    });

    it('keeps the margin 0 path free of any rejection, even with negative equity', () => {
        // margin_long/margin_short = 0 (the v5 default): no margin
        // requirement — TV never rejects, whatever the account value. Build
        // a negative-equity account to prove the `marginPct > 0` guard (not
        // the comparison) is what keeps this path open.
        const context = makeContext({ margin_long: 0, margin_short: 0, initial_capital: -50 });
        expect(context.strategy.equity).toBe(-50);

        entry(context)('M', 'long', 5);
        setBar(context, 1, 10, 10, 10, 10);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].size).toBe(5);
    });
});