// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';

export function sma(context: any) {
    return (source: any, _period: any, _callId?: string) => {
        const period = Series.from(_period).get(0);

        // Window mean recomputed each bar with a compensated (Neumaier) sum,
        // returned unrounded (SMA_EXACT_WINDOW). TradingView's ta.sma behaves
        // as the correctly rounded mean:
        //  - OKX:CROUSDT 240 (script 2701): ta.sma(ohlc4, 1)[3] equals the raw
        //    past ohlc4 0.059500000000000004 — no ta.crossover with the same
        //    current ohlc4; the former 10 dp context.precision (0.0595) and a
        //    rolling sum (sum + current − popped, drifting) fabricate it;
        //  - BINANCE:ICPUSDT 60 (script 2673), 2025-10-25 04:00: ta.sma(close,
        //    50) and ta.sma(close, 200) are both 3.072 — no cross that bar on
        //    TradingView — while a plain left-to-right sum of the 200 closes
        //    gives 3.0719999999999983 and fabricates a ta.crossover.
        if (!context.taState) context.taState = {};
        const stateKey = _callId || `sma_${period}`;

        if (!context.taState[stateKey]) {
            context.taState[stateKey] = {
                lastIdx: -1,
                // Committed state
                prevWindow: [],
                prevCallCount: 0,
                // Tentative state
                currentWindow: [],
                currentCallCount: 0,
            };
        }

        const state = context.taState[stateKey];

        // Commit logic
        if (context.idx > state.lastIdx) {
            if (state.lastIdx >= 0) {
                state.prevWindow = [...state.currentWindow];
                state.prevCallCount = state.currentCallCount;
            }
            state.lastIdx = context.idx;
        }

        const currentValue = Series.from(source).get(0);

        // TradingView ignores na source values: the average covers the last
        // `period` non-na values. An na bar returns na and leaves the window
        // untouched, so the next valid bar resumes on the same window.
        if (currentValue === undefined || currentValue === null || Number.isNaN(currentValue)) {
            return NaN;
        }

        // Use committed state
        const window = [...state.prevWindow];
        
        // Add current value to window
        window.unshift(currentValue);

        // Manage window size
        while (window.length > period) {
            window.pop();
        }

        // Track actual call count for callsite-correct backfill
        const callCount = state.prevCallCount + 1;

        // Backfill from source series when window is undersized.
        // Use both callCount (for top-level warmup) and context.idx
        // (for conditional/barstate.islast where chart has enough history).
        // The window keeps the values of its own calls; only the missing
        // tail is completed from the most recent NON-na past source values
        // (na are ignored, see above), after skipping as many of them as the
        // window already holds: reading a raw bar offset after skipped na
        // values would count a value twice or bridge a real gap. A source
        // whose history differs from the values passed (self-reference such
        // as `x := sma(x, n)`, NYSE:SQ 1613) contributes no na and the window
        // fills from its own calls, as before the na rule.
        if (window.length < period && (callCount >= period || context.idx >= period - 1)) {
            const series = Series.from(source);
            let alreadyHeld = window.length - 1;
            for (let i = 1; window.length < period && i < series.length; i++) {
                const v = series.get(i);
                if (v === undefined || v === null || Number.isNaN(v)) continue;
                if (alreadyHeld > 0) alreadyHeld--;
                else window.push(v);
            }
        }

        let sum = 0;
        let compensation = 0;
        for (let i = window.length - 1; i >= 0; i--) {
            const v = window[i];
            if (v === undefined || v === null || Number.isNaN(v)) {
                sum = NaN;
                break;
            }
            const next = sum + v;
            compensation += Math.abs(sum) >= Math.abs(v) ? (sum - next) + v : (v - next) + sum;
            sum = next;
        }
        sum += compensation;

        // Update tentative state
        state.currentWindow = window;
        state.currentCallCount = callCount;
        
        if (window.length < period) {
            return NaN;
        }

        return sum / period;
    };
}
