// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

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

        if (typeof primA === 'number' && typeof primB === 'number') {
            // Pine Script: any comparison with `na` evaluates to `na`, not false.
            // na propagates — use `na(x == y)` to test for it.
            if (isNaN(primA) || isNaN(primB)) return NaN;

            // TradingView treats values equal within an absolute 1e-10 tolerance.
            return Math.abs(primA - primB) < 1e-10;
        }

        return primA === primB;
    };
}
