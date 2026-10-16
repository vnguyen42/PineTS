// SPDX-License-Identifier: AGPL-3.0-only

/**
 * VIN-240 — session.ismarket / ispremarket / ispostmarket / isfirstbar_regular / islastbar_regular
 * and the session.regular / session.extended constants read undefined (false): a script filtering
 * its entries on session.ismarket made 0 trades (SPY 1h: 57 trades without the filter), and
 * `session.<flag>[1]` indexed the scalar (false on every bar, isfirstbar/islastbar included).
 *
 * TradingView with extended hours off (the only data the engine gets), measured on AMEX:SPY,
 * CME_MINI:ES1!, FX:EURUSD and BINANCE:BTCUSDT 60 and 1D with the public scripts "PM RTH AH VWAPs"
 * and "Past 5 Days Close": ismarket true on every bar, ispremarket/ispostmarket false,
 * isfirstbar_regular on the trading day's first bar (09:30 NY, 17:00 CT, 17:00 NY, 00:00 UTC)
 * and on every 1D bar.
 */

import { describe, expect, it } from 'vitest';
import { PineTS } from 'index';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
type Bar = { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };
type Info = { session: string; timezone: string; type: string; ticker: string };

/** `days` trading days of `perDay` bars of `span` ms, the first opening at `start`. */
function bars(start: number, days: number, perDay: number, span: number): Bar[] {
    const out: Bar[] = [];
    for (let day = 0; day < days; day++) {
        for (let i = 0; i < perDay; i++) {
            const openTime = start + day * DAY + i * span;
            const close = 100 + out.length;
            out.push({ openTime, closeTime: openTime + span, open: close, high: close + 1, low: close - 1, close, volume: 1 });
        }
    }
    return out;
}

function provider(data: Bar[], info: Info) {
    return {
        configure() {},
        async getMarketData() {
            return data.map((bar) => ({ ...bar }));
        },
        async getSymbolInfo(ticker: string) {
            return { ...info, tickerid: ticker, prefix: ticker.split(':')[0], currency: 'USD', mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1 };
        },
    };
}

const SOURCE = `
//@version=6
indicator("session members")
plot(session.ismarket ? 1 : 0, "market")
plot(session.ispremarket ? 1 : 0, "pre")
plot(session.ispostmarket ? 1 : 0, "post")
plot(session.isfirstbar_regular ? 1 : 0, "firstRegular")
plot(session.islastbar_regular ? 1 : 0, "lastRegular")
plot(session.isfirstbar ? 1 : 0, "first")
plot(session.islastbar ? 1 : 0, "last")
plot(session.regular == "regular" and session.extended == "extended" ? 1 : 0, "constants")
plot(session.ismarket[1] ? 1 : 0, "marketPrev")
plot(session.ispostmarket[1] ? 1 : 0, "postPrev")
plot(session.isfirstbar_regular[1] ? 1 : 0, "firstRegularPrev")
plot(session.islastbar[1] ? 1 : 0, "lastPrev")
`;

async function run(data: Bar[], info: Info, tickerid: string, timeframe: string) {
    const pine = new PineTS(provider(data, info) as unknown as ConstructorParameters<typeof PineTS>[0], tickerid, timeframe);
    const { plots } = await pine.run(SOURCE);
    const values = (name: string): unknown[] => plots[name].data.map((point: { value: unknown }) => point.value);
    return values;
}

/** 1 on the bars at `indexes`, else 0. */
const marks = (length: number, indexes: number[]) => Array.from({ length }, (_, i) => (indexes.includes(i) ? 1 : 0));

const MARKETS: { name: string; info: Info; tickerid: string; intraday: Bar[]; first: number[]; last: number[]; daily: Bar[] }[] = [
    {
        // 09:30–16:00 New York (14:30 UTC in January): 7 hourly bars a day.
        name: 'US stock 0930-1600',
        info: { session: '0930-1600', timezone: 'America/New_York', type: 'stock', ticker: 'SPY' },
        tickerid: 'AMEX:SPY',
        intraday: bars(Date.UTC(2025, 0, 6, 14, 30), 2, 7, HOUR),
        first: [0, 7],
        last: [6, 13],
        daily: bars(Date.UTC(2025, 0, 6, 14, 30), 5, 1, 6.5 * HOUR),
    },
    {
        // CME Globex 17:00–16:00 Chicago: Sunday 17:00 CST (23:00 UTC) opens Monday, 23 bars a day.
        name: 'futures 1700-1600',
        info: { session: '1700-1600', timezone: 'America/Chicago', type: 'futures', ticker: 'ES1!' },
        tickerid: 'CME_MINI:ES1!',
        intraday: bars(Date.UTC(2025, 0, 5, 23), 2, 23, HOUR),
        first: [0, 23],
        last: [22, 45],
        daily: bars(Date.UTC(2025, 0, 5, 23), 5, 1, 23 * HOUR),
    },
    {
        // Forex 17:00–17:00 New York: Sunday 17:00 EST (22:00 UTC) opens Monday, 24 bars a day.
        name: 'forex 1700-1700',
        info: { session: '1700-1700', timezone: 'America/New_York', type: 'forex', ticker: 'EURUSD' },
        tickerid: 'FX:EURUSD',
        intraday: bars(Date.UTC(2025, 0, 5, 22), 2, 24, HOUR),
        first: [0, 24],
        last: [23, 47],
        daily: bars(Date.UTC(2025, 0, 5, 22), 5, 1, DAY),
    },
    {
        // Crypto 24x7 UTC: days start at 00:00 UTC.
        name: 'crypto 24x7',
        info: { session: '24x7', timezone: 'Etc/UTC', type: 'crypto', ticker: 'BTCUSDT' },
        tickerid: 'BINANCE:BTCUSDT',
        intraday: bars(Date.UTC(2025, 0, 6), 2, 24, HOUR),
        first: [0, 24],
        last: [23, 47],
        daily: bars(Date.UTC(2025, 0, 6), 5, 1, DAY),
    },
];

describe('VIN-240 session market states and regular-session bars', () => {
    for (const market of MARKETS) {
        it(`${market.name} 60: every bar is a market bar; the regular first/last bars are the trading day's`, async () => {
            const values = await run(market.intraday, market.info, market.tickerid, '60');
            const n = market.intraday.length;
            expect(values('market')).toEqual(Array(n).fill(1));
            expect(values('pre')).toEqual(Array(n).fill(0));
            expect(values('post')).toEqual(Array(n).fill(0));
            expect(values('firstRegular')).toEqual(marks(n, market.first));
            expect(values('lastRegular')).toEqual(marks(n, market.last));
            expect(values('firstRegular')).toEqual(values('first'));
            expect(values('lastRegular')).toEqual(values('last'));
            expect(values('constants')).toEqual(Array(n).fill(1));
            // History: the previous bar's flags (none before the first bar).
            expect(values('marketPrev')).toEqual([0, ...Array(n - 1).fill(1)]);
            expect(values('postPrev')).toEqual(Array(n).fill(0));
            expect(values('firstRegularPrev')).toEqual(marks(n, market.first.map((i) => i + 1)));
            expect(values('lastPrev')).toEqual(marks(n, market.last.map((i) => i + 1)));
        });

        it(`${market.name} 1D: market on every bar, every bar is the regular session's first and last`, async () => {
            const values = await run(market.daily, market.info, market.tickerid, 'D');
            const n = market.daily.length;
            expect(values('market')).toEqual(Array(n).fill(1));
            expect(values('pre')).toEqual(Array(n).fill(0));
            expect(values('post')).toEqual(Array(n).fill(0));
            expect(values('firstRegular')).toEqual(Array(n).fill(1));
            expect(values('lastRegular')).toEqual(Array(n).fill(1));
        });
    }
});
