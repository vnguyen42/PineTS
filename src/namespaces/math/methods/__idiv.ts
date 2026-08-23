// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

/**
 * Pine's legacy integer division for v4/v5 const-int expressions. The
 * transpiler emits this helper only for two operands proven to be both `const
 * int`; input/simple/series integers and all v6 divisions remain native `/`.
 * The helper truncates toward zero (`11 / 2 === 5`, `-11 / 2 === -5`),
 * whereas JavaScript `/` is always fractional.
 *
 * The compile-time qualifier gate lives in TypeInferencePass. Any float,
 * non-const qualifier, unknown value, v6 operand, or version-less expression
 * keeps native `/`.
 *
 * Semantics:
 * - `na` (NaN) in either operand propagates → NaN.
 * - Division by zero follows the same rule as native `/`: `Math.trunc` preserves
 *   `1 / 0 → Infinity` and `0 / 0 → NaN`, matching PineTS's existing div-by-zero
 *   behavior (truncation only changes finite results).
 * - Non-numeric operands fall back to native `/` (defensive; should not occur
 *   given the compile-time int guard).
 */
export function __idiv(context: any) {
    return (a: any, b: any) => {
        const valA = Series.from(a).get(0);
        const valB = Series.from(b).get(0);

        if (typeof valA !== 'number' || typeof valB !== 'number') {
            return valA / valB;
        }
        if (isNaN(valA) || isNaN(valB)) return NaN;
        return Math.trunc(valA / valB);
    };
}
