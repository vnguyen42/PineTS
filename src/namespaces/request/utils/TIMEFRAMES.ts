// SPDX-License-Identifier: AGPL-3.0-only

import { TIMEFRAME_SECONDS } from '../../../marketData/types';

//Pine Script Timeframes (canonical format: minutes as integers, D/W/M for day/week/month)
export const TIMEFRAMES = ['1', '3', '5', '15', '30', '45', '60', '120', '180', '240', 'D', 'W', 'M'];

/**
 * Normalize a timeframe string to the canonical Pine Script format used in TIMEFRAMES.
 * Handles common formats like '1h', '4h', '1d', '1w', '1D', '1W', '1M', etc.
 */
const TIMEFRAME_MAP: Record<string, string> = {
    '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '45m': '45',
    '1h': '60', '2h': '120', '3h': '180', '4h': '240',
    '1d': 'D', '1w': 'W', '1M': 'M',
};

export function normalizeTimeframe(tf: string): string {
    // Already canonical?
    if (TIMEFRAMES.includes(tf)) return tf;

    // Try direct map (case-sensitive first for '1M')
    if (TIMEFRAME_MAP[tf]) return TIMEFRAME_MAP[tf];

    // Try lowercase (handles '1H', '4H', '1D', '1W', etc.)
    const lower = tf.toLowerCase();
    if (TIMEFRAME_MAP[lower]) return TIMEFRAME_MAP[lower];

    // Handle uppercase single letters ('d' → 'D', 'w' → 'W', 'm' → 'M')
    const upper = tf.toUpperCase();
    if (TIMEFRAMES.includes(upper)) return upper;

    // Return as-is (will fail validity check and throw Error)
    return tf;
}

// Duration in minutes of the calendar timeframes, used for LTF/HTF ordering.
// Intraday minute timeframes are the plain integer themselves (no unit letter).
const CALENDAR_MINUTES: Record<string, number> = { D: 1440, W: 10080, M: 43200 };

// Minute timeframes the aggregation layer can actually serve: the integer keys
// of TIMEFRAME_SECONDS (1/3/5/15/30/45/60/120/180/240/360/480/720/1440).
// Deriving from TIMEFRAME_SECONDS keeps "accepted ⇒ servable" true by
// construction — a legal-but-unserved multiplier (e.g. '90') is rejected here
// and fails with the clean "Invalid timeframe" error instead of silently
// degrading to NaN in the aggregation path.
const SERVABLE_MINUTES = new Set(
    Object.keys(TIMEFRAME_SECONDS).filter((k) => /^\d+$/.test(k)),
);

/**
 * Resolve a timeframe string to its duration in minutes, or null when it is
 * not a valid, servable Pine Script timeframe.
 *
 * TradingView semantics ("Timeframes" docs): intraday minute timeframes are
 * written as a plain integer with no unit letter ("360" = 6h, "480" = 8h,
 * "720" = 12h, "1440" = 24h); D/W/M are calendar periods. Only the minute
 * timeframes the data layer can actually serve are accepted; any other
 * multiplier (e.g. '90', '100') is rejected. LTF/HTF ordering compares these
 * durations.
 */
export function timeframeToMinutes(tf: string): number | null {
    const normalized = normalizeTimeframe(tf);
    if (CALENDAR_MINUTES[normalized] !== undefined) return CALENDAR_MINUTES[normalized];
    if (SERVABLE_MINUTES.has(normalized)) return parseInt(normalized, 10);
    return null;
}
