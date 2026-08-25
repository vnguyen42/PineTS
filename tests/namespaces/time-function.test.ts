import { describe, it, expect } from 'vitest';
import { PineTS, Provider } from 'index';

// Mock provider has daily data. Use daily chart with higher TF alignment tests.
// For intraday tests, use Binance provider.

describe('time() function — timeframe alignment (daily chart)', () => {
    // Mock data: daily bars from 2025-01-01 to 2025-06-01
    const makePineTS = () => new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2025-01-01').getTime(), new Date('2025-06-01').getTime());

    it('time("W") returns weekly-aligned timestamps on daily chart', async () => {
        const code = `
//@version=5
indicator("time W test")
t_w = time("W")
t_bar = time
plot(t_w, "weekly")
plot(t_bar, "bar")
`;
        const pineTS = makePineTS();
        const { plots } = await pineTS.run(code);

        const weeklyData = plots['weekly'].data.filter((d: any) => d.value != null && !isNaN(d.value));
        expect(weeklyData.length).toBeGreaterThan(0);

        // Weekly timestamps should be on Mondays at 00:00 UTC
        for (const d of weeklyData) {
            const date = new Date(d.value);
            expect(date.getUTCDay()).toBe(1); // Monday
            expect(date.getUTCHours()).toBe(0);
            expect(date.getUTCMinutes()).toBe(0);
        }

        // Should be a staircase: same value for 7 consecutive daily bars
        let sameCount = 0;
        for (let i = 1; i < weeklyData.length; i++) {
            if (weeklyData[i].value === weeklyData[i - 1].value) sameCount++;
        }
        // Most daily bars within the same week should have the same weekly timestamp
        expect(sameCount).toBeGreaterThan(weeklyData.length * 0.7);
    });

    it('time("M") returns monthly-aligned timestamps on daily chart', async () => {
        const code = `
//@version=5
indicator("time M test")
t_m = time("M")
plot(t_m, "monthly")
`;
        const pineTS = makePineTS();
        const { plots } = await pineTS.run(code);

        const monthlyData = plots['monthly'].data.filter((d: any) => d.value != null && !isNaN(d.value));
        expect(monthlyData.length).toBeGreaterThan(0);

        // Monthly timestamps should be on the 1st at 00:00 UTC
        for (const d of monthlyData) {
            const date = new Date(d.value);
            expect(date.getUTCDate()).toBe(1);
            expect(date.getUTCHours()).toBe(0);
            expect(date.getUTCMinutes()).toBe(0);
        }

        // Should have ~5 unique monthly values for Jan-May
        const uniqueMonths = new Set(monthlyData.map((d: any) => d.value));
        expect(uniqueMonths.size).toBeGreaterThanOrEqual(4);
        expect(uniqueMonths.size).toBeLessThanOrEqual(6);
    });

    it('time("D") on daily chart returns same as time variable', async () => {
        const code = `
//@version=5
indicator("time D on D test")
t_d = time("D")
t_bar = time
plot(t_d, "daily_fn")
plot(t_bar, "bar")
`;
        const pineTS = makePineTS();
        const { plots } = await pineTS.run(code);

        const dailyFnData = plots['daily_fn'].data;
        const barData = plots['bar'].data;

        // On a daily chart, time("D") should equal time
        let checked = 0;
        for (let i = 0; i < dailyFnData.length; i++) {
            if (dailyFnData[i].value != null && barData[i].value != null) {
                expect(dailyFnData[i].value).toBe(barData[i].value);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(0);
    });

    it('time("") returns current bar time', async () => {
        const code = `
//@version=5
indicator("time empty test")
t_empty = time("")
t_bar = time
plot(t_empty, "empty")
plot(t_bar, "bar")
`;
        const pineTS = makePineTS();
        const { plots } = await pineTS.run(code);

        const emptyData = plots['empty'].data;
        const barData = plots['bar'].data;

        let checked = 0;
        for (let i = 0; i < emptyData.length; i++) {
            if (emptyData[i].value != null && barData[i].value != null) {
                expect(emptyData[i].value).toBe(barData[i].value);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(0);
    });

    it('time("W") steps at week boundaries', async () => {
        const code = `
//@version=5
indicator("time W boundary test")
t_w = time("W")
plot(t_w, "weekly")
`;
        const pineTS = makePineTS();
        const { plots } = await pineTS.run(code);

        const weeklyData = plots['weekly'].data.filter((d: any) => d.value != null && !isNaN(d.value));
        const uniqueWeeks = [...new Set(weeklyData.map((d: any) => d.value))].sort((a: number, b: number) => a - b);

        // Each unique week should be 7 days apart
        for (let i = 1; i < uniqueWeeks.length; i++) {
            expect(uniqueWeeks[i] - uniqueWeeks[i - 1]).toBe(7 * 86400000);
        }
    });
});

describe('time() function — intraday alignment (Binance)', () => {
    // Use Binance 15min data for intraday timeframe tests
    const makePineTS = () => new PineTS(Provider.Binance, 'BTCUSDC', '15', 200);

    it('time("D") returns daily-aligned timestamps on 15min chart', async () => {
        const code = `
//@version=5
indicator("time D on 15m")
t_d = time("D")
t_bar = time
plot(t_d, "daily")
plot(t_bar, "bar")
`;
        const pineTS = makePineTS();
        const { plots } = await pineTS.run(code);

        const dailyData = plots['daily'].data;
        const barData = plots['bar'].data;

        // Daily time should be staircase: same for all bars in a day
        let stairFound = false;
        for (let i = 1; i < dailyData.length; i++) {
            const d1 = dailyData[i - 1].value;
            const d2 = dailyData[i].value;
            const b1 = barData[i - 1].value;
            const b2 = barData[i].value;
            if (d1 == null || d2 == null || b1 == null || b2 == null) continue;

            // Bar times always increase
            expect(b2).toBeGreaterThan(b1);

            // Within same day, daily should be constant
            if (d2 === d1 && b2 > b1) stairFound = true;
        }
        expect(stairFound).toBe(true);

        // All daily values should be at 00:00 UTC
        for (const d of dailyData) {
            if (d.value != null && !isNaN(d.value)) {
                const date = new Date(d.value);
                expect(date.getUTCHours()).toBe(0);
                expect(date.getUTCMinutes()).toBe(0);
            }
        }
    });

    it('time("60") returns hourly-aligned timestamps on 15min chart', async () => {
        const code = `
//@version=5
indicator("time 60 on 15m")
t_h = time("60")
plot(t_h, "hourly")
`;
        const pineTS = makePineTS();
        const { plots } = await pineTS.run(code);

        const hourlyData = plots['hourly'].data;

        // Hourly timestamps should be at :00 minutes
        for (const d of hourlyData) {
            if (d.value != null && !isNaN(d.value)) {
                const date = new Date(d.value);
                expect(date.getUTCMinutes()).toBe(0);
            }
        }

        // With 15min bars, each hourly value repeats 4 times then steps
        let sameCount = 0, stepCount = 0;
        for (let i = 1; i < hourlyData.length; i++) {
            if (hourlyData[i].value == null || hourlyData[i - 1].value == null) continue;
            if (hourlyData[i].value === hourlyData[i - 1].value) sameCount++;
            else stepCount++;
        }
        // ~75% same, ~25% step (3 same per 1 step)
        expect(sameCount).toBeGreaterThan(stepCount * 2);
    });

    it('time("240") returns 4h-aligned timestamps on 15min chart', async () => {
        const code = `
//@version=5
indicator("time 240 on 15m")
t_4h = time("240")
plot(t_4h, "4h")
`;
        const pineTS = makePineTS();
        const { plots } = await pineTS.run(code);

        const fourHData = plots['4h'].data;

        // 4h timestamps should have hours at 0, 4, 8, 12, 16, or 20
        for (const d of fourHData) {
            if (d.value != null && !isNaN(d.value)) {
                const date = new Date(d.value);
                expect(date.getUTCHours() % 4).toBe(0);
                expect(date.getUTCMinutes()).toBe(0);
            }
        }
    });
});

describe('time() function — session filtering', () => {
    const makePineTS = () => new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2025-01-01').getTime(), new Date('2025-02-01').getTime());

    it('time with session returns NaN outside session hours', async () => {
        // On daily bars, session "0800-1600" should filter based on the bar's time
        // Since mock daily bars have openTime at 00:00 UTC, they fall outside 08:00-16:00
        // This tests the session filtering mechanism
        const code = `
//@version=5
indicator("time session test")
t_in = time("D", "0000-2359")
t_out = time("D", "0100-0200")
plot(t_in, "in_session")
plot(t_out, "out_session")
`;
        const pineTS = makePineTS();
        const { plots } = await pineTS.run(code);

        const inData = plots['in_session'].data;
        const outData = plots['out_session'].data;

        // 0000-2359 should include all bars (daily bars at 00:00 UTC are in 00:00-23:59)
        const validIn = inData.filter((d: any) => d.value != null && !isNaN(d.value));
        expect(validIn.length).toBeGreaterThan(0);

        // 0100-0200 should exclude daily bars at 00:00 UTC
        const validOut = outData.filter((d: any) => d.value != null && !isNaN(d.value));
        const nanOut = outData.filter((d: any) => d.value == null || isNaN(d.value));
        expect(nanOut.length).toBeGreaterThan(0);
    });
});

describe('time() function — session parsing (multi-range, invalid, weekday suffix)', () => {
    // Synthetic 1-minute bars: Sunday 2024-12-29 00:00 → Monday 2025-01-06 23:59 UTC.
    // Covers every weekday for the day-suffix tests (Wed 2025-01-01, Thu 02,
    // Fri 03, Sat 04, Sun 05, Mon 06) plus the Sunday→Monday overnight wrap.
    const MINUTE = 60_000;
    const START = Date.UTC(2024, 11, 29, 0, 0, 0);
    const CANDLES = Array.from({ length: 9 * 24 * 60 }, (_, i) => {
        const openTime = START + i * MINUTE;
        return {
            openTime,
            open: 100,
            high: 100,
            low: 100,
            close: 100,
            volume: 1,
            closeTime: openTime + MINUTE - 1,
        };
    });

    class SessionProvider {
        configure() {}
        async getMarketData() {
            return CANDLES;
        }
        async getSymbolInfo() {
            return {
                ticker: 'TEST', tickerid: 'FILE:TEST', main_tickerid: 'FILE:TEST', prefix: 'FILE',
                root: 'TEST', description: 'TEST / USD', type: 'crypto', basecurrency: 'TEST',
                currency: 'USD', timezone: 'Etc/UTC', mintick: 0.01, pricescale: 100,
                minmove: 1, pointvalue: 1, mincontract: 0.00001, session: '24x7', volumetype: 'base',
            };
        }
    }

    // Returns Map<bar openTime, plotted value> for the given session string.
    const runSession = async (session: string) => {
        const code = `
//@version=5
indicator("session parsing test")
t = time("1", "${session}")
plot(t, "s")
`;
        const pineTS = new PineTS(new SessionProvider() as any, 'TEST', '1');
        const { plots } = await pineTS.run(code);
        const out = new Map<number, number | null>();
        for (const d of plots['s'].data) out.set(d.time, d.value);
        return out;
    };

    const inSession = (bars: Map<number, number | null>, h: number, m = 0) => {
        const v = bars.get(Date.UTC(2025, 0, 1, h, m, 0));
        return typeof v === 'number' && !Number.isNaN(v);
    };

    // inSessionOn(bars, year, jsMonth, day, hour, minute) — checks a bar on a
    // specific UTC calendar day (month is JS 0-based).
    const inSessionOn = (bars: Map<number, number | null>, year: number, jsMonth: number, day: number, h: number, m = 0) => {
        const v = bars.get(Date.UTC(year, jsMonth, day, h, m, 0));
        return typeof v === 'number' && !Number.isNaN(v);
    };

    it('multi-range "0400-0700,0900-1300": in first and second range, out otherwise', async () => {
        const bars = await runSession('0400-0700,0900-1300');
        // First range: 04:00 ≤ t < 07:00
        expect(inSession(bars, 4, 0)).toBe(true);
        expect(inSession(bars, 6, 59)).toBe(true);
        expect(inSession(bars, 7, 0)).toBe(false);
        // Second range: 09:00 ≤ t < 13:00
        expect(inSession(bars, 9, 0)).toBe(true);
        expect(inSession(bars, 12, 59)).toBe(true);
        expect(inSession(bars, 13, 0)).toBe(false);
        // Outside both ranges
        expect(inSession(bars, 3, 59)).toBe(false);
        expect(inSession(bars, 8, 0)).toBe(false);
    });

    it('multi-range with an overnight leg "1300-1600,1800-0930"', async () => {
        const bars = await runSession('1300-1600,1800-0930');
        expect(inSession(bars, 14, 0)).toBe(true); // first range
        expect(inSession(bars, 20, 0)).toBe(true); // overnight leg (t ≥ 18:00)
        expect(inSession(bars, 3, 0)).toBe(true); // overnight leg (t < 09:30)
        expect(inSession(bars, 17, 0)).toBe(false); // gap between ranges
    });

    it('single-range sessions behave as before', async () => {
        const bars = await runSession('0100-0200');
        expect(inSession(bars, 1, 30)).toBe(true);
        expect(inSession(bars, 3, 0)).toBe(false);
        const fullDay = await runSession('0000-2359');
        expect(inSession(fullDay, 10, 0)).toBe(true);
    });

    it('"0000-0000" is a whole-day session', async () => {
        const bars = await runSession('0000-0000');
        expect(inSession(bars, 3, 0)).toBe(true);
        expect(inSession(bars, 14, 59)).toBe(true);
    });

    it('weekday-suffixed session "0930-1600:146" applies the day constraint (Sun=1..Sat=7)', async () => {
        // 2025: Wed Jan 1, Thu 2, Fri 3, Sat 4. "146" = Sun, Wed, Fri.
        const bars = await runSession('0930-1600:146');
        // Hours honored on an included day (Wed):
        expect(inSessionOn(bars, 2025, 0, 1, 10, 0)).toBe(true);
        expect(inSessionOn(bars, 2025, 0, 1, 9, 0)).toBe(false);
        expect(inSessionOn(bars, 2025, 0, 1, 17, 0)).toBe(false);
        // An excluded day (Thu) is outside even during the hours window.
        expect(inSessionOn(bars, 2025, 0, 2, 10, 0)).toBe(false);
        // Included day again (Fri).
        expect(inSessionOn(bars, 2025, 0, 3, 10, 0)).toBe(true);
        // Another excluded day (Sat).
        expect(inSessionOn(bars, 2025, 0, 4, 10, 0)).toBe(false);
    });

    it('overnight 24h session "1700-1700:23456": Monday session starts Sunday 17:00', async () => {
        // TV documents "1700-1700:23456" as: "The Monday session starts
        // Sunday at 17:00 and ends Monday at 17:00".
        const bars = await runSession('1700-1700:23456');
        // Sunday 2025-01-05: from 17:00 the bar belongs to MONDAY's session.
        expect(inSessionOn(bars, 2025, 0, 5, 16, 59)).toBe(false); // still Sunday's session (not listed)
        expect(inSessionOn(bars, 2025, 0, 5, 17, 30)).toBe(true); // Monday session (Mon in 23456)
        expect(inSessionOn(bars, 2025, 0, 5, 23, 0)).toBe(true);
        // Monday 2025-01-06: 00:00-16:59 is Monday's session.
        expect(inSessionOn(bars, 2025, 0, 6, 1, 0)).toBe(true);
        expect(inSessionOn(bars, 2025, 0, 6, 16, 59)).toBe(true);
        // Monday 17:00 starts TUESDAY's session (Tue in "23456" → still in).
        expect(inSessionOn(bars, 2025, 0, 6, 17, 0)).toBe(true);
        expect(inSessionOn(bars, 2025, 0, 6, 22, 30)).toBe(true);
    });

it('equal non-zero bounds "0930-0930:12345" wrap like an overnight session', async () => {
        // "12345" = Sun(1), Mon(2), Tue(3), Wed(4), Thu(5); "6"=Fri, "7"=Sat.
        // With equal bounds, a bar at/after 09:30 belongs to the NEXT day's
        // session, a bar before 09:30 to the current day's (TV overnight rule).
        const bars = await runSession('0930-0930:12345');
        // Tue 2024-12-31 (Pine 3): early leg → Tue's session, 09:30+ → Wed's.
        expect(inSessionOn(bars, 2024, 11, 31, 3, 0)).toBe(true);
        expect(inSessionOn(bars, 2024, 11, 31, 12, 0)).toBe(true);
        // Wed 2025-01-01 (Pine 4): 09:30+ rolls into Thu's session (5 ∈ "12345").
        expect(inSessionOn(bars, 2025, 0, 1, 12, 0)).toBe(true);
        // Thu 2025-01-02 (Pine 5): 09:30+ rolls into Fri's session (6 ∉) → out.
        expect(inSessionOn(bars, 2025, 0, 2, 12, 0)).toBe(false);
        // Fri 2025-01-03 (Pine 6): both legs are Fri/Sat sessions (6, 7 ∉).
        expect(inSessionOn(bars, 2025, 0, 3, 3, 0)).toBe(false);
        expect(inSessionOn(bars, 2025, 0, 3, 12, 0)).toBe(false);
        // Sat 2025-01-04 (Pine 7): 09:30+ wraps to SUNDAY's session (1 ∈) → in.
        expect(inSessionOn(bars, 2025, 0, 4, 3, 0)).toBe(false);
        expect(inSessionOn(bars, 2025, 0, 4, 12, 0)).toBe(true);
    });

    it('"0000-0000:23456" is a Monday-Friday 24h session (TV doc example)', async () => {
        // TV: "0000-0000:23456 — A 24-hour session beginning at midnight,
        // but only Monday to Friday." "23456" = Mon..Fri (Pine 1=Sun..7=Sat).
        const bars = await runSession('0000-0000:23456');
        // Wed 2025-01-01 (Pine 4) → in.
        expect(inSessionOn(bars, 2025, 0, 1, 3, 0)).toBe(true);
        // Sat 2025-01-04 (Pine 7) → out.
        expect(inSessionOn(bars, 2025, 0, 4, 12, 0)).toBe(false);
        // Sunday 2025-01-05 (Pine 1) → out.
        expect(inSessionOn(bars, 2025, 0, 5, 12, 0)).toBe(false);
    });

    it('unrecognized session string is NOT a permanent session — always outside', async () => {
        const bars = await runSession('not-a-session');
        expect(inSession(bars, 10, 0)).toBe(false);
        expect(inSession(bars, 3, 0)).toBe(false);
    });
});
