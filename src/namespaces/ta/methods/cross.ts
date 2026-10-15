// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

/**
 * Cross Detection
 *
 * Detects when two series cross each other (either direction).
 * Returns true if series1 crosses series2 (either above or below).
 *
 * Formula:
 * cross = (source1[0] > source2[0] && source1[1] <= source2[1]) ||
 *         (source1[0] < source2[0] && source1[1] >= source2[1])
 *
 * @param source1 - First data series
 * @param source2 - Second data series
 * @returns true if the series have crossed, false otherwise
 */
export function cross(context: any) {
    return (source1: any, source2: any, _callId?: string) => {
        const series1 = Series.from(source1);
        const series2 = Series.from(source2);

        // Stateless calculation (accesses past data via Series).
        // Same rule as ta.crossover / ta.crossunder (cross = either one):
        // the previous point is the most recent bar where both values are
        // non-na (script 1719).
        const current1 = series1.get(0);
        const current2 = series2.get(0);
        if (!(current1 > current2) && !(current1 < current2)) return false;

        for (let j = 1, n = Math.min(series1.length, series2.length); j < n; j++) {
            const prev1 = series1.get(j);
            const prev2 = series2.get(j);
            if (!isNaN(prev1) && !isNaN(prev2)) {
                return current1 > current2 ? prev1 <= prev2 : prev1 >= prev2;
            }
        }
        return false;
    };
}
