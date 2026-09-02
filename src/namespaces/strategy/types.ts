// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Strategy configuration options.
 *
 * Field names mirror Pine's strategy() declaration parameters exactly
 * (snake_case, single-word where Pine uses one word). See
 * https://www.tradingview.com/pine-script-reference/v5/#fun_strategy
 */
export interface StrategyConfig {
    title: string;
    shorttitle?: string;
    overlay: boolean;
    format?: string;
    precision?: number;
    scale?: string;
    pyramiding?: number;
    calc_on_order_fills?: boolean;
    calc_on_every_tick?: boolean;
    max_bars_back?: number;
    backtest_fill_limits_assumption?: number;
    default_qty_type?: string;
    default_qty_value?: number;
    initial_capital?: number;
    currency?: string;
    slippage?: number;
    commission_type?: string;
    commission_value?: number;
    process_orders_on_close?: boolean;
    close_entries_rule?: string;
    margin_long?: number;
    margin_short?: number;
    explicit_plot_zorder?: boolean;
    max_lines_count?: number;
    max_labels_count?: number;
    max_boxes_count?: number;
    max_polylines_count?: number;
    calc_bars_count?: number;
    risk_free_rate?: number;
    use_bar_magnifier?: boolean;
    fill_orders_on_standard_ohlc?: boolean;
    dynamic_requests?: boolean;
    behind_chart?: boolean;
}

/**
 * A single trade — either currently open or already closed.
 *
 * Field names mirror Pine's per-trade getters from
 * strategy.closedtrades.*(idx) / strategy.opentrades.*(idx).
 *
 * `size` is SIGNED to match Pine: positive = long, negative = short.
 * The historical direction/qty pair has been collapsed into this single
 * field, matching what `strategy.closedtrades.size(idx)` returns.
 */
export interface Trade {
    id: string; // unique trade id (internal)
    entry_id: string; // id passed to strategy.entry()
    entry_price: number;
    entry_bar_index: number;
    entry_time: number;
    entry_comment?: string;
    exit_id?: string; // id passed to strategy.exit/close — set on close
    exit_price?: number;
    exit_bar_index?: number;
    exit_time?: number;
    exit_comment?: string;
    size: number; // SIGNED — positive long, negative short
    profit?: number; // realized P&L on close; undefined while open
    commission?: number; // commission charged on this trade
    max_drawdown?: number; // per-trade peak drawdown from entry
    max_runup?: number; // per-trade peak runup from entry
    status: 'open' | 'closed';
    /**
     * PHYSICAL entry price of this lot, immutable — used to compute
     * per-lot exit-bracket levels (strategy.exit profit/loss ticks).
     * Distinct from `entry_price`, which is the LEDGER value and can be
     * swapped by FIFO entry/exit pairing when a newer lot's bracket fills
     * before an older lot's (TV ledger convention).
     */
    _bracket_entry?: number;
    /** Logical bracket identity, decoupled from FIFO ledger ownership. */
    _activation_id?: string;
    _activation_entry_id?: string;
    _activation_bracket_entry?: number;
    _activation_entry_bar_index?: number;
    /** Position of this logical entry on its historical bar's assumed path. */
    _activation_entry_path_segment?: number;
    _activation_entry_path_distance?: number;
    /**
     * TV ledger convention (1519, FX:EURGBP — proven on 83 ledger groups):
     * a process_orders_on_close MARKET entry sized by the DEFAULT CASH
     * sizing that pyramids onto an open position is reported by TV as TWO
     * closed rows at the SAME entry bar/price — the excess of the ordered
     * quantity over the oldest open lot, then the oldest open lot's size.
     * The split is a CLOSE-TIME booking artifact: all 83 captured groups
     * close at identical exitTime/exitPrice, and while open TV shows one
     * logical row (strategy.opentrades counts signals, not parts). The
     * engine keeps ONE open row and emits the two closed rows on full
     * close. Captured at fill: excess = order.qty − oldestSameSideQty.
     */
    _tv_split_excess?: number;
    /**
     * Identity of the pyramiding RUN this split-add belongs to (monotone
     * strategy._tv_split_run_seq). Within a run, EVERY add is closed as
     * [E, qty − E] where E is the LAST add's excess (updated as adds fill —
     * TV re-splits the whole run retroactively, 1519 b3641+b3650 and
     * b5375+b5380). Undefined on non-split rows.
     */
    _tv_split_run_key?: number;
    _activation_segments?: Array<{
        qty: number;
        id: string;
        entryId: string;
        bracketEntry: number;
        entryBar: number;
        entryPathSegment?: number;
        entryPathDistance?: number;
    }>;
}

/**
 * A pending or filled order tracked internally by the engine.
 *
 * No Pine API exposes pending orders directly. Field names follow Pine's
 * `strategy.entry()` / `strategy.order()` parameter names where they map
 * (`limit`, `stop`, `oca_name`, `oca_type`), and snake_case for the rest.
 */
export interface Order {
    id: string;
    direction: number; // +1 long, -1 short
    qty: number; // unsigned
    type: 'market' | 'limit' | 'stop' | 'stop-limit';
    limit?: number; // matches strategy.entry(limit=...)
    stop?: number; // matches strategy.entry(stop=...)
    bar: number;
    time: number;
    oca_name?: string;
    oca_type?: 'cancel' | 'reduce' | 'none';
    comment?: string;
    fill_price?: number;
    fill_bar?: number;
    fill_time?: number;
    status: 'pending' | 'filled' | 'cancelled';

    // Distinguishes pending entries (market/limit/stop) from conditional
    // exit orders that ride on open positions. Defaults to 'entry' when
    // unset for backward-compat.
    category?: 'entry' | 'exit';

    // Internal transition marker: the stop leg activated on the preceding
    // broker-emulator tick, so the next tick evaluates the new limit order
    // from its current price rather than requiring another level crossing.
    _stop_limit_activated?: boolean;

    // Internal COF marker: a same-bar stop-limit gets one level-based
    // eligibility check on its first broker-emulator tick after placement or
    // refresh. Later ticks require a fresh crossing and cannot re-trigger it.
    _cof_stop_limit_evaluated?: boolean;

    // Internal marker (VIN-95): a pure stop order already beyond the signal
    // bar's close at submission (buy stop < close / sell stop > close) is a
    // triggered order. It keeps its LEVEL for sizing (VIN-89) but fills at
    // the next admissible open.
    _stop_marketable?: boolean;
    // Exit-specific fields (only set when category === 'exit').
    // strategy.exit() parameters: profit (TP in ticks), loss (SL in ticks),
    // limit/stop (price-based TP/SL), trail_price/trail_offset/trail_points
    // (trailing-stop trio), from_entry (which entries to attach to;
    // empty/"" or undefined means "all"), qty / qty_percent (partial close).
    profit?: number; // TP in ticks
    loss?: number; // SL in ticks
    trail_price?: number; // price level at which trailing arms
    trail_offset?: number; // offset in ticks the trail rides at
    trail_points?: number; // alternative trail-arm: entry_price + N ticks
    from_entry?: string; // entry id this exit attaches to ('' = all)
    qty_percent?: number; // percent of matching position to close
    // Internal: strategy.exit() received an explicit qty argument. This
    // remains true when qty-step quantization reduces that cap to zero, so
    // zero is not mistaken for an omitted (uncapped) qty. Such an order
    // remains pending inert with a zero reservation until normal cleanup.
    _explicit_qty_cap?: boolean;
    comment_profit?: string;
    comment_loss?: string;
    comment_trailing?: string;
    alert_message?: string;
    alert_profit?: string;
    alert_loss?: string;
    alert_trailing?: string;
    disable_alert?: boolean;
    immediately?: boolean; // strategy.close/close_all: fill at current bar's close
    // Internal: tracks the running peak used by trailing-stop logic.
    // For a long: highest high seen since the trail armed; for a short: lowest low.
    trail_peak?: number;
    trail_armed?: boolean;

    // Internal: set on `strategy.entry` orders that reverse the current
    // position (opposite direction with existing size). The deferred
    // close-margin-call gate uses it to preserve reversal entries while
    // cancelling stale same-direction adds.
    _isReversalEntry?: boolean;

    // Internal (VIN-110): sticky creation-time marker for a REVERSAL MARKET
    // entry emitted by a COF recalculation. It is evaluated against the
    // position at CREATION (before the same-tick market-exit drain flattens
    // it) and sticks to the order for the current tick: the engine's
    // same-tick drain fills marked orders at the triggering fill price.
    // Fresh/pyramiding entries and price-based orders never carry it — they
    // advance to the next OHLC point (1502 same-bar groups). At fill, the
    // order qty is re-derived against the CURRENT position (close what
    // remains, open the requested base size), so a close drained first in
    // the same tick cannot leave a stale close-qty in the open leg (TV
    // 1539: close 1, open 1 — not 2).
    _cof_reversal_same_tick?: boolean;

    // Internal (VIN-120): pass-scoped marker for a FRESH single-trade exit
    // bracket created by a COF fill recalculation — the new instance only,
    // never a refreshed one (an unfilled pending refresh returns before the
    // marker is stamped) and never a pyramided book (exactly one open trade,
    // entered on the current bar at the current assumed path point).
    // The same-tick drain admits this order in addition to pure market
    // exits, keeps its ephemeral wrong-sided leg (precisely marketable, not
    // stale) and gap-fills at the cofTickPrice when the level is already
    // crossed. A later pass — or a later bar — invalidates the marker and
    // restores the next-path semantics (the 2205 same-bar round-trips).
    _cof_fresh_single_trade_exit_pass?: number;

    // Internal: cadence-detection for strategy.exit. TV's broker
    // emulator uses Pine's lazy series-eval semantic for exit
    // parameters — the variable behind limit/stop is re-read each bar.
    // For a variable scoped INSIDE an if-block (sparse pattern), that
    // gives NA on non-trigger bars → TV doesn't fire stale captures.
    // For a variable in MAIN scope (persistent pattern, called every
    // bar), TV reads the captured value → fires stale captures.
    //
    // PT can't see the variable's scope from runtime, but call cadence
    // correlates with it. If the user called this exact exit callsite on the
    // prior bar, `_isPersistent = true`. processExitOrders uses the flag when
    // validating absolute exit legs.
    _isPersistent?: boolean;
    _callsiteId?: string;

    // Internal: strategy.exit() binds its conditional bracket to the
    // activation segments visible when the call is evaluated. This prevents
    // a reversal entry filled later from inheriting an order that was created
    // for the outgoing position. Pending entries are captured by entry ID
    // when no matching activation is open yet (the flat entry(); exit()
    // pattern), and also same-direction pending entries when an activation
    // is already open (pyramiding); explicit from_entry + pyramiding > 1
    // keeps the bound set to pending-only (no late-activation override).
    _exit_bound_activation_ids?: string[];
    _exit_bound_entry_ids?: string[];
    _exit_bound_direction?: -1 | 1;
    // Internal: distinguishes a refreshed broker order from a newly-created
    // instance with the same logical (id, from_entry) key.
    _exit_refreshed?: boolean;

    // Internal: snapshot of open trade IDs at the moment strategy.close_all()
    // or strategy.close(id) was called. TV binds `close_all` / `close(id)` to
    // the position state at CALL time; if those trades are closed by another
    // mechanism (e.g. a reversal entry filling on the next bar) before the
    // close order fires, TV silently drops the close. PineTS achieves the
    // same by filtering matching open trades against this snapshot at fill
    // time — if none of the originally-intended trades are still open, the
    // close order is cancelled.
    _intended_trade_ids?: string[];

    // Internal: key used to remember conditional-exit lifecycle state.
    // Activation identities suppress geometrically re-arming the same
    // bracket; consumed identities keep a partial FIFO lot from being
    // consumed twice by that lifecycle during COF refresh.
    _exit_lifecycle_key?: string;
    _excluded_activation_trade_ids?: string[];
    _excluded_consumed_trade_ids?: string[];

    // Internal: ordered base size (before the reversal close-qty addition).
    // executeOrder uses it to split a reversal OVERSHOOT into its own lot
    // when a deferred close-margin-call shrank the position between queue
    // and fill (see entry.ts). Frozen at placement: VIN-C removed the
    // calc_on_order_fills fill-time re-derivation of percent_of_equity
    // default quantities (TV locks them when the order is created).
    _base_qty?: number;
    // True when strategy.entry received an EXPLICIT qty argument. The 1519
    // TV lot-split (see Trade._tv_split_excess) is proven only for the
    // DEFAULT cash sizing; an explicit qty keeps a single closed row.
    _qty_explicit?: boolean;
}

// Per-bar intrabar-sequencing state for `calc_on_order_fills = true`
// (TV broker emulator). A historical bar is assumed to have 4 ticks in the
// order the broker emulator infers from the bar's OHLC (open → high → low →
// close when the open is closer to the high, open → low → high → close
// otherwise). Each COF pass consumes one tick: orders placed during the
// recalculation after a fill normally fill on the NEXT tick of the same bar.
// Two measured exceptions are drained at the CURRENT tick before `pass`
// advances:
//   1. a pure, position-reducing market exit created by the recalculation
//      (VIN-107); and
//   2. a REVERSAL market entry created by that recalculation (VIN-110) —
//      marked `_cof_reversal_same_tick`, filled at the triggering fill price,
//      one fill per logical order id per pass (anti-loop: the script re-emits
//      the same reversal on every recalculation; TV books it once).
// Same-bar fresh/pyramiding market entries and price-based orders retain
// their next-tick/path semantics (1502 same-bar groups prove it).
export interface CofBarState {
    pass: number; // current tick index (0..3)
    ticks: number[]; // [open, tick2, tick3, close]
    // Position sign at the START of the current pass (before its fills).
    // VIN-110: a recalc-created market entry is a REVERSAL when its
    // direction opposes the position that was open on this tick — the
    // same-tick market-exit drain may have flattened it to 0 by the time
    // the entry is created (1539: close drains first, then the opposite
    // entry fills at the same trigger price). Fresh same-direction
    // re-entries (2205/1502) keep the next-tick path.
    tickStartSign?: number;
    // Anti-loop guard for the same-tick reversal-entry drain: order ids
    // already filled by the drain at the current pass (lazily reset when
    // `pass` advances). A filled reversal must not be re-drained when the
    // recalculation re-emits the same logical order.
    drainedEntryIds?: Set<string>;
    drainedEntryPass?: number;
}

/**
 * Strategy state stored on the Context after a backtest run.
 *
 * Top-level scalars mirror Pine's `strategy.*` properties 1:1 (snake_case,
 * Pine's single-word concatenations like `netprofit` / `grossprofit` /
 * `grossloss` / `openprofit` preserved). Position fields are FLATTENED
 * — Pine exposes `strategy.position_size` / `position_avg_price` /
 * `position_entry_name` as three separate scalars, not a nested object.
 *
 * The `opentrades` / `closedtrades` arrays use Pine's exact names with
 * `.length` providing the count — same semantic as Pine's int count but
 * also indexable for the per-trade getter equivalents.
 */
export interface StrategyState {
    config: StrategyConfig;

    // Trade collections (arrays — `.length` is the Pine count)
    opentrades: Trade[];
    closedtrades: Trade[];
    pending_orders: Order[];

    // Position info — flattened to match Pine's separate-scalars data model
    position_size: number; // SIGNED (matches strategy.position_size)
    position_avg_price: number; // NaN when flat (matches Pine semantics)
    position_entry_name: string; // entry_id that opened current position

    // Account info — matches Pine names exactly
    initial_capital: number;
    account_currency: string;
    equity: number;
    netprofit: number; // realized only
    // VIN-136 (internal): cumulated ACCOUNT-currency conversion residual of
    // the realized P&L — the sum, over every increment `netprofit` received,
    // of (increment converted at the previous-daily FX rate of the day it is
    // realized − the increment itself): the entry commission at its own entry
    // day (percent fees only), gross − exit commission at the exit day.
    // `netprofit` and the ledger rows stay in the SYMBOL currency (the harness
    // comparator converts them itself). EXACTLY 0 when no FX series is
    // provided, so the pre-VIN-113 behaviour is untouched.
    _netprofit_account_residual: number;
    // VIN-136 (internal): the residual of `equity` — the realized residual
    // above plus the open mark-to-market's residual, snapshotted BY
    // markToMarket at the same instant as `equity` itself. This is what the
    // percent_of_equity sizing reads, so the equity and its residual always
    // come from the same instant. EXACTLY 0 without an FX series.
    _equity_account_residual: number;
    grossprofit: number;
    grossloss: number;
    openprofit: number; // unrealized P&L of open positions
    // Compound Annual Growth Rate (%) of strategy equity over the backtest
    // window. Computed ONCE at end-of-run by finalizeStrategyRun from
    // initial_capital, netprofit, and the first/last bar open times. Like
    // Sharpe / Sortino this is a report-only field (NOT a Pine built-in),
    // read via ctx.strategy.cagr after the run. NaN when the window is
    // shorter than one day or the figures are non-finite.
    cagr: number;

    // Peaks — used by strategy.max_drawdown / strategy.max_runup
    max_drawdown: number;
    max_runup: number;
    // Internal: running high-/low-water marks of REALIZED equity
    // (initial_capital + netprofit). Used symmetrically:
    //   max_drawdown reference is equity_peak  (worst dip below the high)
    //   max_runup    reference is equity_trough (best rise above the low)
    // equity_peak also serves as the denominator of max_drawdown_percent.
    equity_peak: number;
    equity_trough: number;
    // Total equity at the moment max_runup was last bumped — i.e. the
    // intra-bar high-water of (realized + best_unrealized_excursion). Used
    // as the denominator of max_runup_percent (TV reports runup as a
    // percentage of the equity AT the peak, not of initial_capital).
    equity_at_runup_peak: number;
    // Max-Equity snapshot (running high-water of realized equity) at the
    // moment max_drawdown was last bumped to a new peak. Used as the
    // denominator of max_drawdown_percent — TV's empirical behavior is
    // ddpct = max_drawdown / Max_Equity-at-latch × 100, NOT against
    // initial_capital or current equity_peak.
    equity_at_drawdown_peak: number;

    // Running max of `(latched_drawdown / equity_at_that_latch) × 100` and
    // `(latched_runup / equity_at_that_latch) × 100` across the strategy's
    // lifetime. Pine's max_drawdown_percent / max_runup_percent are the
    // HIGHEST RATIO observed across all latch events — NOT
    // (current_max_value / current_equity_at_peak). The two interpretations
    // diverge when a later latch produces a larger absolute value but a
    // smaller percentage (because equity grew faster than the latched
    // metric), so the running-max formulation is the only one that
    // matches the spec.
    max_drawdown_percent_value: number;
    max_runup_percent_value: number;

    // Risk-adjusted performance ratios (TV's "Risk-adjusted performance"
    // panel). Computed ONCE at end-of-run by finalizeStrategyRun from the
    // monthly equity curve — NOT Pine built-in variables (TV exposes them
    // only in the Strategy Tester report / xlsx, not to scripts), so they
    // live on the state object and are read via ctx.strategy.*.
    sharpe_ratio: number;
    sortino_ratio: number;

    // Buy-and-hold benchmark (TV's "Buy & Hold Return" report figures).
    // Computed ONCE at end-of-run by finalizeStrategyRun. Not Pine built-in
    // variables (TV exposes them only in the Strategy Tester report), so they
    // live on the state object and are read via ctx.strategy.* after the run.
    //
    // Model: a single long position bought with the ENTIRE initial capital at
    // the FIRST trade's entry price (slippage already baked into that fill
    // price) and held open through the last bar — never sold, so commissions
    // never apply and the exit leg carries no slippage.
    //   qty                  = initial_capital / first_entry_price
    //   buy_and_hold_pnl      = qty × (last_close − first_entry_price)
    //                         = initial_capital × per_gain / 100
    //   buy_and_hold_per_gain = (last_close − first_entry_price)
    //                            / first_entry_price × 100
    //   strategy_outperformance = netprofit − buy_and_hold_pnl
    // All NaN until the first trade opens (no entry price to anchor on).
    buy_and_hold_pnl: number;
    buy_and_hold_per_gain: number;
    strategy_outperformance: number;
    // Internal: entry price (slippage-adjusted) of the FIRST trade ever
    // opened in the run — the anchor for the buy-and-hold benchmark. Latched
    // once in openTrade and never overwritten.
    _first_entry_price?: number;

    // Internal: per-bar intrabar-sequencing state for
    // `calc_on_order_fills = true` (see CofBarState). Set at the start of
    // each bar by the execution loop, null outside the COF processing.
    _cof?: CofBarState | null;
    // Values of Pine's series-qualified strategy variables at the last script
    // execution for each bar. POC snapshots are taken before a non-COF close
    // fill; a COF post-fill recalculation replaces its current-bar snapshot.
    _series_history?: Record<string, unknown[]>;

    // Internal: mark-to-market equity at each calendar month's last bar,
    // and the month key of the most recent bar (rollover detector). Feed
    // the Sharpe / Sortino computation.
    _monthly_equity?: number[];
    _last_month_key?: number;

    // Trade-stat counters — updated each time a trade closes
    wintrades: number; // count of closed trades with profit > 0
    losstrades: number; // count of closed trades with profit < 0
    eventrades: number; // count of closed trades with profit === 0
    wintrades_total_profit: number; // sum of profits across winning closed trades (for avg)
    losstrades_total_loss: number; // sum of |loss| across losing closed trades (for avg)

    // Position-size peaks (in contracts/units)
    max_contracts_held_all: number; // max(|position_size|) seen
    max_contracts_held_long: number; // max(position_size) where > 0
    max_contracts_held_short: number; // max(|position_size|) where < 0

    // Pre-trade risk-management filters (configured via strategy.risk.*).
    // Each rule is optional; if undefined, the rule does not apply.
    risk_rules: {
        allow_entry_in?: 'long' | 'short' | 'all';
        max_cons_loss_days?: { count: number; alert_message?: string };
        max_drawdown?: { value: number; type: 'cash' | 'percent_of_equity' };
        max_intraday_filled_orders?: { count: number; alert_message?: string };
        max_intraday_loss?: { value: number; type: 'cash' | 'percent_of_equity' };
        max_position_size?: number;
    };

    // Once max_drawdown / max_intraday_loss / max_cons_loss_days triggers, all
    // further entries are blocked for the rest of the run (or trading day for
    // intraday rules — TODO: day rollover detection).
    risk_halted: boolean;

    // Internal: per-callsite cadence tracking for strategy.exit. Keyed by the
    // transpiler-injected __callsiteId; value is the last context.idx the user
    // called strategy.exit at that site. Read at queue time to detect whether
    // the prior bar also called this site (persistent pattern) or not (sparse
    // / inside-if-block pattern). See Order._isPersistent.
    _exit_call_history?: Map<string, number>;
    // Fallback counter for non-transpiled callers (no __callsiteId injection)
    // — paired with per-bar reset so each "first-of-bar" raw call gets a
    // stable synthetic id like `exit_raw_N`.
    _exit_fallback_counter?: number;
    _exit_fallback_last_bar?: number;
    // Filled conditional-exit identities for COF re-calls on the same bar.
    // A later bar starts a new order instance and ignores this record.
    _filled_exit_trade_ids?: Map<string, {
        bar: number;
        activationTradeIds: string[];
        consumedTradeIds: string[];
    }>;
    // Monotone counter for pyramiding-RUN ids (1519 TV lot-split family):
    // a fresh run starts on the first split add after flat / after a close,
    // and every later split add of the same run shares its excess.
    _tv_split_run_seq?: number;
}
