// SPDX-License-Identifier: AGPL-3.0-only

import { PineArrayObject } from '../PineArrayObject';
import { isValueOfType } from '../utils';
import { Context } from '../../../Context.class';

export function set(context: Context) {
    return (id: PineArrayObject, index: number, value: any) => {
        // A string key would write an arbitrary own property (`array.set(a,
        // "__proto__", v)` mutates the array's prototype chain, `"constructor"`
        // shadows it); Pine indices are numbers only. Reject as a clean script
        // error instead of a property write.
        if (typeof index !== 'number') {
            throw new TypeError(
                `Pine array indices must be numbers (got ${typeof index}); string-keyed access is not part of Pine.`,
            );
        }
        if (!isValueOfType(value, id.type)) {
            throw new Error(
                `Cannot call 'array.set' with argument 'value'='${value}'. An argument of 'literal ${typeof value}' type was used but a '${
                    id.type
                }' is expected.`
            );
        }
        // Pine Script v6: negative indices count backwards from the end.
        if (index < 0) index = id.array.length + index;
        if (index < 0 || index >= id.array.length) {
            context.warn(
                `Index ${index} is out of bounds, array size is ${id.array.length}.`,
                'array.set'
            );
            return;
        }
        id.array[index] = typeof value === 'number' ? context.precision(value) : value;
    };
}
