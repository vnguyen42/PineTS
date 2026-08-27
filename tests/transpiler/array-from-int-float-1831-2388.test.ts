// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * array.from int/float inference (corpus 1831/2388).
 *
 * Pine preserves the float type expressed by `0.` even though JavaScript
 * represents both `0` and `0.` as the same Number. A legal float write into
 * that array must remain accepted at runtime.
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

describe('array.from int/float inference (1831/2388)', () => {
    it('accepts a float array.set after float literal construction', async () => {
        const source = `
//@version=5
indicator("array float literals")
var values = array.from(0., 0.)
array.set(values, 0, 1.5)
plot(array.get(values, 0), "value")
`;
        const engine = new PineTS(makeBars(), 'TEST', 'D');
        const { plots } = await engine.run(source);
        const values = plots['value']?.data ?? [];

        expect(values.length).toBeGreaterThan(0);
        expect(values[values.length - 1]?.value).toBe(1.5);
    });
});
