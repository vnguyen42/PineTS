// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

/**
 * Maximum (MAX)
 *
 * Returns the all-time high value of source from the beginning of the chart
 * up to the current bar.
 *
 * Reference (Pine Script v6 Reference, ta.max): "Returns the all-time high
 * value of source from the beginning of the chart up to the current bar."
 * Remarks: "na occurrences of source are ignored." — i.e. an na bar leaves
 * the running maximum unchanged; before the first non-na value the result is
 * na. Same semantics in v5 (script 1956 is a v5 source using ta.max).
 *
 * @param source - The data source to track
 * @returns The highest non-na value of source seen so far
 */
export function max(context: any) {
    return (source: any, _callId?: string) => {
        // Initialize state for cumulative calculation
        if (!context.taState) context.taState = {};
        const stateKey = _callId || 'max';

        if (!context.taState[stateKey]) {
            context.taState[stateKey] = {
                lastIdx: -1,
                // Committed state
                prevValue: null,
                // Tentative state
                currentValue: null,
            };
        }

        const state = context.taState[stateKey];

        // Commit logic
        if (context.idx > state.lastIdx) {
            if (state.lastIdx >= 0) {
                state.prevValue = state.currentValue;
            }
            state.lastIdx = context.idx;
        }

        const currentValue = Series.from(source).get(0);

        // Handle na input - na occurrences of source are ignored, the running
        // maximum stays at its committed value (no non-na value seen yet -> na).
        if (isNaN(currentValue) || currentValue === undefined) {
            state.currentValue = state.prevValue;
            return state.prevValue === null ? NaN : context.precision(state.prevValue);
        }

        // Track the maximum over non-na values from the first bar
        const next = state.prevValue === null ? currentValue : Math.max(state.prevValue, currentValue);

        // Update tentative state
        state.currentValue = next;

        return context.precision(next);
    };
}
