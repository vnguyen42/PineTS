// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { calculateOrderQty, normalizeOrderLevel, parseDirection } from '../utils';
import { Order } from '../types';
import { Series } from '../../../Series';
import { parseArgsForPineParams } from '../../utils';

/**
 * Pine signature for strategy.order():
 *   strategy.order(id, direction, qty, limit, stop, oca_name, oca_type,
 *                  comment, alert_message, disable_alert) → void
 *
 * The transpiler emits Pine's named-arg form as a trailing options object,
 * e.g. `strategy.order("buy", strategy.long, qty=1)` becomes
 *      `strategy.order("buy", "long", {qty: 1})`.
 *
 * parseArgsForPineParams handles both the all-positional form
 *      strategy.order("buy", "long", 1)
 * AND the trailing-named-options form
 *      strategy.order("buy", "long", {qty: 1, limit: 100})
 * AND the all-named form
 *      strategy.order({id: "buy", direction: "long", qty: 1})
 * uniformly.
 */
const ORDER_SIGNATURES = [
    ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message', 'disable_alert', 'when'],
];

const ORDER_ARGS_TYPES = {
    id: 'string',
    // direction can be the literal 'long'/'short' string OR a series wrapper
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
 * Place a basic order.
 * Pine reference: https://www.tradingview.com/pine-script-reference/v5/#fun_strategy{dot}order
 */
export function order(context: any) {
    return (...args: any[]) => {
        if (!context.strategy) {
            throw new Error('strategy.order() called before strategy() declaration');
        }

        const parsed = parseArgsForPineParams<any>(args, ORDER_SIGNATURES, ORDER_ARGS_TYPES);

        // The transpiler may have already unwrapped Series via strategy.param,
        // but defensive extraction handles wrappers from any caller (e.g. when
        // users invoke strategy.order from a JS function).
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
        const directionVal  = extractValue(parsed.direction);
        const qtyValue      = extractValue(parsed.qty);
        const hasLimitLevel = Object.prototype.hasOwnProperty.call(parsed, 'limit') && parsed.limit !== undefined;
        const hasStopLevel  = Object.prototype.hasOwnProperty.call(parsed, 'stop') && parsed.stop !== undefined;
        const limitValue    = normalizeOrderLevel(extractValue(parsed.limit), hasStopLevel);
        const stopValue     = normalizeOrderLevel(extractValue(parsed.stop), hasLimitLevel);
        const ocaName       = extractValue(parsed.oca_name);
        const ocaType       = extractValue(parsed.oca_type);
        const commentValue  = extractValue(parsed.comment);

        // Parse direction to numeric (+1 long, -1 short)
        const dir = parseDirection(directionVal);

        // Reference price for qty conversion (cash / percent_of_equity sizing).
        // Market orders use the signal bar's close; price-based orders use
        // their declared execution level, which is the price TV uses when
        // locking the default quantity.
        const currentPrice = Series.from(context.data.close).get(0);
        const sizingPrice = stopValue !== undefined
            ? stopValue
            : limitValue !== undefined
              ? limitValue
              : currentPrice;
        const calculatedQty = calculateOrderQty(context, qtyValue, dir, sizingPrice);

        // VIN-103: TV never submits an order whose calculated quantity is
        // not strictly positive (fixed/cash/percent_of_equity sizing can
        // truncate to 0). Drop the order entirely — no pending order, no
        // fill, no zero-size lot. `!(x > 0)` also refuses NaN.
        if (!(calculatedQty > 0)) return;

        // Determine order type from which price levels are set.
        let orderType: 'market' | 'limit' | 'stop' | 'stop-limit' = 'market';
        if (limitValue !== undefined && stopValue !== undefined) {
            orderType = 'stop-limit';
        } else if (limitValue !== undefined) {
            orderType = 'limit';
        } else if (stopValue !== undefined) {
            orderType = 'stop';
        }

        const currentTime = Series.from(context.data.openTime).get(0);

        // VIN-95: a stop already beyond the signal bar's close at submission
        // is triggered and fills at the next admissible open (at the signal
        // bar's close for a current-bar stop under process_orders_on_close,
        // POC_CLOSE_MARKETABLE_STOP). Equality remains a stop crossing on
        // the next bar.
        const stopMarketable = orderType === 'stop'
            && stopValue !== undefined
            && ((dir === 1 && stopValue < currentPrice - 1e-12 * Math.max(1, Math.abs(currentPrice)))
                || (dir === -1 && stopValue > currentPrice + 1e-12 * Math.max(1, Math.abs(currentPrice))));

        const orderObj: Order = {
            id: idValue,
            direction: dir,
            qty: calculatedQty,
            type: orderType,
            limit: limitValue,
            stop: stopValue,
            bar: context.idx,
            time: currentTime,
            status: 'pending',
            oca_name: ocaName,
            oca_type: ocaType as 'cancel' | 'reduce' | 'none' | undefined,
            comment: commentValue,
            _stop_marketable: stopMarketable,
        };

        context.strategy.pending_orders.push(orderObj);

        return orderObj;
    };
}
