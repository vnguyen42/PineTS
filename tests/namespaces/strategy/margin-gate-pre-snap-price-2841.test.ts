import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { Series } from '../../../src/Series';

// Mechanism: margin-gate-pre-snap-price (revealing id 2841).
// The 81fcb5c mintick snap of crypto market fills ran BEFORE the pre-trade
// margin gate, so a fill whose raw price passed the gate flipped to a
// rejection once rounded to the record tick. TV admits those entries and
// trims the sub-tick excess with a margin call; the engine must evaluate
// the required margin at the PRE-SNAP execution price while still booking
// the SNAPPED fill price.
//
// Faithful to the 2841 archive: close 9.1256, mintick 0.001 (snap 9.126),
// 100 % margin, qty = equity / close (10.958183 = trunc6 of 100 / 9.1256):
// requiredMargin raw = 99.99999478… ≤ 100 passes, snapped = 100.00437805…
// > 100 would cancel — the overshoot is sub-tick (0.0044 < qty × 0.001).

const EQUITY = 100;
const RAW_CLOSE = 9.1256;
const SNAPPED_CLOSE = 9.126;
const MINTICK = 0.001;
// The engine truncates explicit quantities to six decimals.
const QTY = Math.floor((EQUITY / RAW_CLOSE) * 1e6) / 1e6;

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

describe('margin-gate-pre-snap-price (2841)', () => {
    it('admits a crypto market order whose SNAPPED price exceeds equity by less than a tick, booking the snapped price', () => {
        // The setup mirrors the archived 2841 rejections: raw fill 9.1256
        // passes the 100 % margin gate (required 99.99999… ≤ 100) while the
        // snapped record price 9.126 would reject it (required 100.00438…).
        expect((QTY * RAW_CLOSE * 100) / 100).toBeLessThanOrEqual(EQUITY);
        expect((QTY * SNAPPED_CLOSE * 100) / 100).toBeGreaterThan(EQUITY);

        const context = makeContext();
        entry(context)('M', 'long', QTY);
        setBar(context, 1, RAW_CLOSE, RAW_CLOSE, RAW_CLOSE, RAW_CLOSE);

        const fills = processStrategyOrders(context);

        expect(fills).toBe(1);
        const trade = context.strategy.opentrades[0];
        expect(trade.size).toBe(QTY);
        // Booked price stays snapped (81fcb5c gains intact).
        expect(trade.entry_price).toBe(SNAPPED_CLOSE);
        expect(context.strategy.position_size).toBe(QTY);
        expect(context.strategy.pending_orders.length).toBe(0);
    });

    it('admits the same sub-tick overshoot on the process_orders_on_close path (the 2841 fill surface)', () => {
        // 2841 is a process_orders_on_close witness: the current-bar market
        // entry fills at the bar close (raw 9.1256) and the snap would have
        // rejected it through the same gate.
        const context = makeContext({ process_orders_on_close: true });
        setBar(context, 1, RAW_CLOSE, RAW_CLOSE, RAW_CLOSE, RAW_CLOSE);
        entry(context)('M', 'long', QTY);

        const fills = processStrategyOrders(context, 'close');

        expect(fills).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(SNAPPED_CLOSE);
        expect(context.strategy.opentrades[0].size).toBe(QTY);
    });

    it('still rejects a genuinely out-of-budget entry (pre-snap price cannot cover the margin)', () => {
        // qty 11 requires 100.3816… at the PRE-SNAP price 9.1256 — a real
        // deficit, not a rounding artifact: the guard must keep rejecting.
        const context = makeContext();
        entry(context)('M', 'long', 11);
        setBar(context, 1, RAW_CLOSE, RAW_CLOSE, RAW_CLOSE, RAW_CLOSE);

        const fills = processStrategyOrders(context);

        expect(fills).toBe(0);
        expect(context.strategy.opentrades.length).toBe(0);
        expect(context.strategy.closedtrades.length).toBe(0);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.pending_orders.length).toBe(0); // cancelled, not left pending
    });

    it('keeps the margin 0 path free of any rejection (v5 default: no margin requirement)', () => {
        // Regression guard: the pre-snap change must not resurrect rejections
        // for margin_long/margin_short = 0 — TV never checks funds there.
        const context = makeContext({ margin_long: 0, margin_short: 0 });
        entry(context)('M', 'long', QTY);
        setBar(context, 1, RAW_CLOSE, RAW_CLOSE, RAW_CLOSE, RAW_CLOSE);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(SNAPPED_CLOSE);
    });
});