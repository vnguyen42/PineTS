// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Timeframe multi-unit coverage (review findings H1/M1/L1 on the multi-unit
// diff): alignToTimeframe must honor the N multiplier of calendar timeframes
// ('3D'/'2W'/'2M'), out-of-bounds multipliers must reject like security(),
// and multi-unit forms are case-insensitive ('2d' ≡ '2D').
//
// RED-PROOF: every assertion below was proven failing on the pre-fix code
// (the diff that dropped the multiplier, had no bounds, and left '2d'
// unresolvable) — time('3D') changed every bar, '2W'/'2M' aligned like
// 'W'/'M', time('370D')/'0D' did not throw, and request.security('2d')
// crashed with 'Invalid timeframe'.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BaseProvider, PineTS } from 'index';
import { normalizeTimeframe } from '../../src/namespaces/request/utils/TIMEFRAMES';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

type Candle = {
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

function dailyFeed(startDay: number, n: number): Candle[] {
    const bars: Candle[] = [];
    for (let i = 0; i < n; i++) {
        const openTime = startDay * DAY_MS + i * DAY_MS;
        bars.push({ openTime, closeTime: openTime + DAY_MS - 1, open: 100, high: 101, low: 99, close: 100, volume: 1 });
    }
    return bars;
}

function h4Feed(startDay: number, nDays: number): Candle[] {
    const bars: Candle[] = [];
    for (let d = 0; d < nDays; d++) {
        for (let h = 0; h < 6; h++) {
            const openTime = (startDay + d) * DAY_MS + h * 4 * HOUR_MS;
            bars.push({ openTime, closeTime: openTime + 4 * HOUR_MS - 1, open: 100, high: 101, low: 99, close: 100, volume: 1 });
        }
    }
    return bars;
}

function m15Feed(startDay: number, nBars: number): Candle[] {
    const bars: Candle[] = [];
    for (let i = 0; i < nBars; i++) {
        const openTime = startDay * DAY_MS + i * 15 * 60_000;
        bars.push({ openTime, closeTime: openTime + 15 * 60_000 - 1, open: 100, high: 101, low: 99, close: 100, volume: 1 });
    }
    return bars;
}

class NativeDailyProvider extends BaseProvider {
    constructor(private readonly candles: Candle[]) {
        super({ requiresApiKey: false, providerName: 'NativeDaily' });
    }

    protected getSupportedTimeframes(): Set<string> {
        return new Set(['D']);
    }

    protected async _getMarketDataNative(
        _tickerId: string,
        _timeframe: string,
        _limit?: number,
        _sDate?: number,
        _eDate?: number,
    ): Promise<any[]> {
        return this.candles;
    }

    async getSymbolInfo(): Promise<any> {
        return { tickerid: 'TEST', timezone: 'Etc/UTC' };
    }
}

async function plotSeries(bars: Candle[], chartTF: string, code: string, key: string): Promise<number[]> {
    const engine = new PineTS(bars, 'TEST', chartTF);
    const ctx = await engine.run(code);
    return (ctx.plots[key]?.data ?? [])
        .map((p: { value: number | null }) => p.value)
        .filter((v): v is number => v != null && !Number.isNaN(v));
}

function changeBars(series: number[]): number[] {
    const out: number[] = [];
    for (let i = 1; i < series.length; i++) {
        if (series[i] !== series[i - 1]) out.push(i);
    }
    return out;
}

const PROBE = (expr: string, key: string) =>
    `//@version=5\nindicator("probe")\n${expr}\nplot(${key}, "${key}")`;

describe('timeframe multi-unit — H1: N-period bucketing', () => {
    it('time("3D") changes every 3 bars on a 1D chart (epoch-anchored day buckets)', async () => {
        // 2024-01-03 is dayIndex 19725 ≡ 0 (mod 3): the first 3-day bucket opens on bar 0.
        const startDay = 19725;
        const bars = dailyFeed(startDay, 12);
        const t3d = await plotSeries(bars, 'D', PROBE('t3d = time("3D")', 't3d'), 't3d');

        const expected = bars.map((c) => Math.floor((c.openTime / DAY_MS) / 3) * 3 * DAY_MS);
        expect(t3d).toEqual(expected);
        expect(changeBars(t3d)).toEqual([3, 6, 9]);
    });

    it('time("2W") changes every 2 weeks on a 1D chart (Monday-anchored week buckets)', async () => {
        // 2023-12-25 is a Monday with weekIndex 2816 ≡ 0 (mod 2): the first
        // 2-week bucket opens on bar 0.
        const startDay = 19716;
        const t2w = await plotSeries(dailyFeed(startDay, 42), 'D', PROBE('t2w = time("2W")', 't2w'), 't2w');

        expect(changeBars(t2w)).toEqual([14, 28]);
        expect([...new Set(t2w)]).toEqual([19716 * DAY_MS, 19730 * DAY_MS, 19744 * DAY_MS]);
    });

    it('time("2M") changes every 2 months on a 1D chart (calendar month buckets)', async () => {
        // 2024-01 has monthIndex 24288 ≡ 0 (mod 2): buckets {Jan,Feb}, {Mar,Apr}, {May,Jun}.
        const startDay = 19723;
        const t2m = await plotSeries(dailyFeed(startDay, 150), 'D', PROBE('t2m = time("2M")', 't2m'), 't2m');

        expect(changeBars(t2m)).toEqual([60, 121]);
    });

    it('ta.change(time("3D")) fires once per 3 days on a 4h chart', async () => {
        const startDay = 19725; // ≡ 0 (mod 3), first 3-day bucket opens on bar 0
        const chg = await plotSeries(
            h4Feed(startDay, 12),
            '240',
            PROBE('chg = ta.change(time("3D")) != 0 ? 1 : 0', 'chg'),
            'chg',
        );

        const fires: number[] = [];
        for (let i = 0; i < chg.length; i++) {
            if (chg[i] === 1) fires.push(i);
        }
        expect(fires).toEqual([18, 36, 54]); // one per 3-day bucket, none inside
    });
});

describe('timeframe multi-unit — M1: bounds reject like security()', () => {
    it.each(['370D', '0D', '0W', '53W', '13M'])('time("%s") rejects "Invalid timeframe"', async (tf) => {
        const engine = new PineTS(dailyFeed(19725, 12), 'TEST', 'D');
        await expect(
            engine.run(PROBE(`x = time("${tf}")`, 'x')),
        ).rejects.toThrow('Invalid timeframe');
    });

    it('boundary multipliers are accepted: 365D / 52W / 12M', async () => {
        const code = `
//@version=5
indicator("probe")
a = time("365D")
b = time("52W")
c = time("12M")
plot(a, "a")
plot(b, "b")
plot(c, "c")
`;
        const engine = new PineTS(dailyFeed(19725, 12), 'TEST', 'D');
        const ctx = await engine.run(code);
        expect(ctx.plots['a'].data.length).toBe(12);
        expect(ctx.plots['b'].data.length).toBe(12);
        expect(ctx.plots['c'].data.length).toBe(12);
    });
});

describe('timeframe multi-unit — L1: case-insensitive forms', () => {
    it('request.security("2d") == request.security("2D")', async () => {
        // Chart '2D' + raw daily feed (engine tickerId 'TEST'): both requests
        // resolve to 2880 min == the chart timeframe → same-timeframe shortcut,
        // exercising exactly the request.security validation that used to throw
        // 'Invalid timeframe' on the lowercase form.
        const code = `
//@version=5
indicator("probe")
a = request.security("TEST", "2d", close)
b = request.security("TEST", "2D", close)
plot(a, "a")
plot(b, "b")
`;
        const engine = new PineTS(dailyFeed(19725, 12), 'TEST', '2D');
        const ctx = await engine.run(code);
        const a = (ctx.plots['a'].data ?? []).map((p: { value: number | null }) => p.value).filter((v): v is number => v != null);
        const b = (ctx.plots['b'].data ?? []).map((p: { value: number | null }) => p.value).filter((v): v is number => v != null);
        expect(a).toHaveLength(12);
        expect(b).toHaveLength(12);
        expect(a).toEqual(b);
    });

    it('time("2d") == time("2D")', async () => {
        // 2024-01-02 is dayIndex 19724 ≡ 0 (mod 2): the first 2-day bucket opens on bar 0.
        const startDay = 19724;
        const a = await plotSeries(dailyFeed(startDay, 12), 'D', PROBE('a = time("2d")', 'a'), 'a');
        const b = await plotSeries(dailyFeed(startDay, 12), 'D', PROBE('b = time("2D")', 'b'), 'b');
        expect(a).toEqual(b);
        expect(changeBars(a)).toEqual([2, 4, 6, 8, 10]);
    });
});

describe('timeframe multi-unit — re-review F1: uppercase months', () => {
    it('normalizes uppercase month multipliers before lowercase minute aliases', () => {
        expect(normalizeTimeframe('3M')).toBe('3M');
        expect(normalizeTimeframe('5M')).toBe('5M');
        expect(normalizeTimeframe('15M')).toBe('15M');
        expect(normalizeTimeframe('30M')).toBe('30M');
        expect(normalizeTimeframe('45M')).toBe('45M');
        expect(normalizeTimeframe('3m')).toBe('3');
        expect(normalizeTimeframe('1M')).toBe('M');
        expect(normalizeTimeframe('1m')).toBe('1');
    });
    it('time("3M") uses 3-month calendar buckets on a 1D chart', async () => {
        // January 2024 starts a 3-month bucket: {Jan,Feb,Mar}, {Apr,May,Jun},
        // {Jul,Aug,Sep}. The lowercase-minute collision changes every daily bar.
        const t3m = await plotSeries(
            dailyFeed(19723, 210),
            'D',
            PROBE('t3m = time("3M")', 't3m'),
            't3m',
        );
        expect(changeBars(t3m)).toEqual([91, 182]);
    });


    it('timeframe.change("3M") fires once at the next 3-month boundary on 4h data', async () => {
        const chg = await plotSeries(
            h4Feed(19723, 120),
            '240',
            PROBE('chg = timeframe.change("3M") ? 1 : 0', 'chg'),
            'chg',
        );
        const fires: number[] = [];
        for (let i = 0; i < chg.length; i++) {
            if (chg[i] === 1) fires.push(i);
        }
        // 2024-04-01 is day 91, hence 91 * 6 = 546 on a 4h feed.
        expect(fires).toEqual([546]);
    });

    it('Timeframe properties keep uppercase M as months and lowercase m as minutes', async () => {
        const properties = async (chartTF: string) => {
            const engine = new PineTS(dailyFeed(19723, 12), 'TEST', chartTF);
            const context = await engine.run((context: any) => {
                const timeframe = context.pine.timeframe;
                return {
                    period: timeframe.period,
                    multiplier: timeframe.multiplier,
                    ismonthly: timeframe.ismonthly,
                    isminutes: timeframe.isminutes,
                };
            });
            const result = context.result as Record<string, any[]>;
            const last = (key: string) => result[key][result[key].length - 1];
            return {
                period: last('period'),
                multiplier: last('multiplier'),
                ismonthly: last('ismonthly'),
                isminutes: last('isminutes'),
            };
        };

        await expect(properties('3M')).resolves.toEqual({
            period: '3M',
            multiplier: 3,
            ismonthly: true,
            isminutes: false,
        });
        await expect(properties('5M')).resolves.toMatchObject({ period: '5M', ismonthly: true, isminutes: false });
        await expect(properties('15M')).resolves.toMatchObject({ period: '15M', ismonthly: true, isminutes: false });
        await expect(properties('30M')).resolves.toMatchObject({ period: '30M', ismonthly: true, isminutes: false });
        await expect(properties('45M')).resolves.toMatchObject({ period: '45M', ismonthly: true, isminutes: false });
        await expect(properties('3m')).resolves.toEqual({
            period: '3',
            multiplier: 3,
            ismonthly: false,
            isminutes: true,
        });
        await expect(properties('1M')).resolves.toEqual({
            period: 'M',
            multiplier: 1,
            ismonthly: true,
            isminutes: false,
        });
        await expect(properties('1m')).resolves.toEqual({
            period: '1',
            multiplier: 1,
            ismonthly: false,
            isminutes: true,
        });
    });
});

describe('timeframe multi-unit — re-review F2: provider failure is loud', () => {
    it('request.security("2D") rejects instead of returning silent nulls', async () => {
        const engine = new PineTS(new NativeDailyProvider(dailyFeed(19723, 90)), 'TEST', 'D');
        const code = `
//@version=5
indicator("unsupported 2D security")
d = request.security(syminfo.tickerid, "2D", close)
plot(d, "d")
`;
        await expect(engine.run(code)).rejects.toThrow('Unsupported multi-unit timeframe aggregation: 2D');
    });
});

describe('timeframe multi-unit — controls remain byte-equivalent', () => {
    const hash = (values: unknown[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex');

    const controlHashes = {
        D_1D: '0cbcbc1003e910f4dd407438f3c308123edec315befca77b35126c2a78e1bf0c',
        D_1W: '5889f8c4b3152e63f13332546814ae6814fcb44113048104fb41d256057527eb',
        D_1M: '63445a89396c5261be75cdc3b6b085d55f72ac07120fc11c807afa996bd8702b',
        M15_3m: 'f7d8935a32e9a4e8146133ed69b27fa21b8101a62bb1b542b9dd4fc7cdf8cfc2',
        M15_240: '443d3fa5655789280abbc486b5150546f7d38c689144df165adfa580954c3bdb',
        M15_1440: '414d7f4570d7278b3c596b59097bb8698101bed54af9b0da489729507691f8db',
        chg_D_1D: 'eb561ff2c4561786d6dedeedcc0317e3deee57e8e6ac61806bf68d97e8f9f255',
        chg_D_1W: '4ccd04b4c613819eaaedb61a9897a4655d7fa16876caa943f80cb23f61f3af2d',
        chg_D_1M: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
        chg_15_3m: 'f009e346b49498d7d8e8cc24c76f5300f3abbe7928b16c00fcb660bebcef5a7a',
        chg_15_240: 'c4a2b1b2696e9aa95adf7e312cf02cf7e0a22746279c67e55d7d90019ef91916',
        chg_15_1440: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    };

    const changeFires = async (bars: Candle[], chartTF: string, timeframe: string) => {
        const values = await plotSeries(
            bars,
            chartTF,
            PROBE(`chg = timeframe.change("${timeframe}") ? 1 : 0`, 'chg'),
            'chg',
        );
        const fires: number[] = [];
        for (let i = 0; i < values.length; i++) {
            if (values[i] === 1) fires.push(i);
        }
        return fires;
    };

    it('keeps N=1 and minute time()/timeframe.change() series unchanged', async () => {
        const startDay = 19723;
        const controls: Record<string, unknown[]> = {
            D_1D: await plotSeries(dailyFeed(startDay, 20), 'D', PROBE('a = time("1D")', 'a'), 'a'),
            D_1W: await plotSeries(dailyFeed(startDay, 20), 'D', PROBE('a = time("1W")', 'a'), 'a'),
            D_1M: await plotSeries(dailyFeed(startDay, 20), 'D', PROBE('a = time("1M")', 'a'), 'a'),
            M15_3m: await plotSeries(m15Feed(startDay, 40), '15', PROBE('a = time("3m")', 'a'), 'a'),
            M15_240: await plotSeries(m15Feed(startDay, 40), '15', PROBE('a = time("240")', 'a'), 'a'),
            M15_1440: await plotSeries(m15Feed(startDay, 40), '15', PROBE('a = time("1440")', 'a'), 'a'),
            chg_D_1D: await changeFires(dailyFeed(startDay, 20), 'D', '1D'),
            chg_D_1W: await changeFires(dailyFeed(startDay, 20), 'D', '1W'),
            chg_D_1M: await changeFires(dailyFeed(startDay, 20), 'D', '1M'),
            chg_15_3m: await changeFires(m15Feed(startDay, 40), '15', '3m'),
            chg_15_240: await changeFires(m15Feed(startDay, 40), '15', '240'),
            chg_15_1440: await changeFires(m15Feed(startDay, 40), '15', '1440'),
        };

        for (const [name, values] of Object.entries(controls)) {
            expect(hash(values), name).toBe(controlHashes[name as keyof typeof controlHashes]);
        }
    });
});
