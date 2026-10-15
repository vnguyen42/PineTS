// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Famille : session-holidays-trading-day — target 2511 (NYMEX:NG1! 60, session "1800-1700"
 * America/New_York). TradingView's symbol_resolved.session_holidays lists the exchange's session
 * holidays; on an overnight session the sessions of a holiday join the next trading day. 2511
 * resets a 4-entries-per-day counter on `ta.change(time('D'))`: on Martin Luther King Day
 * 2023-01-16 the Sunday 18:00 session (early close 14:30) and the Monday 18:00 session form ONE
 * trading day (2023-01-17), so TV's counter is still 4 on bar 249 (Tuesday 20:00 UTC) and the
 * long the engine took there does not exist in TV; every other 2511 residual sits on the trading
 * day after a holiday (Labor Day, Juneteenth, Memorial Day, July 4th).
 */

import { describe, expect, it } from 'vitest';
import { PineTS } from 'index';

const HOUR = 3_600_000;
type Bar = { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };

function hourly(from: number, to: number, into: Bar[]): void {
    for (let t = from; t < to; t += HOUR) {
        const close = 3 + into.length / 1000;
        into.push({ openTime: t, closeTime: t + HOUR, open: close, high: close, low: close, close, volume: 1 });
    }
}

// NG1! around MLK 2023: Friday session, Sunday 18:00 EST (23:00 UTC) → Monday 14:30 EST early
// close, Monday 18:00 → Tuesday 17:00, Tuesday 18:00 → Wednesday 17:00.
const BARS: Bar[] = [];
hourly(Date.UTC(2023, 0, 12, 23), Date.UTC(2023, 0, 13, 22), BARS); // Friday 2023-01-13 trading day
hourly(Date.UTC(2023, 0, 15, 23), Date.UTC(2023, 0, 16, 20), BARS); // holiday session
hourly(Date.UTC(2023, 0, 16, 23), Date.UTC(2023, 0, 17, 22), BARS); // Tuesday 2023-01-17
hourly(Date.UTC(2023, 0, 17, 23), Date.UTC(2023, 0, 18, 22), BARS); // Wednesday 2023-01-18

function provider(holidays: string | undefined) {
    return {
        configure() {},
        async getMarketData() {
            return BARS.map((bar) => ({ ...bar }));
        },
        async getSymbolInfo(ticker: string) {
            return {
                ticker, tickerid: ticker, prefix: 'NYMEX', type: 'futures', session: '1800-1700', timezone: 'America/New_York',
                currency: 'USD', mintick: 0.001, pricescale: 1000, minmove: 1, pointvalue: 10000,
                ...(holidays === undefined ? {} : { session_holidays: holidays }),
            };
        },
    };
}

const SOURCE = `
//@version=5
indicator("trading day")
plot(time("D"), "dtime")
plot(time_tradingday, "td")
plot(ta.change(time("D")) ? 1 : 0, "dchange")
`;

const values = (plots: any, name: string) => plots[name].data.map((point: { value: unknown }) => point.value);

describe('2511 — session holidays join the next trading day', () => {
    it('keeps one trading day from the holiday session through the next session', async () => {
        const { plots } = await new PineTS(provider('20230102,20230116,20230220') as any, 'NYMEX:NG1!', '60').run(SOURCE);
        const dtime = values(plots, 'dtime');
        const td = values(plots, 'td');
        const change = values(plots, 'dchange');
        BARS.forEach((bar, i) => {
            const t = bar.openTime;
            if (t < Date.UTC(2023, 0, 15, 23)) {
                expect([dtime[i], td[i]]).toEqual([Date.UTC(2023, 0, 12, 23), Date.UTC(2023, 0, 13)]);
            } else if (t < Date.UTC(2023, 0, 17, 23)) {
                // Sunday 18:00 EST → Tuesday 17:00 EST: trading day 2023-01-17 opened on Sunday.
                expect([dtime[i], td[i]]).toEqual([Date.UTC(2023, 0, 15, 23), Date.UTC(2023, 0, 17)]);
            } else {
                expect([dtime[i], td[i]]).toEqual([Date.UTC(2023, 0, 17, 23), Date.UTC(2023, 0, 18)]);
            }
            const opensDay = t === Date.UTC(2023, 0, 15, 23) || t === Date.UTC(2023, 0, 17, 23);
            expect(change[i]).toBe(opensDay ? 1 : 0);
        });
    });

    it('without session_holidays the Monday 18:00 session still opens a new day', async () => {
        const { plots } = await new PineTS(provider(undefined) as any, 'NYMEX:NG1!', '60').run(SOURCE);
        const change = values(plots, 'dchange');
        const monday = BARS.findIndex((bar) => bar.openTime === Date.UTC(2023, 0, 16, 23));
        expect(change[monday]).toBe(1);
    });

    it('a Friday holiday joins the Thursday evening session to the Monday trading day (July 4th 2025)', async () => {
        const bars: Bar[] = [];
        hourly(Date.UTC(2025, 6, 3, 22), Date.UTC(2025, 6, 4, 0), bars); // Thursday 18:00 EDT session (raw Friday holiday)
        hourly(Date.UTC(2025, 6, 6, 22), Date.UTC(2025, 6, 7, 21), bars); // Sunday 18:00 EDT → Monday
        hourly(Date.UTC(2025, 6, 7, 22), Date.UTC(2025, 6, 8, 2), bars); // Tuesday trading day
        const source = provider('20250704');
        source.getMarketData = async () => bars.map((bar) => ({ ...bar }));
        const { plots } = await new PineTS(source as any, 'NYMEX:NG1!', '60').run(SOURCE);
        const dtime = values(plots, 'dtime');
        const td = values(plots, 'td');
        bars.forEach((bar, i) => {
            if (bar.openTime < Date.UTC(2025, 6, 7, 22)) {
                expect([dtime[i], td[i]]).toEqual([Date.UTC(2025, 6, 3, 22), Date.UTC(2025, 6, 7)]);
            } else {
                expect([dtime[i], td[i]]).toEqual([Date.UTC(2025, 6, 7, 22), Date.UTC(2025, 6, 8)]);
            }
        });
    });
});
