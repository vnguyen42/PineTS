// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

export function crossover(context: any) {
    return (source1: any, source2: any) => {
        const s1 = Series.from(source1);
        const s2 = Series.from(source2);

        // Stateless calculation (accesses past data via Series)
        const current1 = s1.get(0);
        const current2 = s2.get(0);
        if (!(current1 > current2)) return false;

        // TradingView: previous was at or below, current is strictly above.
        // Bars where either value is na are skipped: the previous point is
        // the most recent bar where both values are non-na.
        for (let j = 1, n = Math.min(s1.length, s2.length); j < n; j++) {
            const prev1 = s1.get(j);
            const prev2 = s2.get(j);
            if (!isNaN(prev1) && !isNaN(prev2)) return prev1 <= prev2;
        }
        return false;
    };
}
