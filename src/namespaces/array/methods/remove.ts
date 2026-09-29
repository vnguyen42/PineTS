// SPDX-License-Identifier: AGPL-3.0-only

import { PineArrayObject } from '../PineArrayObject';

export function remove(context: any) {
    return (id: PineArrayObject, index: number): any => {
        // `splice` would coerce a string index to 0 and remove the wrong element;
        // Pine indices are numbers only. Reject as a clean script error.
        if (typeof index !== 'number') {
            throw new TypeError(
                `Pine array indices must be numbers (got ${typeof index}); string-keyed access is not part of Pine.`,
            );
        }
        // Pine Script v6: negative indices count backwards from the end.
        if (index < 0) index = id.array.length + index;
        if (index < 0 || index >= id.array.length) {
            context.warn(
                `Index ${index} is out of bounds, array size is ${id.array.length}.`,
                'array.remove'
            );
            return NaN;
        }
        return id.array.splice(index, 1)[0];
    };
}
