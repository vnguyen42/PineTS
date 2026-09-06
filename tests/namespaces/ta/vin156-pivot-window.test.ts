// VIN-156: Pivot Point SuperTrend (corpus 1621) recomputed all historical pivots per bar.
import { describe, it, expect } from 'vitest';
import { Series } from '../../../src/Series';
import { pivothigh } from '../../../src/namespaces/ta/methods/pivothigh';
import { pivotlow } from '../../../src/namespaces/ta/methods/pivotlow';
import { pivothigh as fullHigh } from '../../../src/namespaces/ta/utils/pivothigh';
import { pivotlow as fullLow } from '../../../src/namespaces/ta/utils/pivotlow';

describe('VIN-156 current pivot window', () => {
    for (const [name, method, reference] of [['high', pivothigh, fullHigh], ['low', pivotlow, fullLow]] as const) {
        it(`${name}: reads only the requested window on the real expensive call shape`, () => {
            const values = Array.from({ length: 1000 }, (_, i) => Math.sin(i / 3) * 10);
            let reads = 0;
            const tracked = new Proxy(values, { get(target, key, receiver) {
                if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
                return Reflect.get(target, key, receiver);
            }});
            const context = { idx: 999, precision: (x: number) => x };
            const value = method(context)(new Series(tracked), 2, 2, 'pivot');
            expect(value).toBe(reference(values, 2, 2)[999]);
            expect(reads).toBeLessThanOrEqual(5);
        });
        it(`${name}: preserves warmup, ties, na, offsets, conditional histories and dynamic widths`, () => {
            const values = [1, 4, 4, 3, NaN, 5, 2, 2, 6, 6, 1, 0, -0, 5];
            for (const [left, right] of [[0, 0], [2, 2], [4, 1], [1, 4], [20, 2], [1.5, 2.5], [NaN, 2]]) {
                const expected = reference(values, left, right);
                for (const idx of [-1, 0, 1, 4, 7, 9, 13, 14, 21]) {
                    const context = { idx, precision: (x: number) => x };
                    for (const offset of [0, 2]) expect(method(context)(new Series(values, offset), left, right, 'pivot')).toBe(expected[idx]);
                }
            }
        });
    }
});
