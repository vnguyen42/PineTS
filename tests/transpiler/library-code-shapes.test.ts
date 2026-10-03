import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { findLTFContextIdx } from '../../src/namespaces/request/utils/findLTFContextIdx';

// Shapes found in published TradingView libraries (jason5480/chrono_utils/7,
// Trading-IQ/ICTlibrary/1) that the transpiler rejected or miscompiled.

const DAY = 86_400_000;
const bars = Array.from({ length: 5 }, (_, i) => ({
    openTime: i * DAY, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000, closeTime: (i + 1) * DAY - 1,
}));

async function lastPlots(source: string): Promise<number[]> {
    const { plots } = await new PineTS(bars).run(source);
    return Object.entries(plots)
        .filter(([key]) => !key.startsWith('__'))
        .map(([, plot]: [string, { data: { value: number }[] }]) => plot.data.at(-1)!.value);
}

describe('library code shapes', () => {
    it('dispatches a user method called on a parenthesized ternary, inside and outside call arguments', async () => {
        expect(await lastPlots(`
//@version=5
indicator("x")
type T
    int v = 1
method get(T this) => this.v
T a = T.new(2)
f(int x) => x * 10
plot(f((na(a) ? T.new() : a).get()))
plot((na(a) ? T.new() : a).get())`)).toEqual([20, 2]);
    });

    it('accepts dotted parameter types (chart.point, chart.point[]) in functions and methods', async () => {
        expect(await lastPlots(`
//@version=5
indicator("x")
f(chart.point p, int k) => p.price * k
method g(array<float> a, chart.point p) => a.push(p.price)
h(chart.point[] pts) => pts.size()
pt = chart.point.from_index(bar_index, close)
arr = array.new<float>()
arr.g(pt)
plot(f(pt, 2))
plot(h(array.from(pt, pt)))
plot(arr.size())`)).toEqual([209, 2, 1]);
    });
});

describe('findLTFContextIdx', () => {
    // Four 15-minute intrabars per hour, hours 0..2.
    const open = Array.from({ length: 12 }, (_, i) => i * 900_000);
    const close = open.map((t) => t + 900_000 - 1);
    const hour = (h: number): [number, number] => [h * 3_600_000, (h + 1) * 3_600_000 - 1];

    it('reads the last intrabar of the chart bar, or its first one with lookahead', () => {
        expect(findLTFContextIdx(...hour(1), open, close)).toBe(7);
        expect(findLTFContextIdx(...hour(1), open, close, true)).toBe(4);
    });

    it('is -1 when no intrabar lies inside the chart bar', () => {
        expect(findLTFContextIdx(...hour(5), open.slice(0, 4), close.slice(0, 4))).toBe(-1);
        expect(findLTFContextIdx(-3_600_000, -1, open, close)).toBe(-1);
    });
});
