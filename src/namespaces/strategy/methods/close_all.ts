// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Order } from '../types';
import { Series } from '../../../Series';
import { parseArgsForPineParams } from '../../utils';

/**
 * Close ALL open positions at market, regardless of which entry opened them.
 *
 * Pine signature:
 *   v4: strategy.close_all(when, comment, alert_message) → void
 *   v5: strategy.close_all(comment, alert_message, immediately, disable_alert) → void
 *
 * `when` remains accepted as the trailing compatibility slot used by the
 * strategy method parser and by transpiled named-argument calls.
 */
const CLOSE_ALL_SIGNATURES = [['comment', 'alert_message', 'immediately', 'disable_alert', 'when']];
const CLOSE_ALL_ARGS_TYPES = {
    comment: 'string',
    alert_message: 'string',
    immediately: 'boolean',
    disable_alert: 'boolean',
    when: 'series',
};

export function close_all(context: any) {
    return (...args: any[]) => {
        if (!context.strategy) {
            throw new Error('strategy.close_all() called before strategy() declaration');
        }

        // Pine v4 also allows `when` as the first positional argument. The
        // canonical signature keeps `when` trailing so named and v5 calls
        // retain their existing positional slots; normalize the legacy form
        // before parsing the remaining arguments.
        const first = args[0];
        const hasPositionalWhen = args.length > 0 && (
            first === undefined
            || first === null
            || first instanceof Series
            || typeof first === 'boolean'
            || typeof first === 'number'
            || typeof first === 'function'
            || (typeof first === 'object' && first !== null && '__value' in first)
        );
        const parsed = parseArgsForPineParams<any>(
            hasPositionalWhen ? args.slice(1) : args,
            CLOSE_ALL_SIGNATURES,
            CLOSE_ALL_ARGS_TYPES,
        );
        if (hasPositionalWhen) parsed.when = first;

        const extractValue = (val: any) => {
            if (val === undefined || val === null) return val;
            if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
            if (typeof val === 'function') return val();
            if (val instanceof Series) return val.get(0);
            if (Array.isArray(val)) return val[val.length - 1];
            if (typeof val === 'object' && '__value' in val) return val.__value;
            if (typeof val === 'object' && val.get !== undefined) return val.get(0);
            return val;
        };
        const whenValue = Object.prototype.hasOwnProperty.call(parsed, 'when') ? extractValue(parsed.when) : true;
        if (!whenValue) return;

        // TV semantic: strategy.close_all() called with no open positions is
        // a no-op. Without this guard, the queued order survives to the next
        // bar and closes the next entry that fills at its entry price (zero
        // PnL), because from_entry='' matches any new trade. Notably this
        // affects scripts that call close_all on indicator conditions that
        // can fire when the position is already flat (e.g. exit-bar-count
        // indicators where the count signal coincides with a fresh entry on
        // the next bar). The position-state check has to happen at QUEUE
        // time, not fill time — by fill time the new entry has already
        // filled and would match.
        if (context.strategy.opentrades.length === 0) return;

        // TV semantic: strategy.close_all() supersedes any pending conditional
        // strategy.exit() orders for the entire book. Without this, both the
        // close_all market and the conditional exits fire on the next bar,
        // double-closing the position. Conditional exits are identified by
        // having at least one of profit/loss/limit/stop/trail_* set; close()
        // / close_all() markets leave all of those undefined.
        const isConditionalExit = (o: Order) =>
            (o.category ?? 'entry') === 'exit' &&
            (o.profit !== undefined ||
                o.loss !== undefined ||
                o.limit !== undefined ||
                o.stop !== undefined ||
                o.trail_price !== undefined ||
                o.trail_points !== undefined);

        const pending = context.strategy.pending_orders;
        for (const o of pending) {
            if (isConditionalExit(o) && o.status === 'pending') {
                o.status = 'cancelled';
            }
        }
        context.strategy.pending_orders = pending.filter((o: Order) => o.status === 'pending');

        // Snapshot the IDs of open trades at CALL time so the close order
        // remains bound to its originally-intended position. If a reversal
        // entry queued the same bar fills first on the next bar and
        // implicitly closes the snapshotted trades, this close_all has no
        // target left and `processExitOrders` will cancel it instead of
        // catching the freshly-opened reversal trade. Matches TV's binding
        // of strategy.close_all() to the position at call time.
        const order: Order = {
            id: 'close_all',
            direction: 0, // resolved at fill time
            qty: 0, // resolved at fill time (sum of |all open trades|)
            type: 'market',
            bar: context.idx,
            time: Series.from(context.data.openTime).get(0),
            status: 'pending',
            category: 'exit',
            from_entry: '', // empty == match-all (within the snapshot)
            comment: parsed.comment,
            alert_message: parsed.alert_message,
            immediately: parsed.immediately === true,
            disable_alert: parsed.disable_alert,
            _intended_trade_ids: context.strategy.opentrades.map((t: any) => t.id),
        };
        context.strategy.pending_orders.push(order);
    };
}
