// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

/**
 * Minimum (MIN)
 *
 * Returns the all-time low value of source from the beginning of the chart
 * up to the current bar.
 *
 * Reference (Pine Script v6 Reference, ta.min): "Returns the all-time low
 * value of source from the beginning of the chart up to the current bar."
 * Remarks: "na occurrences of source are ignored." — i.e. an na bar leaves
 * the running minimum unchanged; before the first non-na value the result is
 * na. Same semantics in v5 (symmetric twin of ta.max).
 *
 * @param source - The data source to track
 * @returns The lowest non-na value of source seen so far
 */
export function min(context: any) {
    return (source: any, _callId?: string) => {
        // Initialize state for cumulative calculation
        if (!context.taState) context.taState = {};
        const stateKey = _callId || 'min';

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
        // minimum stays at its committed value (no non-na value seen yet -> na).
        if (isNaN(currentValue) || currentValue === undefined) {
            state.currentValue = state.prevValue;
            return state.prevValue === null ? NaN : context.precision(state.prevValue);
        }

        // Track the minimum over non-na values from the first bar
        const next = state.prevValue === null ? currentValue : Math.min(state.prevValue, currentValue);

        // Update tentative state
        state.currentValue = next;

        return context.precision(next);
    };
}
