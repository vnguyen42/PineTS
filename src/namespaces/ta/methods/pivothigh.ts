// SPDX-License-Identifier: AGPL-3.0-only

import { pivothigh as pivothighUtil } from '../utils/pivothigh';
import { Series } from '../../../Series';

export function pivothigh(context: any) {
    return (source: any, _leftbars: any, _rightbars: any, _callId?: string) => {
        //handle the case where source is not provided, in that case _rightbars will receive the _callId from the transpiler (a string value)
        if (typeof _rightbars === 'string') {
            _rightbars = _leftbars;
            _leftbars = source;
            _callId = _rightbars;

            //by default source is
            source = context.data.high;
        }
        const leftbars = Series.from(_leftbars).get(0);
        const rightbars = Series.from(_rightbars).get(0);

        const values = Series.from(source).toArray();
        const idx = context.idx;
        // VIN-156: the full-array helper recomputes every earlier pivot on each bar.
        // Keep its legacy behavior for unusual widths; evaluate only result[idx]
        // for normal Pine integer widths, including sparse/conditional histories.
        if (!Number.isInteger(leftbars) || !Number.isInteger(rightbars) || leftbars < 0 || rightbars < 0 || !Number.isInteger(idx)) {
            return context.precision(pivothighUtil(values, leftbars, rightbars)[idx]);
        }
        if (idx < 0 || idx >= values.length) return context.precision(undefined);
        if (idx < leftbars + rightbars) return context.precision(NaN);

        const pivot = values[idx - rightbars];
        for (let j = 1; j <= leftbars; j++) {
            if (values[idx - rightbars - j] > pivot) return context.precision(NaN);
        }
        for (let j = 1; j <= rightbars; j++) {
            if (values[idx - rightbars + j] >= pivot) return context.precision(NaN);
        }
        return context.precision(pivot);
    };
}
