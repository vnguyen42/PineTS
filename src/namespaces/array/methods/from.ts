// SPDX-License-Identifier: AGPL-3.0-only

import { PineArrayObject, PineArrayType } from '../PineArrayObject';
import { inferArrayType } from '../utils';

export function from(context: any) {
    return (...values: any[]): PineArrayObject => {
        // Optional trailing type hint emitted by the transpiler for
        // `array.from(...)` calls whose arguments are ALL numeric literals:
        // Pine infers the element type from the literal forms (`0.` is float,
        // `0` is int), a distinction lost once the literals collapse to JS
        // numbers. The hint object carries that compile-time type so
        // `array.from(0., 0., …)` yields array<float> instead of the
        // mis-inferred array<int> (campaign cluster n=2, ids 1831/2388).
        let type: PineArrayType | undefined;
        const last = values[values.length - 1];
        if (
            last &&
            typeof last === 'object' &&
            !Array.isArray(last) &&
            Object.keys(last).length === 1 &&
            (last.__pineTypeHint === 'int' || last.__pineTypeHint === 'float')
        ) {
            type = last.__pineTypeHint;
            values = values.slice(0, -1);
        }
        return new PineArrayObject([...values], type ?? inferArrayType(values), context);
    };
}
