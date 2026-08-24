// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { calculateOrderQty, normalizeOrderLevel, parseDirection, parseEntryDirection, wouldExceedPyramiding, roundToMintick } from '../utils';
import { Order } from '../types';
import { Series } from '../../../Series';
import { parseArgsForPineParams } from '../../utils';

/**
 * Pine signature:
 *   v4: strategy.entry(id, long, qty, limit, stop, oca_name, oca_type, comment, when) → void
 *   v5: strategy.entry(id, direction, qty, limit, stop, oca_name, oca_type, comment,
 *                      alert_message, disable_alert, when) → void
 *
 * The v4 `long` parameter is a `series bool` (true = long, false = short) and
 * also accepts the legacy int idiom `1`/`0` and the v4 bool-like constants
 * strategy.long/strategy.short. Translation is TYPE-based (see
 * parseEntryDirection): booleans and 0/1 are the v4 forms, 'long'/'short'
 * strings are the v5 direction constants — a v5 call can never produce a
 * boolean in that slot, so the v5 path is untouched. Named `long=` arrives in
 * the trailing options bag as `parsed.long` (the transpiler collects named
 * args); positional forms land in `parsed.direction`.
 *
 * Differences vs strategy.order:
 *   - Respects the strategy() declaration's `pyramiding` cap (no-op when
 *     the direction's open-trade count already equals the cap).
 *   - Auto-reverses the current position when direction is opposite:
 *     the resulting market order's qty is sized to close the existing
 *     position AND open a new one of the requested qty in the new direction.
 */
const ENTRY_SIGNATURES = [
    ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message', 'disable_alert', 'when'],
];
const ENTRY_ARGS_TYPES = {
    id: 'string',
    direction: 'series',
    qty: 'series',
    limit: 'series',
    stop: 'series',
    oca_name: 'string',
    oca_type: 'string',
    comment: 'string',
    alert_message: 'string',
    disable_alert: 'boolean',
    when: 'series',
};

export function entry(context: any) {
    return (...args: any[]) => {
        if (!context.strategy) {
            throw new Error('strategy.entry() called before strategy() declaration');
        }
        const parsed = parseArgsForPineParams<any>(args, ENTRY_SIGNATURES, ENTRY_ARGS_TYPES);

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

        const idValue       = extractValue(parsed.id);
        // Direction translation (VIN-91). The v4 legacy parameter is only
        // active when the transpiled source declares //@version=4:
        //   - named `long=<bool>`: the transpiler collects named args into a
        //     trailing options bag, so `long=` arrives as `parsed.long`;
        //   - positional 2nd slot: bool true/false or legacy int 1/0.
        // v5 uses `direction` and strategy.long/strategy.short strings. Its
        // invalid bool/long forms must not be silently accepted as v4.
        const isV4 = context.pineVersion === 4;
        const hasNamedLong = isV4 && Object.prototype.hasOwnProperty.call(parsed, 'long');
        if (Object.prototype.hasOwnProperty.call(parsed, 'short')) {
            throw new Error(
                'strategy.entry(): paramètre `short=` non supporté — v4 n\'a pas de paramètre short= (utiliser long=false) ; ' +
                'v5 utilise direction=strategy.short',
            );
        }
        const directionVal = hasNamedLong
            ? extractValue(parsed.long)
            : extractValue(parsed.direction);
        if (directionVal === undefined) {
            throw new Error('strategy.entry: direction is required');
        }
        const dir = isV4
            ? parseEntryDirection(directionVal)
            : parseDirection(directionVal);
        if (dir === 0) {
            throw new Error(
                `strategy.entry(): direction non traduisible (${JSON.stringify(directionVal)}). ` +
                (isV4
                    ? 'v4 attend long=true/false ou 1/0 ; v5 attend strategy.long/strategy.short'
                    : 'v5 attend strategy.long/strategy.short'),
            );
        }
        const strategy = context.strategy;
        const qtyValue      = extractValue(parsed.qty);
        const hasLimitLevel = Object.prototype.hasOwnProperty.call(parsed, 'limit') && parsed.limit !== undefined;
        const hasStopLevel  = Object.prototype.hasOwnProperty.call(parsed, 'stop') && parsed.stop !== undefined;
        const limitValue    = normalizeOrderLevel(extractValue(parsed.limit), hasStopLevel);
        const stopValue     = normalizeOrderLevel(extractValue(parsed.stop), hasLimitLevel);
        const ocaName       = extractValue(parsed.oca_name);
        const ocaType       = extractValue(parsed.oca_type);
        const commentValue  = extractValue(parsed.comment);
        // [HYPOTHÈSE] Same-direction, same-ID orders coexist only while flat,
        // pyramiding has a free slot, and the price definition changes.
        // Otherwise this implementation modifies one pending order. TV's
        // strategy.cancel() example proves coexistence is possible, but does
        // not fully specify this boundary; if TV modifies the whole same-ID
        // group in another case, pending-order counts and later fills diverge.
        const pendingIndex = strategy.pending_orders.findIndex(
            (order: Order) => order.status === 'pending' && (order.category ?? 'entry') === 'entry' && order.id === idValue,
        );
        const replacesPendingGroup = pendingIndex >= 0
            && parseDirection(strategy.pending_orders[pendingIndex].direction) !== dir;
        let hasFreePyramidingSlot = false;
        if (pendingIndex >= 0 && parseDirection(strategy.pending_orders[pendingIndex].direction) === dir) {
            let openSameSide = 0;
            for (const trade of strategy.opentrades) {
                if (Math.sign(trade.size) === dir) openSameSide++;
            }
            let occupiedSlots = openSameSide;
            for (const order of strategy.pending_orders) {
                if (
                    order.status === 'pending'
                    && (order.category ?? 'entry') === 'entry'
                    && parseDirection(order.direction) === dir
                ) {
                    occupiedSlots++;
                }
            }
            const cap = strategy.config.pyramiding ?? 1;
            hasFreePyramidingSlot = openSameSide === 0 && occupiedSlots < cap;
        }

        // Project the position forward over MARKET entry orders already queued
        // on THIS bar: they fill (in queue order) before this one, so the
        // reversal/add classification AND the reversal close-qty must be
        // computed against the position they will leave behind — not the stale
        // pre-fill position_size. Without this, several opposite-direction
        // entries queued on the same bar EACH re-add the full close-qty and
        // EACH bypass the pyramiding cap (QA "Sim Pyramiding": short -3 + three
        // long entries → PineTS +9 vs TradingView +3, where only the first
        // entry reverses and the rest are plain pyramiding adds). The net
        // position change per queued order is `direction × qty`, which is exact
        // even for a reversal order since its qty already bakes in the close-qty.
        let currentSize = strategy.position_size;
        for (let i = 0; i < strategy.pending_orders.length; i++) {
            if (i === pendingIndex) continue;
            const o = strategy.pending_orders[i];
            if (o.bar === context.idx && o.category === 'entry' && o.type === 'market') {
                currentSize += parseDirection(o.direction) * o.qty;
            }
        }

        // Pyramiding cap: only enforced when ADDING to a same-direction position
        // (not when opening from flat or reversing). Pine's semantic.
        const isAddingSameSide = Math.sign(currentSize) === dir && currentSize !== 0;
        if (isAddingSameSide && pendingIndex < 0 && wouldExceedPyramiding(strategy, dir)) {
            return; // no-op
        }

        // Determine the order qty. For a reversal (direction differs from
        // current position), Pine ADDS the absolute current position to the
        // requested qty so that one market order both flattens the prior
        // position AND opens a new one of the requested qty.
        const currentPrice = Series.from(context.data.close).get(0);
        const sizingPrice = stopValue !== undefined
            ? stopValue
            : limitValue !== undefined
              ? limitValue
              : currentPrice;
        const baseQty = calculateOrderQty(context, qtyValue, dir, sizingPrice);

        // VIN-103: TV never submits an order whose calculated quantity is
        // not strictly positive. percent_of_equity / cash / fixed sizing can
        // truncate to 0 (1820: the fork books 9 size-0 FLAT lots that TV
        // never opens over 627 trades); a qty-0 reversal would additionally
        // mis-close the position. Drop the order entirely — no pending
        // order, no fill, no zero-size lot. `!(x > 0)` also refuses NaN.
        if (!(baseQty > 0)) return;

        // Flag orders whose qty came from the strategy() default under
        // percent_of_equity (no explicit qty argument). With
        // calc_on_order_fills=true the engine re-sizes them at FILL time
        // (TV sizes percent_of_equity as a percentage of the available
        // equity "when the trade opens" — see processStrategyOrders).
        let defaultQtyType = strategy.config.default_qty_type ?? 'fixed';
        if (typeof defaultQtyType === 'function') defaultQtyType = (defaultQtyType as Function)();
        const qtyFromDefaultEquity = qtyValue === undefined && defaultQtyType === 'percent_of_equity';

        const isReversal = currentSize !== 0 && Math.sign(currentSize) !== dir;
        const totalQty = isReversal ? Math.abs(currentSize) + baseQty : baseQty;

        // Determine order type from limit/stop presence
        let orderType: 'market' | 'limit' | 'stop' | 'stop-limit' = 'market';
        if (limitValue !== undefined && stopValue !== undefined) {
            orderType = 'stop-limit';
        } else if (limitValue !== undefined) {
            orderType = 'limit';
        } else if (stopValue !== undefined) {
            orderType = 'stop';
        }

        // Snap limit/stop to the mintick grid AWAY from current price (the
        // broker-emulator convention — see roundToMintick). For market
        // orders this is a no-op.
        const mintick = context.pine?.syminfo?.mintick ?? 0;
        const limitValueRounded = limitValue !== undefined ? roundToMintick(limitValue, currentPrice, mintick) : undefined;
        const stopValueRounded  = stopValue  !== undefined ? roundToMintick(stopValue,  currentPrice, mintick) : undefined;

        // A stop already beyond the signal bar's close is marketable at
        // submission (VIN-95): it keeps its level for sizing — the qty was
        // computed above from `stopValue` — but behaves as a triggered stop
        // and fills at the next admissible open. Equality remains a stop
        // crossing on the next bar, with 1-ulp tolerance reserved for
        // trigger-vs-feed comparisons.
        const stopMarketable = orderType === 'stop'
            && stopValueRounded !== undefined
            && ((dir === 1 && stopValueRounded < currentPrice - 1e-12 * Math.max(1, Math.abs(currentPrice)))
                || (dir === -1 && stopValueRounded > currentPrice + 1e-12 * Math.max(1, Math.abs(currentPrice))));

        const currentTime = Series.from(context.data.openTime).get(0);

        // VIN-110: sticky creation-time marker — a REVERSAL MARKET entry
        // emitted by a COF recalculation. "Reversal" is measured against the
        // position that was open on THIS tick: the current position when
        // non-zero, else the position at the pass's start (the same-tick
        // market-exit drain may have flattened it to 0 before the entry was
        // created — 1539: close drains first, then the opposite entry fills
        // at the same trigger price). Fresh and same-direction re-entries
        // (2205 round-trips, 1502 adds) never carry it — they advance to the
        // next OHLC point. The engine's same-tick drain fills marked orders
        // at the triggering price.
        const cofSameTickReversal = context.strategy._cof != null
            && orderType === 'market'
            && (() => {
                const pos = context.strategy.position_size;
                const referenceSign = pos !== 0
                    ? Math.sign(pos)
                    : (context.strategy._cof.tickStartSign ?? 0);
                return referenceSign !== 0 && Math.sign(dir) !== referenceSign;
            })();

        const orderObj: Order = {
            id: idValue,
            direction: dir,
            qty: totalQty,
            type: orderType,
            limit: limitValueRounded,
            stop: stopValueRounded,
            bar: context.idx,
            time: currentTime,
            status: 'pending',
            category: 'entry',
            oca_name: ocaName,
            oca_type: ocaType as 'cancel' | 'reduce' | 'none' | undefined,
            comment: commentValue,
            _isReversalEntry: isReversal,
            _stop_marketable: stopMarketable,
            _cof_reversal_same_tick: cofSameTickReversal,
            // Ordered base size (before the reversal close-qty addition).
            // executeOrder uses it to split a reversal OVERSHOOT into its
            // own lot when a deferred close-margin-call shrank the
            // position between queue and fill — TV books the base and the
            // overshoot as two separate lots (xlsx 2021-10-02: 5 +
            // 0.263108 longs at the same fill).
            _base_qty: baseQty,
            _qty_from_default_equity: qtyFromDefaultEquity,
        } as any;

        if (replacesPendingGroup) {
            // A buy↔sell change cannot modify the old order: TV cancels it and
            // places a new one. Since one ID can name several unfilled orders,
            // replace the complete same-ID entry group, as strategy.cancel(id)
            // does: https://www.tradingview.com/pine-script-docs/concepts/strategies/
            strategy.pending_orders = strategy.pending_orders.filter(
                (order: Order) =>
                    order.status !== 'pending'
                    || (order.category ?? 'entry') !== 'entry'
                    || order.id !== idValue,
            );
            strategy.pending_orders.push(orderObj);
        } else if (pendingIndex < 0) {
            strategy.pending_orders.push(orderObj);
        } else {
            const pending = strategy.pending_orders[pendingIndex];
            const unchangedActivatedStopLimit =
                pending.type === 'limit'
                && pending.stop !== undefined
                && pending._stop_limit_activated !== undefined
                && orderObj.type === 'stop-limit'
                && pending.limit === orderObj.limit
                && pending.stop === orderObj.stop;
            if (unchangedActivatedStopLimit) {
                // Activating a stop-limit creates a limit order. Repeating the
                // unchanged command modifies its user fields, but must not turn
                // that activated limit back into a fresh stop-limit. A changed
                // stop/limit definition follows the normal replacement path
                // below and therefore starts unactivated.
                // https://www.tradingview.com/pine-script-docs/concepts/strategies/#stop-and-stop-limit-orders
                // https://www.tradingview.com/pine-script-docs/concepts/strategies/#order-placement-commands
                const activatedBar = pending.bar;
                const activatedTime = pending.time;
                Object.assign(pending, orderObj);
                pending.type = 'limit';
                pending.bar = activatedBar;
                pending.time = activatedTime;
            } else {
                const priceDefinitionChanged =
                    pending.type !== orderObj.type
                    || pending.limit !== orderObj.limit
                    || pending.stop !== orderObj.stop;
                if (hasFreePyramidingSlot && priceDefinitionChanged) strategy.pending_orders.push(orderObj);
                else strategy.pending_orders[pendingIndex] = orderObj;
            }
        }
    };
}
