// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';
import { relationalTolerance } from '../relational-tolerance';

/**
 * Pine Script na-aware inequality comparison.
 *
 * In Pine Script, any comparison involving `na` evaluates to `na` (NOT a
 * usable boolean) — verified against TradingView (`na(na != na)` is `true`):
 *   na != na   → na
 *   1  != na   → na
 *   na != 1    → na
 *
 * This cannot be implemented as `!__eq(a, b)`: `__eq(na, na)` is `na` and
 * `!na` would be `true` — wrong. Both `==` and `!=` must independently
 * propagate `na` when either operand is na. `na` is falsy, so branch/ternary
 * outcomes are unchanged; the difference is only observable via `na()`/`nz()`
 * or arithmetic on the result.
 */
export function __neq(context: any) {
    return (a: any, b: any) => {
        // Unwrap Series
        const valA = Series.from(a).get(0);
        const valB = Series.from(b).get(0);

        // Same normalization as __eq: strategy count getters return a hybrid
        // object (count via valueOf()); JS strict inequality (!==) never
        // invokes valueOf, so `strategy.opentrades() != 0` was ALWAYS true.
        const primA = valA != null && typeof valA === 'object' ? valA.valueOf() : valA;
        const primB = valB != null && typeof valB === 'object' ? valB.valueOf() : valB;

        // Pine compares booleans with finite numbers after casting the
        // boolean to its integer representation (false=0, true=1). Keep a
        // NaN/Infinity number on the strict fallback path: this preserves
        // the existing number/NaN behavior and the reference's mixed-na
        // behavior.
        const canCoerceBoolNumber =
            (typeof primA === 'boolean' && typeof primB === 'number' && Number.isFinite(primB)) ||
            (typeof primB === 'boolean' && typeof primA === 'number' && Number.isFinite(primA));
        const normalizedA = canCoerceBoolNumber && typeof primA === 'boolean' ? (primA ? 1 : 0) : primA;
        const normalizedB = canCoerceBoolNumber && typeof primB === 'boolean' ? (primB ? 1 : 0) : primB;

        if (typeof normalizedA === 'number' && typeof normalizedB === 'number') {
            // Pine Script: any comparison with `na` evaluates to `na`.
            if (isNaN(normalizedA) || isNaN(normalizedB)) return NaN;

            // TradingView treats values equal within the magnitude-relative
            // relational tolerance (1e-10 × max(|a|, |b|), capped at the
            // historical absolute 1e-10) as equal. Exact equality (a === b)
            // must stay unequal-free when the tolerance is 0 (both ±0).
            return normalizedA !== normalizedB && Math.abs(normalizedA - normalizedB) >= relationalTolerance(normalizedA, normalizedB);
        }

        return normalizedA !== normalizedB;
    };
}
