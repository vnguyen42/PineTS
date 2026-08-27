// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Call-expression indexes on history subscripts (corpus 1859/2611).
 *
 * The call used as the history index must be transformed with its operands;
 * otherwise a context-bound index identifier escapes its generated scope and
 * the call-site does not read the intended previous bar.
 */

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

function makeBars(count = 12) {
    const start = Date.UTC(2020, 0, 1);
    const bars = [];
    for (let i = 0; i < count; i++) {
        bars.push({
            openTime: start + i * 86_400_000,
            open: 100 + i * 2,
            high: 101 + i * 2,
            low: 99 + i * 2,
            close: 100 + i * 2,
            volume: 1_000 + i,
        });
    }
    return bars;
}


describe('history subscript with call-expression index (1859/2611)', () => {
    it('transforms the call index and matches the equivalent fixed history read', async () => {
        const source = `
//@version=6
indicator("call index")
levels = array.from(1, 2)
i = 0
plot(close[array.get(levels, i)], "actual")
plot(close[1], "expected")
`;
        const engine = new PineTS(makeBars(), 'TEST', 'D');
        const { plots } = await engine.run(source);
        const actual = (plots['actual']?.data ?? []).map((point: { value?: unknown }) => Number(point.value));
        const expected = (plots['expected']?.data ?? []).map((point: { value?: unknown }) => Number(point.value));

        let compared = 0;
        for (let i = 1; i < expected.length; i++) {
            if (!Number.isFinite(expected[i])) continue;
            expect(actual[i]).toBeCloseTo(expected[i], 10);
            compared++;
        }
        expect(compared).toBeGreaterThan(3);
    });
});
