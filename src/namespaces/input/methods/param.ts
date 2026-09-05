// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

export function param(context: any) {
    return (source: any, index: number = 0) => {
        // Scalar defaults and metadata are already their current value.
        // Leave objects/arrays and history offsets to Series.from semantics.
        if (index === 0 && (source === null || (typeof source !== 'object' && typeof source !== 'function'))) return source;
        const val = Series.from(source).get(index);
        return val;
    };
}
