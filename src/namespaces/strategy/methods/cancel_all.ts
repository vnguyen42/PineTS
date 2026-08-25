// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Order } from '../types';
import { Series } from '../../../Series';
import { parseArgsForPineParams } from '../../utils';

/**
 * Cancel all pending orders, including entries and exits (queued market
 * closes and conditional exits).
 *
 * Pine signature: strategy.cancel_all(when) → void
 *
 * `when` (series bool) gates the cancellation. Positional and transpiled
 * named-argument forms are both accepted (parseArgsForPineParams
 * conventions): `strategy.cancel_all(cond)` and
 * `strategy.cancel_all(when=cond)`. When `when` is false or na the call is
 * a complete no-op (evaluated before any mutation); when it is absent or
 * true, every pending entry and exit is cancelled — the historical
 * unconditional behavior.
 */
const CANCEL_ALL_SIGNATURES = [['when']];
const CANCEL_ALL_ARGS_TYPES = {
    when: 'series',
};

export function cancel_all(context: any) {
    return (...args: any[]) => {
        if (!context.strategy) {
            throw new Error('strategy.cancel_all() called before strategy() declaration');
        }
        const parsed = parseArgsForPineParams<any>(args, CANCEL_ALL_SIGNATURES, CANCEL_ALL_ARGS_TYPES);

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
        // Evaluate `when` BEFORE any mutation: false/na → complete no-op.
        const whenValue = Object.prototype.hasOwnProperty.call(parsed, 'when') ? extractValue(parsed.when) : true;
        if (!whenValue) return;

        context.strategy.pending_orders = context.strategy.pending_orders.filter(
            (o: Order) => !(o.status === 'pending' && (
                (o.category ?? 'entry') === 'entry' || (o.category ?? 'entry') === 'exit'
            )),
        );
    };
}
