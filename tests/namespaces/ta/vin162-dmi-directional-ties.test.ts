import { expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const source = `//@version=6
indicator("Directional movement tie witness")
[plus, minus, strength] = ta.dmi(1, 1)
plot(plus, "Plus DI")
plot(minus, "Minus DI")
plot(strength, "ADX")
`;
const bars = (prices: number[][]) => prices.map(([open, high, low, close], i) => ({
    openTime: i * 60_000, closeTime: (i + 1) * 60_000 - 1, open, high, low, close, volume: 1,
}));

// UNIUSDT 4h OHLC from the 2026-09-07 TradingView export. Decimal
// up/down are equal (.014 and .026); binary subtraction picks minus DM.
it.each([
    [[6, 6.017, 5.953, 5.981], [5.98, 6.031, 5.939, 5.954]],
    [[3.87, 3.914, 3.862, 3.893], [3.892, 3.94, 3.836, 3.898]],
])('does not assign either direction to equal real high/low movements', async (previous, current) => {
    const result = await new PineTS(bars([previous, current])).run(source);
    for (const name of ['Plus DI', 'Minus DI', 'ADX']) {
        expect(result.plots[name].data.at(-1)!.value).toBe(0);
    }
});

it('preserves a real small-price movement difference below an absolute 1e-10', async () => {
    // Same 7e-11 separation as the existing TV-proven small-price relational
    // witness: an absolute rounding of ten decimal places would erase it.
    const result = await new PineTS(bars([
        [0.00001, 0.00002, 0.000005, 0.00001],
        [0.00001, 0.00002100007, 0.000004, 0.00001],
    ])).run(source);
    expect(result.plots['Plus DI'].data.at(-1)!.value).toBeGreaterThan(0);
    expect(result.plots['Minus DI'].data.at(-1)!.value).toBe(0);
    expect(result.plots['ADX'].data.at(-1)!.value).toBe(100);
});

it('keeps DMI smoothing identical after tail correction and extension', async () => {
    const candles = bars(Array.from({ length: 45 }, (_, i) => i % 2
        ? [5.98, 6.031, 5.939, 5.954] : [6, 6.017, 5.953, 5.981]));
    let count = 30;
    const provider = { configure() {}, async getMarketData(_s, _t, _l, start) {
        return candles.slice(0, count).filter(c => start === undefined || c.openTime >= start);
    }, async getSymbolInfo() { return { ticker: 'UNIUSDT', tickerid: 'FILE:UNIUSDT', type: 'crypto',
        currency: 'USDT', timezone: 'Etc/UTC', mintick: .001, pointvalue: 1, session: '24x7' }; } };
    const smoothedSource = source.replace('ta.dmi(1, 1)', 'ta.dmi(14, 14)');
    const engine = new PineTS(provider as any, 'UNIUSDT', '1');
    const context = await engine.run(smoothedSource);
    for (const next of [30, 35, 35, 45]) {
        count = next;
        candles[count - 1].high += .001;
        await engine.updateTail(context);
        const full = await new PineTS(provider as any, 'UNIUSDT', '1').run(smoothedSource);
        expect(context.plots).toEqual(full.plots);
    }
});
