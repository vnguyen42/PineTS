// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../../../Series';
import { getDatePartsInTimezone } from '../../Time';

/**
 * VWAP - Volume Weighted Average Price
 *
 * VWAP calculates the average price weighted by volume for a trading session.
 * It resets at the start of each new session (typically daily).
 *
 * Formula: VWAP = Σ(Price × Volume) / Σ(Volume)
 *
 * @param source - The price source (typically close, hlc3, or ohlc4)
 *
 * Note: This implementation resets VWAP at the start of each trading session
 * based on detecting new trading days (when openTime changes to a new day).
 */
export function vwap(context: any) {
    const makeState = () => ({
        lastIdx: -1,
        // Committed state
        prevCumulativePV: 0, // Cumulative price * volume
        prevCumulativeVolume: 0, // Cumulative volume
        prevLastSessionDate: null, // Track last session date
        // Tentative state
        currentCumulativePV: 0,
        currentCumulativeVolume: 0,
        currentLastSessionDate: null,
    });

    return (source: any, _callId?: string) => {
        // VWAP calculation using cumulative sums
        if (!context.taState) context.taState = {};

        // VIN-2651 — TV semantics: ta.vwap(source) is ONE series per source
        // (and symbol). Two call sites with the same source must share one
        // session accumulator. Under a per-callId key they diverge: in
        // `close > ta.vwap and close[1] < ta.vwap` the transpiled `&&`
        // short-circuits the second call site, so its accumulator only
        // aggregates the bars where the first site fired and resets its
        // session on its first evaluated bar of a new day — a partial-session
        // VWAP that differs from the first site. Key by the identity of the
        // source data buffer plus its history offset (close vs close[1] are
        // distinct sources in TV). A scalar source wraps a fresh buffer on
        // each call, so it keeps per-site state exactly like the callId did.
        const sourceSeries = Series.from(source);
        const buffer = sourceSeries.data;
        // VIN-2651 F1 — only sources that really carry a shared buffer may be
        // keyed by buffer identity. A scalar source (ternary/conditional, e.g.
        // `ta.vwap(na)` or `ta.vwap(cond ? x : y)`) wraps a FRESH array at
        // every call: under the buffer key its state would be recreated on
        // every bar (VWAP degrades to the current bar price — regression seen
        // in corpus scripts 1584/2770) and the Map grows by one entry per bar.
        // Fall back to the per-call-site _callId key, which keeps one session
        // accumulator per site, like the pre-2651 code.
        const hasSharedBuffer =
            source instanceof Series ||
            Array.isArray(source) ||
            (source != null && typeof source === 'object' && '__value' in source && source.__value instanceof Series);
        let state: any;
        if (hasSharedBuffer) {
            if (!context.taState.__vwapByBuffer) context.taState.__vwapByBuffer = new Map();
            let byOffset = context.taState.__vwapByBuffer.get(buffer);
            if (!byOffset) {
                byOffset = new Map();
                context.taState.__vwapByBuffer.set(buffer, byOffset);
            }
            state = byOffset.get(sourceSeries.offset);
            if (!state) {
                state = makeState();
                byOffset.set(sourceSeries.offset, state);
            }
        } else {
            const stateKey = _callId || `vwap`;
            if (!context.taState[stateKey]) {
                context.taState[stateKey] = makeState();
            }
            state = context.taState[stateKey];
        }

        // Commit logic
        if (context.idx > state.lastIdx) {
            if (state.lastIdx >= 0) {
                state.prevCumulativePV = state.currentCumulativePV;
                state.prevCumulativeVolume = state.currentCumulativeVolume;
                state.prevLastSessionDate = state.currentLastSessionDate;
            }
            state.lastIdx = context.idx;
        }

        // Get current values
        const currentPrice = Series.from(source).get(0);
        const currentVolume = Series.from(context.data.volume).get(0);

        // Get current bar's open time to detect session changes
        const currentOpenTime = Series.from(context.data.openTime).get(0);

        // Detect new session (new trading day) using exchange timezone
        const timezone = context.pine?.syminfo?.timezone || 'UTC';
        const parts = getDatePartsInTimezone(currentOpenTime, timezone);
        const currentSessionDate = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;

        // Use committed state
        let cumulativePV = state.prevCumulativePV;
        let cumulativeVolume = state.prevCumulativeVolume;
        let lastSessionDate = state.prevLastSessionDate;

        // Reset VWAP at the start of a new session
        if (lastSessionDate !== currentSessionDate) {
            cumulativePV = 0;
            cumulativeVolume = 0;
            lastSessionDate = currentSessionDate;
        }

        // Update cumulative values
        cumulativePV += currentPrice * currentVolume;
        cumulativeVolume += currentVolume;

        // Store tentative state
        state.currentCumulativePV = cumulativePV;
        state.currentCumulativeVolume = cumulativeVolume;
        state.currentLastSessionDate = lastSessionDate;

        // Calculate VWAP
        if (cumulativeVolume === 0) {
            return NaN;
        }

        const vwap = cumulativePV / cumulativeVolume;
        return context.precision(vwap);
    };
}
