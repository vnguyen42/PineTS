// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

export function ema(context: any) {
    return (source: any, _period: any, _callId?: string) => {
        const period = Series.from(_period).get(0);

        // Incremental EMA calculation
        if (!context.taState) context.taState = {};
        const stateKey = _callId || `ema_${period}`;

        // Initialize state structure
        if (!context.taState[stateKey]) {
            context.taState[stateKey] = {
                lastIdx: -1,
                // Committed state (from end of lastIdx-1)
                prevEma: null,
                prevInitSum: 0,
                prevInitCount: 0,
                // Tentative state (for current lastIdx)
                currentEma: null,
                currentInitSum: 0,
                currentInitCount: 0,
            };
        }

        const state = context.taState[stateKey];

        // Check if we moved to a new bar index
        if (context.idx > state.lastIdx) {
            // Commit the tentative state from the previous bar to be the new "prev" state
            if (state.lastIdx >= 0) {
                state.prevEma = state.currentEma;
                state.prevInitSum = state.currentInitSum;
                state.prevInitCount = state.currentInitCount;
            }
            state.lastIdx = context.idx;
        }
        // A call site executed again within the same bar run (a loop body)
        // continues from its previous call, as TradingView does: CME_MINI:NQ1!
        // 120 (script 2539), `ta.ema(close, L)` for L = 1..21 in a `for`
        // loop — chaining reproduces TV's plotted ratio on 20916/20916 bars,
        // restarting each call from the previous bar's state on none. A new
        // run of the same bar (live re-execution) gets a new _execTick and
        // restarts from the committed state.
        const tick = context._execTick || 0;
        const chained = state.lastTick === tick;
        state.lastTick = tick;

        const currentValue = Series.from(source).get(0);

        if (currentValue === null || currentValue === undefined || isNaN(currentValue)) {
            return NaN;
        }

        // Use 'prev' variables for calculation to ensure stability during live updates
        // We calculate 'current' values but DO NOT overwrite 'prev' values yet
        let initCount = chained ? state.currentInitCount : state.prevInitCount;
        let initSum = chained ? state.currentInitSum : state.prevInitSum;
        let prevEma = chained ? state.currentEma : state.prevEma;

        if (initCount < period) {
            // Accumulate for SMA initialization
            initSum += currentValue;
            initCount++;

            // Store tentative state
            state.currentInitSum = initSum;
            state.currentInitCount = initCount;

            if (initCount === period) {
                const ema = initSum / period;
                state.currentEma = ema;
                return context.precision(ema);
            }
            return NaN;
        }

        // Calculate EMA incrementally: EMA = alpha * current + (1 - alpha) * prevEMA
        const alpha = 2 / (period + 1);
        const ema = currentValue * alpha + prevEma * (1 - alpha);

        // Store tentative result
        state.currentEma = ema;

        return context.precision(ema);
    };
}
