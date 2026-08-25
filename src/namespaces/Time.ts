// SPDX-License-Identifier: AGPL-3.0-only

import { Series } from '../Series';
import { parseArgsForPineParams } from './utils';
import { normalizeTimeframe, parseCalendarMultiplier, isCalendarForm } from './request/utils/TIMEFRAMES';

export { normalizeTimeframe };

// ── Timeframe alignment utilities ───────────────────────────────────

/**
 * Compute the opening timestamp of the higher-timeframe bar that contains the given timestamp.
 *
 * Calendar timeframes honor the multiplier (TradingView "Timeframes" docs):
 * '2D'/'3W'/'12M' bucket N calendar units together, 'D'/'W'/'M' are N=1.
 *
 * ⚠ ANCRE DES BUCKETS — hypothèse documentée, NON vérifiée par oracle : la
 * LONGUEUR d'une période N-unités est documentée par TV, mais l'ANCRE de
 * phase n'a aucun oracle — aucune capture TV n'exerce les multi-unités.
 * Implémentation retenue (décision actée) :
 *   - 'ND' : buckets de N jours ancrés à l'epoch UTC (dayIndex = floor(t/86400000),
 *            bucketStart = floor(dayIndex/N)*N) ;
 *   - 'NW' : buckets de N semaines ISO ancrés lundi (semaineIndex ancrée sur le
 *            lundi epoch 1970-01-05, semaineIndex = floor((dayIndex-4)/7)) ;
 *   - 'NM' : buckets de N mois calendaire (monthIndex = year*12+month,
 *            bucketStart = floor(monthIndex/N)*N).
 * À épingler par une capture TV dédiée si un script réel en dépend pour
 * trader (référence : le seul consommateur corpus 2123 a son con1 mort par
 * le bug séparé des args nommés ta.change — aucun script vivant ne dépend
 * encore de l'ancre). N=1 reproduit EXACTEMENT le comportement antérieur
 * ('D'/'W'/'M' et '1D'/'1W'/'1M' — zéro régression, les témoins en dépendent).
 *
 * For intraday TFs (minutes): floor to the nearest multiple of the TF duration within the day.
 */
export function alignToTimeframe(timestamp: number, tf: string): number {
    const MS_MIN = 60_000;
    const MS_DAY = 86_400_000;

    // Calendar multiplier+unit — single source of truth for the calendar parse
    // and its bounds (TIMEFRAMES.ts, shared with request.security). 'D'/'W'/'M'
    // carry no multiplier (N=1); non-calendar timeframes ('240', '30S') fall
    // through to the minute path. Out-of-bounds calendar forms ('370D', '0D')
    // yield NaN — callers validate first (time() throws, timeframe.change()
    // returns false).
    if (isCalendarForm(tf) && parseCalendarMultiplier(tf) === null) return NaN;
    const cal = parseCalendarMultiplier(tf);
    const unit = cal === null ? tf.slice(-1).toUpperCase() : cal.unit;
    const n = cal === null ? 1 : cal.n;

    if (unit === 'M') {
        // Buckets of N calendar months: monthIndex = year*12+month, floor(monthIndex/N)*N
        const d = new Date(timestamp);
        const monthIndex = d.getUTCFullYear() * 12 + d.getUTCMonth();
        const bucketMonth = Math.floor(monthIndex / n) * n;
        return Date.UTC(Math.floor(bucketMonth / 12), bucketMonth % 12, 1);
    }

    if (unit === 'W') {
        // Buckets of N ISO weeks anchored on Monday epoch 1970-01-05 (dayIndex 4)
        const dayIndex = Math.floor(timestamp / MS_DAY);
        const weekIndex = Math.floor((dayIndex - 4) / 7);
        const bucketWeek = Math.floor(weekIndex / n) * n;
        return (4 + bucketWeek * 7) * MS_DAY;
    }

    const tfMinutes = parseMinuteTimeframe(tf);
    if (unit === 'D' || tfMinutes >= 1440) {
        // Buckets of N days anchored to the UTC epoch: dayIndex = floor(t/86400000),
        // bucketStart = floor(dayIndex/N)*N
        const dayIndex = Math.floor(timestamp / MS_DAY);
        return Math.floor(dayIndex / n) * n * MS_DAY;
    }

    // Intraday: floor to the nearest multiple of the TF duration
    // Align relative to the start of the UTC day
    const tfMs = tfMinutes * MS_MIN;
    const dayStart = Math.floor(timestamp / MS_DAY) * MS_DAY;
    const elapsed = timestamp - dayStart;
    const alignedElapsed = Math.floor(elapsed / tfMs) * tfMs;
    return dayStart + alignedElapsed;
}

/**
 * Minute duration of a NON-calendar timeframe: plain minute integers ("5",
 * "60", "240", "1440") and loose forms ("30S" → 30 — seconds are not
 * separately served; kept as the pre-existing fallback). Calendar forms
 * ('D'/'W'/'M'/'2D'/'3W'/'12M') are parsed by parseCalendarMultiplier();
 * this fallback is only reached when the calendar parse returned null.
 */
function parseMinuteTimeframe(tf: string): number {
    const n = parseInt(tf, 10);
    return isNaN(n) ? 1440 : n;
}

// ── Shared timezone utility ──────────────────────────────────────────

interface DateParts {
    year: number;
    month: number; // 1-12
    day: number; // 1-31
    hour: number; // 0-23
    minute: number; // 0-59
    second: number; // 0-59
    dayOfWeek: number; // JS convention: 0=Sun, 1=Mon, ..., 6=Sat
}

/**
 * Decompose a UTC-millisecond timestamp into calendar parts
 * interpreted in the given timezone.
 */
export function getDatePartsInTimezone(timestamp: number, timezone: string): DateParts {
    const tzNorm = timezone.trim();

    // Fast path: plain UTC / GMT / Etc/UTC
    if (tzNorm === 'UTC' || tzNorm === 'GMT' || tzNorm === 'Etc/UTC') {
        const d = new Date(timestamp);
        return {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
            hour: d.getUTCHours(),
            minute: d.getUTCMinutes(),
            second: d.getUTCSeconds(),
            dayOfWeek: d.getUTCDay(),
        };
    }

    // UTC/GMT offset notation: "UTC+5", "GMT-03:30", etc.
    const offsetMatch = tzNorm.match(/^(?:UTC|GMT)([+-])(\d{1,2})(?::(\d{2}))?$/i);
    if (offsetMatch) {
        const sign = offsetMatch[1] === '+' ? 1 : -1;
        const offsetHours = parseInt(offsetMatch[2], 10);
        const offsetMinutes = parseInt(offsetMatch[3] || '0', 10);
        const totalOffsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60 * 1000;
        const d = new Date(timestamp + totalOffsetMs);
        return {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
            hour: d.getUTCHours(),
            minute: d.getUTCMinutes(),
            second: d.getUTCSeconds(),
            dayOfWeek: d.getUTCDay(),
        };
    }

    // IANA timezone name — use Intl.DateTimeFormat
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
            weekday: 'short',
            hour12: false,
        });
        const parts = formatter.formatToParts(new Date(timestamp));
        const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);

        let hour = get('hour');
        if (hour === 24) hour = 0;

        const weekdayStr = parts.find((p) => p.type === 'weekday')?.value || 'Sun';
        const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

        return {
            year: get('year'),
            month: get('month'),
            day: get('day'),
            hour,
            minute: get('minute'),
            second: get('second'),
            dayOfWeek: dayMap[weekdayStr] ?? 0,
        };
    } catch {
        // Fallback to UTC on error
        const d = new Date(timestamp);
        return {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
            hour: d.getUTCHours(),
            minute: d.getUTCMinutes(),
            second: d.getUTCSeconds(),
            dayOfWeek: d.getUTCDay(),
        };
    }
}

// ── ISO week number helper ───────────────────────────────────────────

/**
 * ISO 8601 week number (1-53). Monday-start, week containing Jan 4th is week 1.
 */
export function getISOWeekNumber(year: number, month: number, day: number): number {
    const date = new Date(Date.UTC(year, month - 1, day));
    // Set to nearest Thursday: current date + 4 - current day number (Mon=1, Sun=7)
    const dayNum = date.getUTCDay() || 7; // Convert Sun=0 to Sun=7
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    // Get first day of year
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    // Calculate full weeks to nearest Thursday
    return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ── TimeHelper (moved from Core.ts) ─────────────────────────────────

//prettier-ignore
const TIME_SIGNATURES = [
    // time(timeframe)
    ['timeframe'],
    // time(timeframe, bars_back)
    ['timeframe', 'bars_back'],
    // time(timeframe, session, bars_back)
    ['timeframe', 'session', 'bars_back'],
    // time(timeframe, session, bars_back, timeframe_bars_back)
    ['timeframe', 'session', 'bars_back', 'timeframe_bars_back'],
    // time(timeframe, session, timezone, bars_back, timeframe_bars_back)
    ['timeframe', 'session', 'timezone', 'bars_back', 'timeframe_bars_back'],
];

//prettier-ignore
const TIME_ARGS_TYPES = {
    timeframe: 'string',
    session: 'string',
    timezone: 'string',
    bars_back: 'number',
    timeframe_bars_back: 'number',
};

/**
 * TimeHelper implements the dual-use `time` / `time_close` identifiers.
 * - Bare `time` → `time.__value` → openTime Series
 * - `time[1]` → `$.get(time.__value, 1)` → previous bar's time
 * - `time(timeframe)` → `time.any(timeframe)` → time function
 */
export class TimeHelper {
    private context: any;
    private dataField: string;

    constructor(context: any, dataField: string = 'openTime') {
        this.context = context;
        this.dataField = dataField;
    }

    get __value() {
        return this.context.data[this.dataField];
    }

    param(source: any, index: number = 0) {
        return Series.from(source).get(index);
    }

    any(...args: any[]) {
        const unwrapped = args.map((a) => (a instanceof Series ? a.get(0) : a));
        const parsed = parseArgsForPineParams<any>(unwrapped, TIME_SIGNATURES, TIME_ARGS_TYPES);

        const barsBack = parsed.bars_back ?? 0;
        const timeframe = parsed.timeframe || '';

        // Get the current bar's timestamp (with bars_back offset on the chart TF)
        const timeSeries = this.context.data[this.dataField];
        const currentTime = Series.from(timeSeries).get(barsBack);
        if (isNaN(currentTime) || currentTime == null) return NaN;

        // If timeframe is empty or matches the chart timeframe, return the bar's own time
        const chartTF = this.context.timeframe || '';
        const normalizedTF = normalizeTimeframe(timeframe);
        const normalizedChartTF = normalizeTimeframe(chartTF);

        let htfBarTime: number;
        if (!normalizedTF || normalizedTF === normalizedChartTF) {
            htfBarTime = currentTime;
        } else {
            // M1: calendar-form timeframes with an out-of-bounds multiplier
            // ('370D', '0D', '53W', '13M') are invalid — same rejection as
            // request.security ('Invalid timeframe'). Non-calendar forms
            // ('240', '30S') keep their alignment path.
            if (isCalendarForm(normalizedTF) && parseCalendarMultiplier(normalizedTF) === null) {
                throw new Error('Invalid timeframe');
            }
            // Compute the opening timestamp of the higher-timeframe bar that contains this bar
            htfBarTime = alignToTimeframe(currentTime, normalizedTF);
        }

        // Session filtering
        if (parsed.session !== undefined && parsed.session !== '') {
            const timezone = parsed.timezone || this.context.pine?.syminfo?.timezone || 'UTC';
            return this._isInSession(htfBarTime, parsed.session, timezone) ? htfBarTime : NaN;
        }

        return htfBarTime;
    }

    /**
     * Session check: parses "HHMM-HHMM" ranges and tests if the timestamp
     * falls within at least one of them. Comma-separated multi-session
     * strings are supported ("0400-0700,0900-1300"), as are overnight ranges
     * ("1800-0930"). An optional weekday suffix ("0930-1600:12345") restricts
     * the range to the listed days, using the TradingView convention where
     * 1=Sunday, 2=Monday, …, 7=Saturday (an omitted suffix means "1234567").
     * For overnight ranges the day constraint applies to the session's DAY OF
     * END: a bar at/after the start time belongs to the NEXT day's session
     * (TV documents "1700-1700:23456" as "The Monday session starts Sunday at
     * 17:00 and ends Monday at 17:00"). "0000-0000" covers the whole day
     * (TV: "0000-0000:23456" = a 24h session Monday to Friday). A session
     * string that yields no recognizable range is NOT treated as a permanent
     * session — it matches nothing (hors session).
     */
    private _isInSession(timestamp: number, session: string, timezone: string): boolean {
        // Get hour/minute in the target timezone using the shared utility
        const parts = getDatePartsInTimezone(timestamp, timezone);
        const barTime = parts.hour * 60 + parts.minute;

        for (const rawRange of session.split(',')) {
            const trimmed = rawRange.trim();
            // Optional weekday suffix: "<time_period>:<days>", days 1-7 (Sun..Sat).
            // Invalid day sets (e.g. containing "0") make the range unrecognizable.
            const [timePart, daysPart] = trimmed.split(':');
            const days = daysPart === undefined ? '1234567' : /^[1-7]+$/.test(daysPart) ? daysPart : null;
            if (days === null) continue;

            const match = timePart.match(/^(\d{2})(\d{2})-(\d{2})(\d{2})$/);
            if (!match) continue;

            const startHour = parseInt(match[1], 10);
            const startMin = parseInt(match[2], 10);
            const endHour = parseInt(match[3], 10);
            const endMin = parseInt(match[4], 10);

            const sessionStart = startHour * 60 + startMin;
            const sessionEnd = endHour * 60 + endMin;

            if (sessionStart === sessionEnd) {
                // Equal bounds are a 24-hour session: "0000-0000" (whole day on
                // the bar's own day), or an overnight wrap like "1700-1700"
                // (TV: "1700-1700:23456" — Monday session starts Sunday 17:00).
                const day = parts.dayOfWeek + 1; // JS 0=Sun..6=Sat → Pine 1=Sun..7=Sat
                if (sessionStart === 0) {
                    // "0000-0000": the whole day of the bar itself.
                    if (days.indexOf(String(day)) !== -1) return true;
                } else {
                    // Overnight 24h: bar at/after start → NEXT day's session
                    // (e.g. Sunday 17:00 is Monday's session); before start →
                    // the current day's session (e.g. Monday 16:59 is Monday's).
                    // Saturday rolls over to Sunday (Pine 7 → 1).
                    const sessionDay = barTime >= sessionStart ? (day === 7 ? 1 : day + 1) : day;
                    if (days.indexOf(String(sessionDay)) !== -1) return true;
                }
            } else if (sessionStart < sessionEnd) {
                // Intraday range: the session day is the bar's own day.
                if (barTime >= sessionStart && barTime < sessionEnd) {
                    const day = parts.dayOfWeek + 1; // JS 0=Sun..6=Sat → Pine 1=Sun..7=Sat
                    if (days.indexOf(String(day)) !== -1) return true;
                }
            } else {
                // Overnight range (e.g. "1800-0930"): the session day is the
                // day of END — a bar at/after start belongs to the NEXT day's
                // session, a bar before end belongs to the current day's.
                const day = parts.dayOfWeek + 1; // JS 0=Sun..6=Sat → Pine 1=Sun..7=Sat
                // A bar at/after start belongs to the NEXT day's session
                // (Saturday rolls over to Sunday: Pine 7 → 1).
                const sessionDay = barTime >= sessionStart ? (day === 7 ? 1 : day + 1) : day;
                if (barTime >= sessionStart || barTime < sessionEnd) {
                    if (days.indexOf(String(sessionDay)) !== -1) return true;
                }
            }
        }

        return false;
    }
}

// ── TimeComponentHelper ──────────────────────────────────────────────

//prettier-ignore
const TIME_COMPONENT_SIGNATURES = [
    // dayofmonth(), hour(), etc. — no args
    [],
    // dayofmonth(time)
    ['time'],
    // dayofmonth(time, timezone)
    ['time', 'timezone'],
];

//prettier-ignore
const TIME_COMPONENT_ARGS_TYPES = {
    time: 'number',
    timezone: 'string',
};

/**
 * Single parameterized class for all 8 dual-use time component identifiers:
 * dayofmonth, dayofweek, hour, minute, month, second, weekofyear, year.
 *
 * - Bare `dayofmonth` → `dayofmonth.__value` → extract from current bar openTime
 * - `dayofmonth(time)` → extract from given timestamp
 * - `dayofmonth(time, timezone)` → extract from timestamp in given timezone
 */
export class TimeComponentHelper {
    private context: any;
    private extractor: (parts: DateParts) => number;
    private readonly history = new Series([]);

    constructor(context: any, extractor: (parts: DateParts) => number) {
        this.context = context;
        this.extractor = extractor;
    }

    /**
     * Return the component as a context-local series.
     *
     * `context.data.openTime` is populated in bar order, so lazily extending
     * this series also covers bars where the builtin was not referenced. This
     * is important for a later `dayofmonth[1]`/`hour[1]`: history is a
     * property of the builtin, not of the bars on which the script happened
     * to read it.
     */
    get __value() {
        const openTimes = Series.from(this.context.data.openTime).data;
        const timezone = this.context.pine?.syminfo?.timezone || 'UTC';

        if (this.history.data.length > openTimes.length) {
            this.history.data.length = openTimes.length;
        }

        for (let i = this.history.data.length; i < openTimes.length; i++) {
            this.history.data.push(this.extract(openTimes[i], timezone));
        }

        // A streaming update may replace the current candle without changing
        // the series length; refresh that last value in place.
        if (openTimes.length > 0) {
            const last = openTimes.length - 1;
            this.history.data[last] = this.extract(openTimes[last], timezone);
        }

        return this.history;
    }

    private extract(timestamp: number, timezone: string): number {
        if (isNaN(timestamp)) return NaN;
        const parts = getDatePartsInTimezone(timestamp, timezone);
        return this.extractor(parts);
    }

    param(source: any, index: number = 0) {
        return Series.from(source).get(index);
    }

    any(...args: any[]) {
        const unwrapped = args.map((a) => (a instanceof Series ? a.get(0) : a));

        // No args → same scalar value as the bare identifier.
        if (unwrapped.length === 0) {
            return this.__value.get(0);
        }

        const parsed = parseArgsForPineParams<any>(unwrapped, TIME_COMPONENT_SIGNATURES, TIME_COMPONENT_ARGS_TYPES);

        const timestamp = parsed.time;
        if (timestamp === undefined || isNaN(timestamp)) return NaN;

        const timezone = parsed.timezone || this.context.pine?.syminfo?.timezone || 'UTC';
        const parts = getDatePartsInTimezone(timestamp, timezone);
        return this.extractor(parts);
    }
}

// ── Extractor functions ──────────────────────────────────────────────

export const EXTRACTORS = {
    dayofmonth: (parts: DateParts) => parts.day,
    dayofweek: (parts: DateParts) => (parts.dayOfWeek === 0 ? 1 : parts.dayOfWeek + 1), // Pine: Sun=1..Sat=7
    hour: (parts: DateParts) => parts.hour,
    minute: (parts: DateParts) => parts.minute,
    month: (parts: DateParts) => parts.month,
    second: (parts: DateParts) => parts.second,
    weekofyear: (parts: DateParts) => getISOWeekNumber(parts.year, parts.month, parts.day),
    year: (parts: DateParts) => parts.year,
};
