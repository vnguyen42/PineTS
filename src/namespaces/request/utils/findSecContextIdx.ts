// SPDX-License-Identifier: AGPL-3.0-only

/** Leading length of each time array already checked non-decreasing (-1: it is not). Bar arrays only grow. */
const checkedLength = new WeakMap<number[], number>();

function nonDecreasing(values: number[]): boolean {
    const known = checkedLength.get(values) ?? 0;
    if (known < 0) return false;
    for (let i = Math.max(1, known); i < values.length; i++) {
        if (!(values[i - 1] <= values[i])) {
            checkedLength.set(values, -1);
            return false;
        }
    }
    checkedLength.set(values, values.length);
    return true;
}

/**
 * Smallest i with openTime[i] <= time < closeTime[i], or -1. On sorted bar times (the normal case) two
 * binary searches replace the scan from the first bar, which made every request.security call
 * O(secondary bars) per chart bar.
 */
function firstContaining(time: number, openTime: number[], closeTime: number[]): number {
    if (openTime.length === closeTime.length && nonDecreasing(openTime) && nonDecreasing(closeTime)) {
        // Candidates: the prefix whose openTime <= time; among them, the first whose closeTime > time.
        let lo = 0;
        let hi = openTime.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (openTime[mid] <= time) lo = mid + 1;
            else hi = mid;
        }
        const end = lo;
        lo = 0;
        hi = end;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (closeTime[mid] > time) hi = mid;
            else lo = mid + 1;
        }
        return lo < end ? lo : -1;
    }
    for (let i = 0; i < openTime.length; i++) {
        if (openTime[i] <= time && time < closeTime[i]) return i;
    }
    return -1;
}

export function findSecContextIdx(
    myOpenTime: number,
    myCloseTime: number,
    openTime: number[],
    closeTime: number[],
    lookahead: boolean = false,
    isRealtime: boolean = false
): number {
    // Match based on where the LTF bar opens, not requiring full containment.
    // This handles bars that straddle HTF boundaries (e.g. a weekly bar that
    // opens in July but closes in August).
    const i = firstContaining(myOpenTime, openTime, closeTime);
    if (i < 0) return -1;
    if (lookahead) {
        return i;
    }
    // For lookahead=false (default):
    // If the HTF bar is closed (myCloseTime >= closeTime[i]), we can use its value (i).
    // If the HTF bar is still open, we must use the previous bar (i-1) to avoid future leak.
    // Exception: on the realtime (last) bar, TradingView returns the current developing
    // HTF values (i) — lookahead_off only prevents future leak on historical bars.
    if (isRealtime) {
        return i;
    }
    return myCloseTime >= closeTime[i] ? i : i - 1;
}

/** Last i with values[i] <= time on non-decreasing values (binary search), else -1. */
function lastAtOrBefore(time: number, values: number[]): number {
    if (!nonDecreasing(values)) {
        for (let i = values.length - 1; i >= 0; i--) if (values[i] <= time) return i;
        return -1;
    }
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (values[mid] <= time) lo = mid + 1;
        else hi = mid;
    }
    return lo - 1;
}

/**
 * Strict-lookahead alignment of ANOTHER symbol (same or higher timeframe), whose bars need not
 * line up with the chart's (other sessions, weekends, half-days, a series that starts late or
 * ends early). No future information by construction:
 * - lookahead off: the last secondary bar CLOSED by the chart bar's close (closeTime <= myCloseTime),
 *   held over secondary gaps (a stock's weekend seen from a coin chart);
 * - lookahead on: the last secondary bar OPENED by the chart bar's open (openTime <= myOpenTime),
 *   only reached for expressions known at that bar's open (`open`, `time`, `x[n]` with n >= 1),
 *   which the strict guard enforces first.
 * -1 (na) when there is no such bar (secondary data starting after the chart bar).
 */
export function findOtherSymbolIdx(
    myOpenTime: number,
    myCloseTime: number,
    openTime: number[],
    closeTime: number[],
    lookahead: boolean,
): number {
    return lookahead ? lastAtOrBefore(myOpenTime, openTime) : lastAtOrBefore(myCloseTime, closeTime);
}
