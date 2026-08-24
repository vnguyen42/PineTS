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

    // Exact aliases must win: uppercase '1M' is one month while lowercase
    // '1m' is one minute. This is deliberately case-sensitive.
    if (TIMEFRAME_MAP[tf] !== undefined) return TIMEFRAME_MAP[tf];

    // Preserve uppercase multi-unit calendar forms before looking at the
    // lowercase aliases: '3M'.toLowerCase() is '3m', which is a minute alias.
    // Multiplier-one D/W forms retain their pre-existing canonical collapse
    // ('1D' → 'D', '1W' → 'W') so N=1 control series stay byte-identical.
    const multiUpper = /^(\d+)([DWM])$/.exec(tf);
    if (multiUpper && multiUpper[1] !== '1') {
        return multiUpper[1] + multiUpper[2];
    }

    // Lowercase aliases cover the established minute map ('3m' → '3') and
    // hour/day/week spellings. Lowercase m is always the minute convention;
    // uppercase M (handled above) is the month convention.
    const lower = tf.toLowerCase();
    if (TIMEFRAME_MAP[lower] !== undefined) return TIMEFRAME_MAP[lower];

    // Handle lowercase single letters ('d' → 'D', 'w' → 'W', 'm' → 'M').
    const upper = tf.toUpperCase();
    if (TIMEFRAMES.includes(upper)) return upper;

    // Preserve the seconds spellings used by the timeframe namespace. Seconds
    // are not servable by timeframeToMinutes(), but their canonical spelling
    // remains useful for timeframe.period / timeframe.in_seconds().
    if (upper === 'S') return upper;
    const seconds = /^(\d+)S$/i.exec(tf);
    if (seconds) return seconds[1] + 'S';

    // Calendar day/week multipliers are case-insensitive ('2d' ≡ '2D',
    // '2w' ≡ '2W'). Do not include m: lowercase m means minutes.
    const multiDayWeek = /^(\d+)([DW])$/i.exec(tf);
    if (multiDayWeek) return multiDayWeek[1] + multiDayWeek[2].toUpperCase();

    // Generic lowercase-minute spellings not present in the legacy alias map
    // remain plain integer minutes ('2m' → '2'); unsupported minute values are
    // rejected later by timeframeToMinutes().
    const multiMinute = /^(\d+)m$/.exec(tf);
    if (multiMinute) return multiMinute[1];

    // Return as-is (will fail validity check and throw Error)
    return tf;
}

// Duration in minutes of the calendar timeframes, used for LTF/HTF ordering.
// Intraday minute timeframes are the plain integer themselves (no unit letter).
const CALENDAR_MINUTES: Record<string, number> = { D: 1440, W: 10080, M: 43200 };

// TradingView "Timeframes" docs: timeframe strings are multiplier + unit.
// Calendar units accept multipliers within the documented ranges:
//   days 1-365, weeks 1-52, months 1-12 (e.g. '2D', '3D', '3W', '3M', '12M').
// '1D'/'1W'/'1M' are already collapsed to D/W/M by normalizeTimeframe().
const MULTI_CALENDAR_MAX: Record<string, number> = { D: 365, W: 52, M: 12 };

// Shape of a multiplier+calendar-unit timeframe ('2D', '12M', '0D', …).
const CALENDAR_FORM = /^(\d+)([DWM])$/;

export interface CalendarMultiplier {
    n: number;
    unit: 'D' | 'W' | 'M';
}

/**
 * Parse the multiplier+unit of a calendar timeframe — THE single source of
 * truth for the calendar parse AND its documented TradingView bounds
 * (days 1-365, weeks 1-52, months 1-12). Consumed by timeframeToMinutes()
 * (request.security) and by alignToTimeframe() (time / timeframe.change);
 * both must agree, hence the shared home.
 *
 * Returns null for anything that is not a valid calendar form: non-calendar
 * timeframes ('240', '30S') AND calendar forms with an out-of-bounds
 * multiplier ('370D', '0D', '53W', '13M'). Callers that need to tell the
 * two apart use isCalendarForm() first.
 */
export function parseCalendarMultiplier(tf: string): CalendarMultiplier | null {
    const m = CALENDAR_FORM.exec(tf);
    if (m === null) return null;
    const n = parseInt(m[1], 10);
    const unit = m[2] as CalendarMultiplier['unit'];
    if (n < 1 || n > MULTI_CALENDAR_MAX[unit]) return null;
    return { n, unit };
}

/** True when tf has the multiplier+calendar-unit shape ('2D', '12M', '0D', …). */
export function isCalendarForm(tf: string): boolean {
    return CALENDAR_FORM.test(tf);
}

function multiCalendarMinutes(normalized: string): number | null {
    const cal = parseCalendarMultiplier(normalized);
    if (cal === null) return null;
    return cal.n * CALENDAR_MINUTES[cal.unit];
}

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
 * "720" = 12h, "1440" = 24h); D/W/M are calendar periods; multi-unit calendar
 * forms ('2D', '3W', '12M', …) resolve to N × the unit's duration within the
 * documented multiplier ranges (days 1-365, weeks 1-52, months 1-12). Only
 * the minute timeframes the data layer can actually serve are accepted; any
 * other multiplier (e.g. '90', '100') is rejected. LTF/HTF ordering compares
 * these durations.
 */
export function timeframeToMinutes(tf: string): number | null {
    const normalized = normalizeTimeframe(tf);
    if (CALENDAR_MINUTES[normalized] !== undefined) return CALENDAR_MINUTES[normalized];
    const multi = multiCalendarMinutes(normalized);
    if (multi !== null) return multi;
    if (SERVABLE_MINUTES.has(normalized)) return parseInt(normalized, 10);
    return null;
}
