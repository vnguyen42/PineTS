// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

/**
 * Value When
 *
 * Returns the value of the source series on the bar where the condition was true on the nth most recent occurrence.
 */
export function valuewhen(context: any) {
    return (condition: any, source: any, _occurrence: any, _callId?: string) => {
        if (!context.taState) context.taState = {};
        const stateKey = _callId || 'valuewhen';

        if (!context.taState[stateKey]) {
            context.taState[stateKey] = {
                lastIdx: -1,
                // Captured values: the first `committed` come from earlier bars, at most one more from
                // the current bar (tentative: redone on every evaluation of that bar). One array grown
                // in place: copying the whole history on every call made long runs quadratic.
                values: [],
                committed: 0,
            };
        }
        const state = context.taState[stateKey];

        // Commit logic
        if (context.idx > state.lastIdx) {
            state.committed = state.values.length;
            state.lastIdx = context.idx;
        }

        const cond = Series.from(condition).get(0);
        const val = Series.from(source).get(0);
        const occurrence = Series.from(_occurrence).get(0);

        // Committed values as base, plus this evaluation's capture
        const values: unknown[] = state.values;
        values.length = state.committed;
        if (cond) {
            values.push(val);
        }

        if (isNaN(occurrence) || occurrence < 0) {
            return NaN;
        }

        const index = values.length - 1 - occurrence;

        if (index < 0) {
            return NaN;
        }

        const result = values[index];

        // Return the memorized source value bit-for-bit. TradingView stores the
        // source value as-is and only rounds for display; rounding here to the
        // context precision (10 dp) manufactured artificial crossings at
        // equality boundaries — e.g. `1.0881399999999999` → `1.08814` made
        // `crossunder(close, valuewhen(...))` fire on the capture bar itself
        // instead of the next one (corpus ids 2014/2029,
        // VALUEWHEN_SOURCE_ROUNDED_10DP).
        return result;
    };
}
