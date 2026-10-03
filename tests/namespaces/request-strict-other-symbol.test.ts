// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `setStrictLookahead(true)` + another symbol: the secondary's bars do not line up with the
 * chart's (a 24/7 chart reading a stock that trades 14:30–21:00 UTC on weekdays), so each chart
 * bar reads the last secondary bar CLOSED by its close (lookahead off) or OPENED by its open
 * (lookahead on, confirmed expressions only). Checked against an oracle built from the raw bars.
 */

import { describe, it, expect } from 'vitest';
import { PineTS, LookaheadLeakError } from 'index';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.UTC(2024, 0, 1); // Monday

type Bar = { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };
const bar = (openTime: number, closeTime: number, close: number): Bar => ({ openTime, closeTime, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1 });

// Chart: 10 days of 24/7 hourly bars.
const chart: Bar[] = Array.from({ length: 10 * 24 }, (_, i) => bar(START + i * HOUR, START + (i + 1) * HOUR, 1000 + i));
// Secondary: weekday session 14:30–21:00 UTC, hourly buckets from the open, the last one 30 min.
const stock: Bar[] = [];
for (let day = 0; day < 10; day++) {
    const weekday = new Date(START + day * DAY).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (let k = 0; k < 7; k++) {
        const open = START + day * DAY + 14.5 * HOUR + k * HOUR;
        stock.push(bar(open, Math.min(open + HOUR, START + day * DAY + 21 * HOUR), day * 100 + k));
    }
}
const stockDaily: Bar[] = [];
for (const b of stock) {
    const last = stockDaily.at(-1);
    if (last && Math.floor(last.openTime / DAY) === Math.floor(b.openTime / DAY)) {
        last.close = b.close;
        last.closeTime = b.closeTime;
    } else stockDaily.push({ ...b });
}

// An index whose daily window opens at 00:00 UTC but whose first print (its `open`) is at 08:15:
// a chart bar opening at 00:00 must not see that open.
const index: Bar[] = Array.from({ length: 10 }, (_, day) => bar(START + day * DAY, START + (day + 1) * DAY, 20 + day));

function provider(requested: string[]) {
    return {
        qualifiedTickers: true,
        isChartTicker: (ticker: string) => ticker === 'EX:CHART' || ticker === 'CHART',
        configure() {},
        async getMarketData(ticker: string, timeframe: string) {
            requested.push(`${ticker}|${timeframe}`);
            if (ticker.endsWith('STK')) return (timeframe === 'D' ? stockDaily : stock).map((b) => ({ ...b }));
            if (ticker.endsWith('IDX')) return index.map((b) => ({ ...b }));
            return chart.map((b) => ({ ...b }));
        },
        async getSymbolInfo(ticker: string) {
            return { ticker, tickerid: ticker.includes(':') ? ticker : `EX:${ticker}`, type: 'stock', currency: 'USD', timezone: 'Etc/UTC', mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1, session: '24x7' };
        },
    };
}

async function run(body: string, requested: string[] = []) {
    const pineTS = new PineTS(provider(requested) as never, 'EX:CHART', '60');
    pineTS.setStrictLookahead(true);
    const ctx = await pineTS.run(`//@version=5\nindicator("other")\n${body}\nplot(v, "v")\n`);
    return ctx.plots.v.data.map((d: { value: number }) => d.value) as number[];
}

/** Index of the last bar whose `key` time is <= `time`, else -1. */
function last(bars: Bar[], key: 'openTime' | 'closeTime', time: number) {
    let found = -1;
    bars.forEach((b, i) => {
        if (b[key] <= time) found = i;
    });
    return found;
}

describe('strict lookahead, another symbol', () => {
    it('lookahead off: the last secondary bar closed by the chart bar close, held over gaps', async () => {
        const requested: string[] = [];
        const values = await run('v = request.security("EX:STK", "60", close)', requested);
        const oracle = chart.map((c) => stock[last(stock, 'closeTime', c.closeTime)]?.close ?? NaN);
        expect(values).toEqual(oracle);
        // Saturday and Sunday hold Friday's last close; nothing before the first close.
        expect(values.filter(Number.isNaN).length).toBe(15);
        expect(requested).toContain('EX:STK|60');
    });

    it('higher timeframe: the session-shaped daily bar shows once it closed (21:00), not at UTC midnight', async () => {
        const values = await run('v = request.security("EX:STK", "D", close)');
        const oracle = chart.map((c) => stockDaily[last(stockDaily, 'closeTime', c.closeTime)]?.close ?? NaN);
        expect(values).toEqual(oracle);
        expect(values[20]).toBe(6); // the chart bar 20:00–21:00 closes with Monday's session
        expect(values[19]).toBeNaN(); // 19:00–20:00: Monday's session is still open
    });

    it('gaps on: na unless a new secondary bar closed', async () => {
        const values = await run('v = request.security("EX:STK", "60", close, gaps=barmerge.gaps_on)');
        // A value shows on the chart bar where a new secondary bar closed; the call site's very
        // first evaluation (chart bar 0) only records its bar.
        let previous: number | undefined;
        const oracle = chart.map((c, i) => {
            const j = last(stock, 'closeTime', c.closeTime);
            if (j < 0 || j === previous) return NaN;
            previous = j;
            return i === 0 ? NaN : stock[j].close;
        });
        // 8 sessions × 7 bars, but 19:30–20:30 and 20:30–21:00 both close inside the chart's 20:00–21:00 bar.
        expect(oracle.filter(Number.isFinite).length).toBe(8 * 6);
        expect(values).toEqual(oracle);
    });

    it('lookahead on is refused for an unconfirmed expression, even on the chart timeframe', async () => {
        await expect(run('v = request.security("EX:STK", "60", close, lookahead=barmerge.lookahead_on)')).rejects.toBeInstanceOf(LookaheadLeakError);
        await expect(run('v = request.security("EX:STK", "D", close, lookahead=barmerge.lookahead_on)')).rejects.toBeInstanceOf(LookaheadLeakError);
    });

    it('lookahead on with close[1]: the bar before the last one opened by the chart bar open', async () => {
        const values = await run('v = request.security("EX:STK", "60", close[1], lookahead=barmerge.lookahead_on)');
        const oracle = chart.map((c) => {
            const j = last(stock, 'openTime', c.openTime);
            return j >= 1 ? stock[j - 1].close : NaN;
        });
        expect(values).toEqual(oracle);
        // No value is ever newer than the last close known at the chart bar's open.
        chart.forEach((c, i) => {
            const known = last(stock, 'closeTime', c.openTime);
            if (!Number.isNaN(values[i])) expect(values[i]).toBeLessThanOrEqual(stock[known].close);
        });
    });

    it("the chart's own Heikin-Ashi series keeps the chart's alignment and lookahead rule", async () => {
        const values = await run('v = request.security(ticker.heikinashi(syminfo.tickerid), "60", close, lookahead=barmerge.lookahead_on)');
        expect(values.filter(Number.isFinite).length).toBe(chart.length);
    });

    it('lookahead on with a bare `open` of another symbol is refused (its bar opens before its first print)', async () => {
        await expect(run('v = request.security("EX:IDX", "D", open, lookahead=barmerge.lookahead_on)')).rejects.toBeInstanceOf(LookaheadLeakError);
        await expect(run('v = request.security("EX:STK", "60", open, lookahead=barmerge.lookahead_on)')).rejects.toBeInstanceOf(LookaheadLeakError);
        await expect(run('[v, w] = request.security("EX:IDX", "D", [open, close[1]], lookahead=barmerge.lookahead_on)')).rejects.toBeInstanceOf(LookaheadLeakError);
        // `time` (the bar's nominal start) and `open[1]` stay served.
        const times = await run('v = request.security("EX:IDX", "D", time, lookahead=barmerge.lookahead_on)');
        expect(times).toEqual(chart.map((c) => index[last(index, 'openTime', c.openTime)].openTime));
        const previous = await run('v = request.security("EX:IDX", "D", open[1], lookahead=barmerge.lookahead_on)');
        expect(previous).toEqual(chart.map((c) => index[last(index, 'openTime', c.openTime) - 1]?.open ?? NaN));
    });

    it('the provider decides which qualified tickers name the chart symbol', async () => {
        const requested: string[] = [];
        // Same ticker, other exchange: another symbol for this provider (an index sharing a stock's ticker).
        const values = await run('v = request.security("IDX:CHART", "60", close)', requested);
        expect(requested).toContain('IDX:CHART|60');
        expect(values).toEqual(chart.map((c) => c.close));
        await expect(run('v = request.security("IDX:CHART", "60", close, lookahead=barmerge.lookahead_on)')).rejects.toBeInstanceOf(LookaheadLeakError);
        // The chart's own tickerid keeps the same-symbol shortcut (no data request).
        const own: string[] = [];
        await run('v = request.security("EX:CHART", "60", close, lookahead=barmerge.lookahead_on)', own);
        expect(own.filter((r) => r !== 'EX:CHART|60')).toEqual([]);
    });
});
