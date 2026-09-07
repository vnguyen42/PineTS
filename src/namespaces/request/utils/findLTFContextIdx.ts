// SPDX-License-Identifier: AGPL-3.0-only

export function findLTFContextIdx(
    myOpenTime: number,
    myCloseTime: number,
    openTime: number[],
    closeTime: number[],
    lookahead: boolean = false,
    mainContextEDate?: number,
    gaps: boolean = false
): number {
    // Find the latest intrabar that is fully contained within the chart bar [myOpenTime, myCloseTime]
    for (let i = openTime.length - 1; i >= 0; i--) {
        if (closeTime[i] <= myCloseTime && openTime[i] >= myOpenTime) {
            // Found the last intrabar for this chart bar

            // Native VIN-174: lookahead_on selects the first intrabar on
            // historical chart bars too, independently of the gaps setting.
            if (lookahead) {
                for (let j = 0; j <= i; j++) {
                    if (openTime[j] >= myOpenTime && openTime[j] < myCloseTime) return j;
                }
            }

            return i;
        }

        // Optimization: if the bar closes before our bar opens, we went too far back
        if (closeTime[i] < myOpenTime) {
            break;
        }
    }

    return -1;
}
