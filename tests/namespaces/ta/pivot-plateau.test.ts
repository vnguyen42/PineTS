import { describe, expect, it } from 'vitest';

import { PineTS } from 'PineTS.class';

type PlotValues = Record<string, (number | null)[]>;
type Candle = {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

function candles(highs: number[], lows: number[] = highs): Candle[] {
    return highs.map((high, index) => ({
        openTime: index * 60_000,
        open: high,
        high,
        low: lows[index],
        close: high,
        volume: 1,
    }));
}

async function runPivots(data: Candle[], expressions: Record<string, string>): Promise<PlotValues> {
    const plots = Object.entries(expressions)
        .map(([title, expression]) => `plot(${expression}, "${title}")`)
        .join('\n');
    const pineTS = new PineTS(data);
    const result = await pineTS.run(`
//@version=5
indicator("pivot plateau contract")
${plots}
`);

    return Object.fromEntries(
        Object.entries(expressions).map(([title]) => [
            title,
            result.plots[title].data.map(({ value }) => (Number.isNaN(value) ? null : value)),
        ]),
    );
}

describe('ta.pivothigh/pivotlow plateau equality', () => {
    it('accepts an old-side high/low equality and rejects a recent-side equality', async () => {
        const highOldSide = await runPivots(candles([1, 5, 5, 2]), {
            pivot: 'ta.pivothigh(high, 1, 1)',
        });
        const highRecentSide = await runPivots(candles([1, 5, 5, 6]), {
            pivot: 'ta.pivothigh(high, 1, 1)',
        });
        const lowOldSide = await runPivots(candles([9, 5, 5, 8], [9, 5, 5, 8]), {
            pivot: 'ta.pivotlow(low, 1, 1)',
        });
        const lowRecentSide = await runPivots(candles([9, 5, 5, 4], [9, 5, 5, 4]), {
            pivot: 'ta.pivotlow(low, 1, 1)',
        });

        expect(highOldSide.pivot).toEqual([null, null, null, 5]);
        expect(highRecentSide.pivot).toEqual([null, null, null, null]);
        expect(lowOldSide.pivot).toEqual([null, null, null, 5]);
        expect(lowRecentSide.pivot).toEqual([null, null, null, null]);
    });

    it('keeps the rightmost pivot with asymmetric left/right windows', async () => {
        const result = await runPivots(candles([0, 5, 5, 2, 1], [10, 5, 5, 8, 9]), {
            high: 'ta.pivothigh(high, 2, 1)',
            low: 'ta.pivotlow(low, 2, 1)',
        });

        expect(result.high).toEqual([null, null, null, 5, null]);
        expect(result.low).toEqual([null, null, null, 5, null]);
    });

    it('supports the two-argument overload using the default high/low source', async () => {
        const result = await runPivots(candles([1, 5, 5, 2], [9, 5, 5, 8]), {
            high: 'ta.pivothigh(1, 1)',
            low: 'ta.pivotlow(1, 1)',
        });

        expect(result.high).toEqual([null, null, null, 5]);
        expect(result.low).toEqual([null, null, null, 5]);
    });

    it('keeps a non-plateau pivot unchanged', async () => {
        const result = await runPivots(candles([1, 4, 6, 3, 2], [9, 7, 5, 8, 9]), {
            high: 'ta.pivothigh(high, 1, 1)',
            low: 'ta.pivotlow(low, 1, 1)',
        });

        expect(result.high).toEqual([null, null, null, 6, null]);
        expect(result.low).toEqual([null, null, null, 5, null]);
    });
});
