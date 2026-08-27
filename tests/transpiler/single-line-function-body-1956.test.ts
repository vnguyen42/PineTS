// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Single-line function body containing a statement (corpus 1956).
 *
 * Pine allows a declaration as the body of a single-line function. Its value
 * is the function result, just as for an indented function body.
 */

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

function makeBars(count = 8) {
    const start = Date.UTC(2020, 0, 1);
    const bars = [];
    for (let i = 0; i < count; i++) {
        bars.push({
            openTime: start + i * 86_400_000,
            open: 100 + i,
            high: 101 + i,
            low: 99 + i,
            close: 100 + i,
            volume: 1_000 + i,
        });
    }
    return bars;
}

describe('single-line function body statement (1956)', () => {
    it('returns the value of a declaration in a single-line body', async () => {
        const source = `
//@version=5
indicator("single-line declaration")
f(x) => y = x * 2
plot(f(21), "result")
`;
        const engine = new PineTS(makeBars(), 'TEST', 'D');
        const { plots } = await engine.run(source);
        const values = plots['result']?.data ?? [];

        expect(values.length).toBeGreaterThan(0);
        expect(values[values.length - 1]?.value).toBe(42);
    });
});
