// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Order } from '../types';
import { Series } from '../../../Series';
import { parseArgsForPineParams, extractCallsiteId } from '../../utils';
import { calculateOrderQty, hasPendingMatchingEntry, roundToMintick } from '../utils';

/**
 * Pine signature (21 named args):
 *   strategy.exit(id, from_entry, qty, qty_percent, profit, limit, loss,
 *                 stop, trail_price, trail_points, trail_offset, oca_name,
 *                 comment, comment_profit, comment_loss, comment_trailing,
 *                 alert_message, alert_profit, alert_loss, alert_trailing,
 *                 disable_alert) → void
 *
 * Behavior:
 *   Stores a conditional exit order on `state.pending_orders` with
 *   category='exit'. Each bar, `processExitOrders()` (in utils.ts) checks
 *   TP / SL / trailing-stop conditions against bar high/low against the
 *   matching open trades, and fires a market close at the trigger price
 *   when hit. Multiple exit legs on a single call are treated OCO — the
 *   first leg to trigger fires; the exit order is then removed.
 *
 *   `profit` and `loss` are in TICKS (units of syminfo.mintick). `limit`
 *   and `stop` are absolute prices. `trail_price` + `trail_offset` form an
 *   absolute-price trailing-stop arm/ride pair; `trail_points` +
 *   `trail_offset` form a ticks-from-entry arm/ride pair.
 */
const EXIT_SIGNATURES = [
    [
        'id', 'from_entry', 'qty', 'qty_percent', 'profit', 'limit', 'loss', 'stop',
        'trail_price', 'trail_points', 'trail_offset', 'oca_name', 'comment',
        'comment_profit', 'comment_loss', 'comment_trailing', 'alert_message',
        'alert_profit', 'alert_loss', 'alert_trailing', 'disable_alert', 'when',
    ],
];
const EXIT_ARGS_TYPES = {
    id: 'string',
    from_entry: 'string',
    qty: 'series', qty_percent: 'series',
    profit: 'series', limit: 'series',
    loss: 'series', stop: 'series',
    trail_price: 'series', trail_points: 'series', trail_offset: 'series',
    oca_name: 'string',
    comment: 'string', comment_profit: 'string', comment_loss: 'string', comment_trailing: 'string',
    alert_message: 'string', alert_profit: 'string', alert_loss: 'string', alert_trailing: 'string',
    disable_alert: 'boolean',
    when: 'series',
};

export function exit(context: any) {
    return (...args: any[]) => {
        if (!context.strategy) {
            throw new Error('strategy.exit() called before strategy() declaration');
        }

        // Extract the transpiler-injected callsite ID BEFORE parsing args
        // (so parseArgsForPineParams doesn't see the sentinel). When the call
        // comes from non-transpiled JS, the sentinel is absent — fall back
        // to a per-bar synthetic counter so each "raw" call still gets a
        // stable id within the bar (the cadence check below is fuzzier in
        // that case but still works for the canonical patterns).
        let callsiteId = extractCallsiteId(args);

        const parsed = parseArgsForPineParams<any>(args, EXIT_SIGNATURES, EXIT_ARGS_TYPES);

        const extractValue = (val: any) => {
            if (val === undefined || val === null) return val;
            if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
            if (typeof val === 'function') return val();
            if (val instanceof Series) return val.get(0);
            if (Array.isArray(val)) return val[val.length - 1];
            if (typeof val === 'object' && val.get !== undefined) return val.get(0);
            return val;
        };

        const whenValue = Object.prototype.hasOwnProperty.call(parsed, 'when') ? extractValue(parsed.when) : true;
        if (!whenValue) return;
        if (callsiteId === undefined) {
            const s = context.strategy;
            if (s._exit_fallback_last_bar !== context.idx) {
                s._exit_fallback_counter = 0;
                s._exit_fallback_last_bar = context.idx;
            }
            callsiteId = `exit_raw_${s._exit_fallback_counter++}`;
        }
        const idValue          = extractValue(parsed.id);
        const fromEntry        = extractValue(parsed.from_entry);
        const qty              = extractValue(parsed.qty);
        const qtyPercent       = extractValue(parsed.qty_percent);
        const profit           = extractValue(parsed.profit);
        const limitRaw         = extractValue(parsed.limit);
        const loss             = extractValue(parsed.loss);
        const stopRaw          = extractValue(parsed.stop);
        const trailPriceRaw    = extractValue(parsed.trail_price);
        const trailPoints      = extractValue(parsed.trail_points);
        const trailOffset      = extractValue(parsed.trail_offset);

        // TradingView rounds an absolute exit LIMIT away from the market's adverse
        // side for ANY open position class (stock, crypto spot, ...): long → up,
        // short → down (probed on BINANCE:XLMUSDT D, script 1828: level 0.074295
        // from a short TP placed at close 0.07426 fills at 0.0742). Without a
        // position and without a bound pending entry, preserve the
        // reference-directed placement rule.
        // Absolute trail_price placement keeps the established current-close
        // reference so VIN-86c trailing direction semantics remain unchanged.
        const mintick = context.pine?.syminfo?.mintick ?? 0;
        const currentClose = Series.from(context.data.close).get(0);
        // Explicit exit quantities use the same provider step as entry/order
        // quantities. With an integer-only instrument, floor the requested
        // leg at creation; an uncapped sibling exit consumes the remaining
        // position and therefore receives the integer remainder.
        const normalizedQty = qty !== undefined && qty !== null
            ? calculateOrderQty(context, Number(qty), 0, currentClose)
            : undefined;
        const isStock = context.pine?.syminfo?.type === 'stock';
        const positionDirection = Math.sign(context.strategy.position_size);
        const positionReference = isStock && Number.isFinite(context.strategy.position_avg_price)
            ? context.strategy.position_avg_price
            : currentClose;
        const stopRounding: 'up' | 'down' | undefined = isStock && positionDirection !== 0
            ? positionDirection === 1 ? 'down' : 'up'
            : undefined;
        const stop        = stopRaw       !== undefined ? roundToMintick(stopRaw,       positionReference, mintick, stopRounding) : undefined;
        const trailPrice  = trailPriceRaw !== undefined ? roundToMintick(trailPriceRaw, currentClose, mintick) : undefined;
        const fromEntryId = fromEntry ?? '';
        const exitId = idValue ?? 'exit';
        const lifecycleKey = `${exitId}\u0000${fromEntryId}`;

        // Cadence detection: persistent vs ephemeral capture.
        // If the user called strategy.exit at THIS exact call site on the
        // previous bar, the pattern is "every bar" (persistent — variable
        // is in main scope, value always defined). If the prior bar had
        // no call, the pattern is "sparse" (ephemeral — variable likely
        // scoped to an if-block, NA on non-trigger bars in TV). Used
        // below by processExitOrders to keep persistent-pattern exits
        // active, matching TV's actual behavior of firing the captured
        // value when the user keeps refreshing it. (The reversal-drop
        // suppression was removed in VIN-77; since VIN-125 the bracket
        // binding is snapshotted at call time — a reversal entry filled
        // later never inherits an order created for the outgoing position.)
        const history = context.strategy._exit_call_history as Map<string, number>;
        const lastBarForSite = history.get(callsiteId);
        const isPersistent = lastBarForSite !== undefined && lastBarForSite === context.idx - 1;
        history.set(callsiteId, context.idx);
        const matchingActivations = context.strategy.opentrades.flatMap(
            (trade: {
                id: string;
                entry_id: string;
                size: number;
                _activation_id?: string;
                _activation_entry_id?: string;
                _activation_segments?: Array<{ id: string; entryId: string }>;
            }) => {
                const identities = trade._activation_segments
                    ?? [{
                        id: trade._activation_id ?? trade.id,
                        entryId: trade._activation_entry_id ?? trade.entry_id,
                    }];
                return identities
                    .filter((identity) => !fromEntryId || identity.entryId === fromEntryId)
                    .map((identity) => ({
                        ...identity,
                        direction: Math.sign(trade.size),
                    }));
            },
        );
        const matchingTradeIds = matchingActivations.map((activation) => activation.id);
        const pendingMatchingEntries = context.strategy.pending_orders.filter(
            (order: Order) =>
                order.status === 'pending'
                && (order.category ?? 'entry') === 'entry'
                && (!fromEntryId || order.id === fromEntryId),
        );

        // Conditional exits bind to the call-time position, not the
        // activation book that exists after a later reversal fills. When an
        // open activation is present it takes precedence over pending
        // entries; when flat, preserve the same-evaluation entry(); exit()
        // pattern only if pending entries have one unambiguous direction.
        let boundActivationIds: string[] | undefined;
        let boundEntryIds: string[] | undefined;
        let boundDirection: -1 | 1 | undefined;
        if (matchingActivations.length > 0) {
            boundActivationIds = Array.from(new Set(matchingActivations.map((activation) => activation.id)));
            const direction = matchingActivations.find((activation) => activation.direction === 1 || activation.direction === -1)?.direction;
            if (direction === 1 || direction === -1) {
                boundDirection = direction;
                // A same-side entry already pending at the call remains an
                // eligible activation (pyramiding). Opposite pending entries
                // are deliberately excluded; they are reversal candidates
                // and must not inherit this bracket.
                const sameSidePendingIds = pendingMatchingEntries
                    .filter((order) => Math.sign(Number(order.direction)) === direction)
                    .map((order) => order.id);
                if (sameSidePendingIds.length > 0) {
                    boundEntryIds = Array.from(new Set(sameSidePendingIds));
                }
            }
        } else if (pendingMatchingEntries.length > 0) {
            const pendingDirections: Array<-1 | 1> = Array.from(new Set<-1 | 1>(
                pendingMatchingEntries
                    .map((order) => Math.sign(Number(order.direction)))
                    .filter((direction): direction is -1 | 1 => direction === -1 || direction === 1),
            ));
            if (pendingDirections.length === 1) {
                boundDirection = pendingDirections[0];
                boundEntryIds = Array.from(new Set(pendingMatchingEntries.map((order) => order.id)));
                boundActivationIds = [];
            } else {
                // Never choose one side when a flat book has pending
                // entries in both directions. An empty captured set is
                // intentionally non-matching and is cancelled once those
                // entries are gone.
                boundActivationIds = [];
                boundEntryIds = [];
            }
        }
        const limitRounding: 'up' | 'down' | undefined = boundDirection === 1
            ? 'up'
            : boundDirection === -1
              ? 'down'
              : positionDirection !== 0
                ? positionDirection === 1 ? 'up' : 'down'
                : undefined;
        const limit = limitRaw !== undefined
            ? roundToMintick(limitRaw, positionReference, mintick, limitRounding)
            : undefined;
        const lifecycle = context.strategy._filled_exit_trade_ids?.get(lifecycleKey);
        const sameBarLifecycle = lifecycle?.bar === context.idx ? lifecycle : undefined;
        const partialExit = Number(qty) > 0 || Number(qtyPercent) > 0;
        const activationLifecycle = partialExit ? lifecycle : sameBarLifecycle;
        const excludedActivationTradeIds = (activationLifecycle?.activationTradeIds ?? [])
            .filter((tradeId: string) => matchingTradeIds.includes(tradeId));
        const excludedConsumedTradeIds = sameBarLifecycle?.consumedTradeIds ?? [];
        const waitingForEntry = hasPendingMatchingEntry(context.strategy, fromEntryId);
        if (
            matchingTradeIds.length > 0
            && matchingTradeIds.every((tradeId: string) => excludedActivationTradeIds.includes(tradeId))
            && !waitingForEntry
        ) {
            return;
        }

        const order: Order = {
            id: exitId,
            direction: 0,           // resolved at trigger based on matching trades
            qty: normalizedQty ?? 0,
            _explicit_qty_cap: qty !== undefined && qty !== null,
            qty_percent: qtyPercent,
            type: 'market',
            bar: context.idx,
            time: Series.from(context.data.openTime).get(0),
            status: 'pending',
            category: 'exit',
            from_entry: fromEntryId,
            profit, loss, limit, stop,
            trail_price: trailPrice,
            trail_points: trailPoints,
            trail_offset: trailOffset,
            oca_name: extractValue(parsed.oca_name),
            comment: extractValue(parsed.comment),
            comment_profit: extractValue(parsed.comment_profit),
            comment_loss: extractValue(parsed.comment_loss),
            comment_trailing: extractValue(parsed.comment_trailing),
            alert_message: extractValue(parsed.alert_message),
            alert_profit: extractValue(parsed.alert_profit),
            alert_loss: extractValue(parsed.alert_loss),
            alert_trailing: extractValue(parsed.alert_trailing),
            disable_alert: extractValue(parsed.disable_alert),
            trail_armed: false,
            trail_peak: NaN,
            _isPersistent: isPersistent,
            _callsiteId: callsiteId,
            _exit_lifecycle_key: lifecycleKey,
            _exit_bound_activation_ids: boundActivationIds,
            _exit_bound_entry_ids: boundEntryIds,
            _exit_bound_direction: boundDirection,
            _exit_refreshed: false,
            _excluded_activation_trade_ids: excludedActivationTradeIds,
            _excluded_consumed_trade_ids: excludedConsumedTradeIds,
        };

        // An unfilled pending instance is refreshed in place. A filled
        // instance has already been removed by processExitOrders, so a later
        // call creates the new instance below. This distinction keeps
        // reservation/exclusion state scoped to one broker order instance.
        const list = context.strategy.pending_orders as Order[];
        const pending = list.find(
            (candidate) =>
                candidate.category === 'exit'
                && candidate.id === order.id
                && (candidate.from_entry ?? '') === (order.from_entry ?? '')
                && candidate.status === 'pending',
        );
        if (pending !== undefined) {
            const trailArmed = pending.trail_armed;
            const trailPeak = pending.trail_peak;
            const activationExclusions = pending._excluded_activation_trade_ids;
            const consumedExclusions = pending._excluded_consumed_trade_ids;
            const continuousSameLifecycle =
                pending.bar === context.idx - 1
                || (pending.bar === context.idx && pending._isPersistent === true);
            Object.assign(pending, order);
            // VIN-120: a refresh is never a fresh instance — drop the
            // pass-scoped marker so a later bar with a coincident COF pass
            // number cannot drain this bracket same-tick as if it were new.
            delete pending._cof_fresh_single_trade_exit_pass;
            pending._isPersistent = order._isPersistent || continuousSameLifecycle;
            if (trailArmed) {
                pending.trail_armed = true;
                pending.trail_peak = trailPeak;
            }
            pending._excluded_activation_trade_ids = activationExclusions;
            pending._excluded_consumed_trade_ids = consumedExclusions;
            pending._exit_refreshed = true;
            return;
        }
        // VIN-120: mark a FRESH single-trade exit bracket created by a COF
        // fill recalculation. Only the new instance is marked (a refreshed
        // pending returned above); the qualification is the measured
        // lifecycle: one open trade, entered on the current bar at the
        // current assumed path point (pass 0 → the open segment −1, later
        // passes → segment pass−1). The same-tick drain fills it when
        // already marketable; the marker is pass-scoped — any later pass or
        // bar ignores it and restores the next-path semantics.
        const cofState = context.strategy._cof;
        if (cofState != null && context.strategy.opentrades.length === 1) {
            const trade = context.strategy.opentrades[0];
            const entryBar = trade._activation_entry_bar_index ?? trade.entry_bar_index;
            const entryPathSegment = trade._activation_entry_path_segment;
            const activationAtCurrentTick = cofState.pass === 0
                ? entryPathSegment === -1
                : entryPathSegment === cofState.pass - 1;
            if (entryBar === context.idx && activationAtCurrentTick) {
                order._cof_fresh_single_trade_exit_pass = cofState.pass;
            }
        }
        list.push(order);
    };
}
