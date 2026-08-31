// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { calculateOrderQty, cofCurrentTick, cryptoMarketSizingPrice, normalizeOrderLevel, parseDirection, parseEntryDirection, wouldExceedPyramiding, roundToMintick } from '../utils';
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

/**
 * A market exit order queued on the CURRENT bar by strategy.close() /
 * strategy.close_all(): pending, bound to call-time trade IDs, and free of
 * conditional exit legs (profit/loss/limit/stop/trail). Conditional
 * strategy.exit() orders carry at least one of those legs, and a stale
 * close from an earlier bar has o.bar !== barIdx — neither qualifies.
 */
function isPendingMarketClose(o: Order, barIdx: number): boolean {
    return (
        o.status === 'pending'
        && o.bar === barIdx
        && (o.category ?? 'entry') === 'exit'
        && o.type === 'market'
        && o.profit === undefined
        && o.loss === undefined
        && o.limit === undefined
        && o.stop === undefined
        && o.trail_price === undefined
        && o.trail_points === undefined
        && Array.isArray(o._intended_trade_ids)
        && o._intended_trade_ids.length > 0
    );
}

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
        // TV keeps AT MOST ONE pending entry order per ID. Re-calling
        // `strategy.entry(id, …)` while a pending entry with that id exists
        // MODIFIES it (the new spec replaces the old one) — whatever the
        // pyramiding setting, position state, or price definition
        // (2444: 5 same-ID stops queued while flat with pyramiding=5 are
        // coalesced by TV into the last submission; the engine's old
        // coexistence branch booked 4 stale fills at b296). A direction
        // flip cancels the pending group and places a brand-new order
        // (VIN-75, unchanged). https://www.tradingview.com/pine-script-docs/concepts/strategies/
        const pendingIndex = strategy.pending_orders.findIndex(
            (order: Order) => order.status === 'pending' && (order.category ?? 'entry') === 'entry' && order.id === idValue,
        );
        const replacesPendingGroup = pendingIndex >= 0
            && parseDirection(strategy.pending_orders[pendingIndex].direction) !== dir;
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

        // A same-bar close()/close_all() is filled after market entries, but
        // its snapshot still covers only the call-time trades. Project those
        // trades for entry classification and pyramiding without changing the
        // live book. calc_on_order_fills is deliberately excluded: its
        // same-tick recalculations have their own fill-time state (2027).
        let projectedSameSideTradeCount: number | undefined;
        if (strategy.config.calc_on_order_fills !== true) {
            let hasPendingMarketClose = false;
            for (const o of strategy.pending_orders) {
                if (isPendingMarketClose(o, context.idx)) {
                    hasPendingMarketClose = true;
                    break;
                }
            }

            if (hasPendingMarketClose) {
                const projectedTrades = strategy.opentrades.map((trade) => ({
                    id: trade.id,
                    entry_id: trade.entry_id,
                    size: trade.size,
                }));

                // Entries fill before exits, matching processStrategyOrders →
                // processExitOrders. Keep the replaced same-ID order out of
                // the projection, as currentSize does above.
                for (let i = 0; i < strategy.pending_orders.length; i++) {
                    if (i === pendingIndex) continue;
                    const o = strategy.pending_orders[i];
                    if (o.bar !== context.idx || o.category !== 'entry' || o.type !== 'market') continue;

                    const direction = parseDirection(o.direction);
                    let remainingQty = o.qty;
                    for (const trade of projectedTrades) {
                        if (remainingQty <= 0 || Math.sign(trade.size) === 0 || Math.sign(trade.size) === direction) continue;
                        const tradeQty = Math.abs(trade.size);
                        const qtyToClose = Math.min(tradeQty, remainingQty);
                        trade.size -= Math.sign(trade.size) * qtyToClose;
                        remainingQty -= qtyToClose;
                    }
                    if (remainingQty > 0) {
                        projectedTrades.push({
                            id: `__pending_entry_${i}`,
                            entry_id: o.id,
                            size: direction * remainingQty,
                        });
                    }
                }

                // Apply each close snapshot once. A quantity smaller than a
                // lot leaves that activation alive; only a fully consumed lot
                // releases a pyramiding slot.
                for (const o of strategy.pending_orders) {
                    if (!isPendingMarketClose(o, context.idx)) continue;

                    const intendedTradeIds = o._intended_trade_ids;
                    const matchingTrades = projectedTrades.filter(
                        (trade) =>
                            trade.size !== 0
                            && intendedTradeIds.includes(trade.id)
                            && (!o.from_entry || trade.entry_id === o.from_entry),
                    );
                    if (Math.sign(matchingTrades[0]?.size ?? 0) !== dir) continue;
                    const matchingQty = matchingTrades.reduce((sum, trade) => sum + Math.abs(trade.size), 0);
                    let qtyToClose = matchingQty;
                    if (o._explicit_qty_cap || (o.qty && o.qty > 0)) {
                        qtyToClose = Math.min(o.qty, matchingQty);
                    } else if (typeof o.qty_percent === 'number' && o.qty_percent > 0) {
                        qtyToClose = matchingQty * (o.qty_percent / 100);
                    }

                    for (const trade of matchingTrades) {
                        if (qtyToClose <= 0) break;
                        const tradeQty = Math.abs(trade.size);
                        const qtyClosed = Math.min(tradeQty, qtyToClose);
                        trade.size = qtyClosed >= tradeQty - 1e-9
                            ? 0
                            : trade.size - Math.sign(trade.size) * qtyClosed;
                        qtyToClose -= qtyClosed;
                    }
                }

                currentSize = projectedTrades.reduce((sum, trade) => sum + trade.size, 0);
                // The projected pyramiding count covers ONLY the trades
                // derived from opentrades (after the same-bar closes). The
                // synthetic __pending_entry_* rows added by same-bar market
                // ENTRY orders are not open activations — the parent counted
                // only opentrades — so they must not consume a pyramiding
                // slot; currentSize keeps them for the reversal/add
                // classification above.
                projectedSameSideTradeCount = projectedTrades.reduce(
                    (count, trade) => count
                        + (trade.id.startsWith('__pending_entry_') ? 0 : Math.sign(trade.size) === dir ? 1 : 0),
                    0,
                );
            }
        }

        // Pyramiding cap: only enforced when ADDING to a same-direction position
        // (not when opening from flat or reversing). Pine's semantic.
        const isAddingSameSide = Math.sign(currentSize) === dir && currentSize !== 0;
        const exceedsPyramiding = projectedSameSideTradeCount === undefined
            ? wouldExceedPyramiding(strategy, dir)
            : projectedSameSideTradeCount >= (strategy.config.pyramiding ?? 1);
        if (isAddingSameSide && pendingIndex < 0 && exceedsPyramiding) {
            return; // no-op
        }

        // A same-direction same-id replacement re-quantifies against the
        // position PROJECTED forward by the pending order it replaces: the
        // first call of a contiguous same-id pair already carries the close
        // qty in its order, so the later call sees the position AFTER that
        // order fills. 2121 (SAME_ID_PENDING_ENTRY_OVERTRADE): double LONG
        // at b39 with pos −15 — the first call queues a q30 reversal, the
        // replacement classifies against −15+30 = +15 (same side) and
        // submits the plain q15, which fills close-only at b40: TV books no
        // long lot, no overtrade. The engine's old in-place replacement kept
        // the first call's qty 30, booked the phantom lot (611 extras) and
        // got the next same-side entry rejected by the pyramiding cap (the
        // 186 TV-missing trades, e.g. TV LONG b431→432 @37.44).
        // The projection is disabled for EVERY strategy configured with
        // calc_on_order_fills=true — that strategy's own bar-close
        // evaluation included. With COF, the same-tick recalculation
        // re-emissions re-quantify against the position state at the fill
        // tick, and a forward projection double-counts the pending qty (2027:
        // certified ledger 811 rows keeps the full reversal qty 0.001115 on
        // the COF re-emission; projecting it shrank the order to 0.000571 and
        // booked 5 residual lots).
        // A phase-based guard (project when the live COF
        // context `context.strategy._cof` is null, i.e. at the COF close
        // evaluation) was implemented and measured: it breaks 2027 the same
        // way — 816 vs 811 rows, first divergence at bar 6 (size 0.000561 →
        // 0.000556 + a 0.000005 residue trade) — so the close evaluation of
        // a COF strategy must NOT be projected either. LIMITATION (2121
        // SAME_ID_PENDING_ENTRY_OVERTRADE): the same-id replacement pattern
        // under COF stays unfixed — no TV oracle capture exists for that
        // combination, so its correct close-evaluation semantics cannot be
        // decided; the config guard is empirical, not a stated rule.
        const cofMode = strategy.config.calc_on_order_fills === true;
        // A pending order from an earlier bar has not filled before this
        // refresh. Projecting it would make an inter-bar reversal appear
        // close-only (1858). The projection is only valid for a contiguous
        // same-bar replacement, where the replaced market order is ahead in
        // the queue and will fill before this call.
        const pendingIsSameBar = pendingIndex >= 0
            && strategy.pending_orders[pendingIndex].bar === context.idx;
        const qtySourceSize = !cofMode && pendingIndex >= 0 && !replacesPendingGroup && pendingIsSameBar
            ? currentSize + parseDirection(strategy.pending_orders[pendingIndex].direction) * strategy.pending_orders[pendingIndex].qty
            : currentSize;

        // Determine the order qty. For a reversal (direction differs from
        // current position), Pine ADDS the absolute current position to the
        // requested qty so that one market order both flattens the prior
        // position AND opens a new one of the requested qty.
        let defaultQtyType = strategy.config.default_qty_type ?? 'fixed';
        if (typeof defaultQtyType === 'function') defaultQtyType = (defaultQtyType as Function)();
        // A MARKET order created by a live calc_on_order_fills recalculation
        // is created — and therefore sized (VIN-C) — at the assumed intrabar
        // tick that recalculation stands on; every other placement uses the
        // signal bar's close.
        const cofTick = stopValue === undefined && limitValue === undefined
            ? cofCurrentTick(strategy)
            : undefined;
        const currentPrice = cofTick !== undefined ? cofTick : Series.from(context.data.close).get(0);
        // VIN-B (1917/2594/2701): a DEFAULT percent_of_equity MARKET entry on
        // a crypto/spot symbol is sized on the displayed reference built by
        // cryptoMarketSizingPrice — signal close + directional slippage,
        // quantized to the displayed tick. A declared limit/stop level keeps
        // its raw VIN-89 sizing price, and stock / COF references are
        // untouched (the helper is a no-op outside its scope).
        const usesDefaultPercentSizing = qtyValue === undefined && defaultQtyType === 'percent_of_equity';
        const sizingPrice = stopValue !== undefined
            ? stopValue
            : limitValue !== undefined
              ? limitValue
              : usesDefaultPercentSizing
                ? cryptoMarketSizingPrice(context, dir, currentPrice)
                : currentPrice;
        const baseQty = calculateOrderQty(context, qtyValue, dir, sizingPrice);

        // VIN-103: TV never submits an order whose calculated quantity is
        // not strictly positive. percent_of_equity / cash / fixed sizing can
        // truncate to 0 (1820: the fork books 9 size-0 FLAT lots that TV
        // never opens over 627 trades); a qty-0 reversal would additionally
        // mis-close the position. Drop the order entirely — no pending
        // order, no fill, no zero-size lot. `!(x > 0)` also refuses NaN.
        if (!(baseQty > 0)) return;

        const isReversal = qtySourceSize !== 0 && Math.sign(qtySourceSize) !== dir;
        const totalQty = isReversal ? Math.abs(qtySourceSize) + baseQty : baseQty;

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
                // TV modifies the pending order in place: the new spec
                // (type/levels/qty) replaces the old one and the order keeps
                // its queue position. The removed coexistence branch (flat +
                // pyramiding slot free + price change → stack another
                // same-ID pending) was the VIN-75 hypothesis; 2444 refutes
                // it — TV coalesced 5 same-ID stop resubmissions into the
                // last level and never booked the stale fills.
                strategy.pending_orders[pendingIndex] = orderObj;
            }
        }
    };
}
