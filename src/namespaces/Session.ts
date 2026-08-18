// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { getDatePartsInTimezone } from './Time';

/**
 * `session` namespace (Pine v5+).
 *
 * Implements the "first/last bar of the day's session" built-in variables
 * (TradingView docs — Concepts / Sessions, "First and last bars"):
 *
 *   session.islastbar — "Is true if the current bar is the last bar of the
 *   day's session, and false otherwise."
 *
 * The boundary is the calendar day in the symbol's exchange timezone
 * (syminfo.timezone; UTC fallback): a bar is the last of its day when the
 * NEXT bar opens on a different day. On 1D+ charts every bar is its own
 * session day, so the variable is true on every bar; on intraday charts it
 * fires on the last bar of each trading day. The chart's final bar is
 * always the last bar of its (loaded) day.
 */
export class Session {
    constructor(private context: any) {}

    private dayKey(openTimeMs: number): string {
        const tz = this.context.pine?.syminfo?.timezone || 'UTC';
        const parts = getDatePartsInTimezone(openTimeMs, tz);
        return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    }

    public get islastbar() {
        // Full preloaded candle array (same source as barstate.islastconfirmedhistory
        // and last_bar_time): context.data only holds bars 0..idx mid-iteration.
        const md = this.context.marketData;
        if (!Array.isArray(md) || md.length === 0) return false;
        const idx = this.context.idx;
        if (idx >= md.length - 1) return true;
        return this.dayKey(md[idx].openTime) !== this.dayKey(md[idx + 1].openTime);
    }

    public get isfirstbar() {
        const md = this.context.marketData;
        if (!Array.isArray(md) || md.length === 0) return false;
        const idx = this.context.idx;
        if (idx <= 0) return true;
        return this.dayKey(md[idx].openTime) !== this.dayKey(md[idx - 1].openTime);
    }
}
