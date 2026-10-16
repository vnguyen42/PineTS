// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Series } from '../Series';
import { sessionDateParts } from './Time';

/**
 * `session` namespace (Pine v5+).
 *
 * Implements the "first/last bar of the day's session" built-in variables
 * (TradingView docs — Concepts / Sessions, "First and last bars"):
 *
 *   session.islastbar — "Is true if the current bar is the last bar of the
 *   day's session, and false otherwise."
 *
 * The boundary is the trading day: the calendar day in the symbol's exchange
 * timezone (syminfo.timezone; UTC fallback), or on an overnight session
 * (syminfo.session "1700-1600", "1800-1700", "1700-1700": futures, forex) the
 * day that starts at the session open the evening before (TradingView: the
 * first ES bar of Tuesday's session is Monday 17:00 CT). A bar is the last of
 * its day when the NEXT bar opens on a different day. On 1D+ charts every bar is its own
 * session day, so the variable is true on every bar; on intraday charts it
 * fires on the last bar of each trading day. The chart's final bar is
 * always the last bar of its (loaded) day.
 *
 * Market states and regular-session bars (VIN-240). TradingView (Concepts / Sessions, "Market
 * states" and "First and last bars"):
 *
 *   session.ismarket — "Is true when the bar belongs to regular trading hours. On “1D” and above
 *   timeframes, this variable is always true."
 *   session.ispremarket / session.ispostmarket — "Is true when the bar belongs to the extended
 *   session preceding/following regular trading hours. Extended hours data is only shown on
 *   intraday timeframes; on “1D” and above, this variable is always false."
 *   "For tickers without pre-market and post-market sessions, such as “BTCUSD”, session.ismarket
 *   is always true and session.ispremarket and session.ispostmarket are always false. For many
 *   futures symbols, Electronic trading hours (ETH) are considered the default session and use
 *   the named session "regular", so during those hours session.ismarket is true."
 *   session.isfirstbar_regular / session.islastbar_regular — "Is true on the first/last regular
 *   session bar of the day, false otherwise. The result is the same whether extended session
 *   information is used or not. For futures, the “Electronic trading hours” session is the
 *   regular session."
 *
 * The engine is fed the symbol's regular session only (syminfo.session: stocks "0930-1600",
 * futures "1700-1600", forex "1700-1700", crypto "24x7"; no extended-hours bars, and a
 * `session.extended` request gets the same regular bars): every bar is a market bar, none is
 * pre- or post-market, and the regular session's first/last bar of the day is the session's
 * (TradingView with extended hours off — measured on AMEX:SPY, CME_MINI:ES1!, FX:EURUSD and
 * BINANCE:BTCUSDT 60 and 1D).
 */
export class Session {
    /** Session type constants (ticker.new / ticker.modify / input.session values). */
    public readonly regular = 'regular';
    public readonly extended = 'extended';

    // Regular session only (see the class comment): every bar is a market bar.
    public readonly ismarket = true;
    public readonly ispremarket = false;
    public readonly ispostmarket = false;

    private readonly history: Record<string, Series> = {};

    constructor(private context: any) {}

    private dayKey(openTimeMs: number): string {
        // Overnight sessions (futures, forex): the trading day, which starts the evening before.
        const parts = sessionDateParts(this.context, openTimeMs);
        return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    }

    private lastBarAt(idx: number): boolean {
        // Full preloaded candle array (same source as barstate.islastconfirmedhistory
        // and last_bar_time): context.data only holds bars 0..idx mid-iteration.
        const md = this.context.marketData;
        if (!Array.isArray(md) || md.length === 0) return false;
        if (idx >= md.length - 1) return true;
        return this.dayKey(md[idx].openTime) !== this.dayKey(md[idx + 1].openTime);
    }

    private firstBarAt(idx: number): boolean {
        const md = this.context.marketData;
        if (!Array.isArray(md) || md.length === 0) return false;
        if (idx <= 0) return true;
        return this.dayKey(md[idx].openTime) !== this.dayKey(md[idx - 1].openTime);
    }

    public get islastbar() {
        return this.lastBarAt(this.context.idx);
    }

    public get isfirstbar() {
        return this.firstBarAt(this.context.idx);
    }

    // With no extended-hours bars the regular session's day is the session's day.
    public get isfirstbar_regular() {
        return this.firstBarAt(this.context.idx);
    }

    public get islastbar_regular() {
        return this.lastBarAt(this.context.idx);
    }

    /**
     * History of a session flag for `session.<flag>[n]` (the transpiler's only use, as
     * barstate.__series): bars 0..idx of the flag.
     */
    public __series(name: string): Series {
        let series = this.history[name];
        if (!series) {
            series = new Series([]);
            this.history[name] = series;
        }
        const length = Math.max(0, this.context.idx + 1);
        if (series.data.length > length) series.data.length = length;
        for (let index = series.data.length; index < length; index++) {
            series.data.push(
                name === 'isfirstbar' || name === 'isfirstbar_regular'
                    ? this.firstBarAt(index)
                    : name === 'islastbar' || name === 'islastbar_regular'
                      ? this.lastBarAt(index)
                      : name === 'ismarket',
            );
        }
        return series;
    }
}
