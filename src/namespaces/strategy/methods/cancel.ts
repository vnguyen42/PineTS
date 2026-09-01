// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Order } from '../types';
import { parseArgsForPineParams } from '../../utils';
import { resolveWhenGate } from '../utils';

/**
 * Cancel pending orders by id.
 *
 * Pine signature: strategy.cancel(id, when) → void  (v5: id, immediately)
 * Removes only PENDING orders whose `id` matches. Filled orders are untouched.
 * `immediately` is reserved (no-op for now — applies to broker-level behavior
 * not modeled here).
 *
 * `when` gate la suppression (false/na → no-op complet, évalué avant toute
 * mutation). Seule la forme NOMMÉE `strategy.cancel(id, when=cond)` est
 * acceptée — elle arrive par le sac d'arguments nommés du transpileur, hors
 * table de types. Le 2e slot POSITIONNEL reste `immediately` : `when` et
 * `immediately` sont tous deux booléens, donc positionnellement
 * indiscernables ; aucun script du corpus n'utilise la forme positionnelle.
 */
const CANCEL_SIGNATURES = [['id', 'immediately']];
const CANCEL_ARGS_TYPES = { id: 'string', immediately: 'boolean' };

export function cancel(context: any) {
    return (...args: any[]) => {
        if (!context.strategy) {
            throw new Error('strategy.cancel() called before strategy() declaration');
        }
        const parsed = parseArgsForPineParams<any>(args, CANCEL_SIGNATURES, CANCEL_ARGS_TYPES);
        if (!resolveWhenGate(parsed)) return;
        const targetId = parsed.id;
        if (targetId === undefined || targetId === null) return;

        context.strategy.pending_orders = context.strategy.pending_orders.filter(
            (o: Order) => !(o.status === 'pending' && o.id === targetId),
        );
    };
}
