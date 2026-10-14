// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Overnight sessions (futures "1700-1600" America/Chicago, forex "1700-1700" America/New_York):
 * the trading day starts at the session open the evening before (TradingView: ES's Tuesday session
 * opens Monday 17:00 CT, the Monday one on Sunday). session.isfirstbar/islastbar, time_tradingday,
 * timeframe.change and time(tf) follow that day; a day session ("0930-1600") keeps the calendar day.
 */

import { describe, expect, it } from 'vitest';
import { PineTS } from 'index';

const HOUR = 3_600_000;
type Bar = { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };

/** Hourly bars of a CME week: Sunday 17:00 CT → Friday 16:00 CT, daily break 16:00–17:00 CT. */
function cmeWeek(sundayOpenUtc: number): Bar[] {
    const bars: Bar[] = [];
    for (let day = 0; day < 5; day++) {
        const open = sundayOpenUtc + day * 24 * HOUR;
        for (let h = 0; h < 23; h++) {
            const t = open + h * HOUR;
            const close = 100 + bars.length;
            bars.push({ openTime: t, closeTime: t + HOUR, open: close, high: close + 1, low: close - 1, close, volume: 1 });
        }
    }
    return bars;
}

function provider(bars: Bar[], info: { session: string; timezone: string; type: string; ticker: string }) {
    return {
        configure() {},
        async getMarketData() {
            return bars.map((bar) => ({ ...bar }));
        },
        async getSymbolInfo(ticker: string) {
            return { ...info, tickerid: ticker, prefix: ticker.split(':')[0], currency: 'USD', mintick: 0.25, pricescale: 4, minmove: 1, pointvalue: 50 };
        },
    };
}

const SOURCE = `
//@version=6
indicator("trading day")
plot(session.isfirstbar ? 1 : 0, "first")
plot(session.islastbar ? 1 : 0, "last")
plot(time_tradingday, "td")
plot(timeframe.change("D") ? 1 : 0, "dchange")
plot(time("D"), "dtime")
plot(time("240"), "h4")
plot(time("W"), "wtime")
`;

const values = (plots: any, name: string) => plots[name].data.map((point: { value: unknown }) => point.value);

describe('overnight trading days', () => {
    // 2025-01-05 is a Sunday; 17:00 CST = 23:00 UTC.
    const winter = cmeWeek(Date.UTC(2025, 0, 5, 23));
    const es = { session: '1700-1600', timezone: 'America/Chicago', type: 'futures', ticker: 'ES1!' };

    it('ES (CST): first bar 17:00 CT, last bar 15:00 CT, trading day = next date', async () => {
        const { plots } = await new PineTS(provider(winter, es) as any, 'CME_MINI:ES1!', '60').run(SOURCE);
        const first = values(plots, 'first');
        const last = values(plots, 'last');
        const td = values(plots, 'td');
        winter.forEach((bar, i) => {
            const hourUtc = new Date(bar.openTime).getUTCHours();
            expect(first[i]).toBe(hourUtc === 23 ? 1 : 0);
            expect(last[i]).toBe(hourUtc === 21 ? 1 : 0);
            // The session opening Sunday 23:00 UTC is Monday's (Jan 6), and so on.
            const dayIndex = Math.floor((bar.openTime - Date.UTC(2025, 0, 5, 23)) / (24 * HOUR));
            expect(td[i]).toBe(Date.UTC(2025, 0, 6 + dayIndex));
        });
    });

    it('ES (CST): timeframe.change("D"), time("D"), time("240") and time("W") anchor on the 17:00 CT open', async () => {
        const { plots } = await new PineTS(provider(winter, es) as any, 'CME_MINI:ES1!', '60').run(SOURCE);
        const change = values(plots, 'dchange');
        const dtime = values(plots, 'dtime');
        const h4 = values(plots, 'h4');
        const wtime = values(plots, 'wtime');
        winter.forEach((bar, i) => {
            const sessionStart = Date.UTC(2025, 0, 5, 23) + Math.floor((bar.openTime - Date.UTC(2025, 0, 5, 23)) / (24 * HOUR)) * 24 * HOUR;
            expect(dtime[i]).toBe(sessionStart);
            expect(change[i]).toBe(i > 0 && bar.openTime === sessionStart ? 1 : 0);
            // 4h buckets 17:00, 21:00, 01:00, 05:00, 09:00, 13:00 CT = 23, 03, 07, 11, 15, 19 UTC.
            expect(h4[i]).toBe(sessionStart + Math.floor((bar.openTime - sessionStart) / (4 * HOUR)) * 4 * HOUR);
            // The week starts with Monday's trading day, opened Sunday 17:00 CT.
            expect(wtime[i]).toBe(Date.UTC(2025, 0, 5, 23));
        });
    });

    it('ES (CDT): the open moves to 22:00 UTC with daylight saving time', async () => {
        const summer = cmeWeek(Date.UTC(2025, 6, 6, 22)); // Sunday 2025-07-06 17:00 CDT
        const { plots } = await new PineTS(provider(summer, es) as any, 'CME_MINI:ES1!', '60').run(SOURCE);
        const first = values(plots, 'first');
        const td = values(plots, 'td');
        const dtime = values(plots, 'dtime');
        summer.forEach((bar, i) => {
            expect(first[i]).toBe(new Date(bar.openTime).getUTCHours() === 22 ? 1 : 0);
            const dayIndex = Math.floor((bar.openTime - Date.UTC(2025, 6, 6, 22)) / (24 * HOUR));
            expect(td[i]).toBe(Date.UTC(2025, 6, 7 + dayIndex));
            expect(dtime[i]).toBe(Date.UTC(2025, 6, 6, 22) + dayIndex * 24 * HOUR);
        });
    });

    it('EURUSD "1700-1700" New York: Sunday 17:00 ET opens Monday', async () => {
        // 24 hourly bars from Sunday 2025-01-05 17:00 EST (22:00 UTC).
        const fx: Bar[] = Array.from({ length: 30 }, (_, i) => {
            const t = Date.UTC(2025, 0, 5, 22) + i * HOUR;
            return { openTime: t, closeTime: t + HOUR, open: 1, high: 1, low: 1, close: 1, volume: 1 };
        });
        const info = { session: '1700-1700', timezone: 'America/New_York', type: 'forex', ticker: 'EURUSD' };
        const { plots } = await new PineTS(provider(fx, info) as any, 'FX:EURUSD', '60').run(SOURCE);
        expect(values(plots, 'td').slice(0, 24)).toEqual(Array(24).fill(Date.UTC(2025, 0, 6)));
        expect(values(plots, 'td')[24]).toBe(Date.UTC(2025, 0, 7));
        expect(values(plots, 'first')[24]).toBe(1);
        expect(values(plots, 'last')[23]).toBe(1);
    });

    it('a day session keeps the calendar day', async () => {
        const info = { session: '0930-1600', timezone: 'America/Chicago', type: 'stock', ticker: 'X' };
        const { plots } = await new PineTS(provider(winter, info) as any, 'US:X', '60').run(SOURCE);
        // 23:00 UTC is 17:00 CST: same calendar day as the bars before it.
        const td = values(plots, 'td');
        winter.forEach((bar, i) => {
            const parts = new Date(bar.closeTime - 6 * HOUR);
            expect(td[i]).toBe(Date.UTC(parts.getUTCFullYear(), parts.getUTCMonth(), parts.getUTCDate()));
        });
        expect(values(plots, 'first')[0]).toBe(1);
        expect(values(plots, 'first')[1]).toBe(0);
        // 18:00 CST (00:00 UTC) on the same evening is no new day for a day session
        expect(values(plots, 'first')[7]).toBe(1); // 06:00 UTC = 00:00 CST
    });
});

describe('backadjustment.off on continuous futures', () => {
    const bars = cmeWeek(Date.UTC(2025, 0, 5, 23)).slice(0, 5);
    const es = { session: '1700-1600', timezone: 'America/Chicago', type: 'futures', ticker: 'ES1!' };

    it('is refused for a 1! ticker and for the chart future', async () => {
        for (const call of [
            'ticker.modify(syminfo.tickerid, backadjustment=backadjustment.off)',
            'ticker.new("CME_MINI", "NQ1!", session.extended, adjustment.none, backadjustment.off)',
        ]) {
            const source = `//@version=6\nindicator("b")\nt = ${call}\nplot(close)\n`;
            await expect(new PineTS(provider(bars, es) as any, 'CME_MINI:ES1!', '60').run(source)).rejects.toThrow(/backadjustment\.off/);
        }
    });

    it('is ignored elsewhere, and backadjustment.on passes', async () => {
        const stock = { session: '0930-1600', timezone: 'America/New_York', type: 'stock', ticker: 'X' };
        const off = `//@version=6\nindicator("b")\nt = ticker.modify(syminfo.tickerid, backadjustment=backadjustment.off)\nplot(close)\n`;
        await expect(new PineTS(provider(bars, stock) as any, 'US:X', '60').run(off)).resolves.toBeDefined();
        const on = `//@version=6\nindicator("b")\nt = ticker.modify(syminfo.tickerid, backadjustment=backadjustment.on)\nplot(close)\n`;
        await expect(new PineTS(provider(bars, es) as any, 'CME_MINI:ES1!', '60').run(on)).resolves.toBeDefined();
    });
});
