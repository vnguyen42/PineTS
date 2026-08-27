// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Implicit return of a trailing declaration (corpus 2030).
 *
 * Pine returns the value of a local variable when that declaration is the last
 * statement in a function body. The call-site must therefore receive the
 * declared value instead of JavaScript's implicit undefined.
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

describe('implicit return of trailing declaration (2030)', () => {
    it('returns a trailing local declaration from the function call-site', async () => {
        const source = `
//@version=5
indicator("implicit declaration return")
f(x) =>
    result = x * 2
plot(f(21), "result")
`;
        const engine = new PineTS(makeBars(), 'TEST', 'D');
        const { plots } = await engine.run(source);
        const values = plots['result']?.data ?? [];

        expect(values.length).toBeGreaterThan(0);
        expect(values[values.length - 1]?.value).toBe(42);
    });
});
