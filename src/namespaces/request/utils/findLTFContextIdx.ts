// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Index of the intrabar a lower-timeframe `request.security` reads on the chart bar
 * [myOpenTime, myCloseTime]: the last intrabar fully inside it (lookahead off), or the first
 * one opening inside it (lookahead on), -1 when none. Intrabars are in time order, so both are
 * binary searches (a backward scan from the end made a run quadratic in its intrabars).
 */
export function findLTFContextIdx(
    myOpenTime: number,
    myCloseTime: number,
    openTime: number[],
    closeTime: number[],
    lookahead: boolean = false
): number {
    // Last intrabar closing by the chart bar's close.
    let lo = 0;
    let hi = closeTime.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (closeTime[mid] <= myCloseTime) lo = mid + 1;
        else hi = mid;
    }
    const last = lo - 1;
    // Earlier intrabars open earlier still: none is inside the chart bar.
    if (last < 0 || openTime[last] < myOpenTime) return -1;

    // Native VIN-174: lookahead_on selects the first intrabar on
    // historical chart bars too, independently of the gaps setting.
    if (lookahead) {
        lo = 0;
        hi = last + 1;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (openTime[mid] < myOpenTime) lo = mid + 1;
            else hi = mid;
        }
        if (openTime[lo] < myCloseTime) return lo;
    }

    return last;
}
