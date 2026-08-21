// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Order } from '../types';
import { Series } from '../../../Series';
import { parseArgsForPineParams, extractCallsiteId } from '../../utils';
import { hasPendingMatchingEntry, roundToMintick } from '../utils';

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

        // Snap limit/stop/trail_price to the mintick grid AWAY from the
        // current bar's close (broker-emulator convention — see
        // roundToMintick in utils.ts). Already-aligned inputs (e.g. an
        // exact `position_avg_price + N`) round to themselves; arbitrary
        // multiplications like `close * 0.95` get the same adverse
        // rounding Pine applies at order placement.
        const mintick = context.pine?.syminfo?.mintick ?? 0;
        const currentClose = Series.from(context.data.close).get(0);
        const limit       = limitRaw      !== undefined ? roundToMintick(limitRaw,      currentClose, mintick) : undefined;
        const stop        = stopRaw       !== undefined ? roundToMintick(stopRaw,       currentClose, mintick) : undefined;
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
        // suppression was removed in VIN-77: brackets now attach to the
        // filled position, including reversal entries.)
        const history = context.strategy._exit_call_history as Map<string, number>;
        const lastBarForSite = history.get(callsiteId);
        const isPersistent = lastBarForSite !== undefined && lastBarForSite === context.idx - 1;
        history.set(callsiteId, context.idx);
        const matchingTradeIds = context.strategy.opentrades.flatMap(
            (trade: {
                id: string;
                entry_id: string;
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
                    .map((identity) => identity.id);
            },
        );
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
            qty: qty !== undefined ? Math.abs(Number(qty)) : 0,
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
            Object.assign(pending, order);
            if (trailArmed) {
                pending.trail_armed = true;
                pending.trail_peak = trailPeak;
            }
            pending._excluded_activation_trade_ids = activationExclusions;
            pending._excluded_consumed_trade_ids = consumedExclusions;
            return;
        }
        list.push(order);
    };
}
