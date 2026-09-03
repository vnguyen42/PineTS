// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';
import { relationalTolerance } from '../relational-tolerance';

export function __eq(context: any) {
    return (a: any, b: any) => {
        // Unwrap Series
        const valA = Series.from(a).get(0);
        const valB = Series.from(b).get(0);

        // Strategy count getters (strategy.opentrades()/closedtrades()) return a
        // hybrid object whose scalar count is exposed via valueOf(). JS strict
        // equality (===) never invokes valueOf, so `strategy.opentrades() == 0`
        // was ALWAYS false regardless of the actual count. Normalize object
        // operands to their primitive first (non-hybrid objects keep their
        // identity via the default Object.prototype.valueOf, so the strict
        // fallback below behaves exactly as before for them).
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
            // Pine Script: any comparison with `na` evaluates to `na`, not false.
            // na propagates — use `na(x == y)` to test for it.
            if (isNaN(normalizedA) || isNaN(normalizedB)) return NaN;

            // TradingView treats values equal within the magnitude-relative
            // relational tolerance (1e-10 × max(|a|, |b|), capped at the
            // historical absolute 1e-10) as equal. Exact equality (a === b)
            // covers the tolerance 0 case (both operands ±0).
            return normalizedA === normalizedB || Math.abs(normalizedA - normalizedB) < relationalTolerance(normalizedA, normalizedB);
        }

        return normalizedA === normalizedB;
    };
}
