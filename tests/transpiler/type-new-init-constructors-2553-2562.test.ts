// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Type.new().init(…) constructor receivers (corpus 2553/2562).
 *
 * A direct UDT factory call is a typed receiver, so Pine must dispatch the
 * following method through the method runtime rather than a raw `.init` lookup.
 * The assertion is deliberately end-to-end: the observable value is the
 * initialized field returned by the method chain.
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

describe('Type.new().init(…) constructor receivers (2553/2562)', () => {
    it('dispatches init on a direct UDT constructor receiver', async () => {
        const source = `
//@version=6
indicator("constructor receiver")
type Foo
    int value = 0
method init(Foo this, int x) =>
    this.value := x
    this
f = Foo.new().init(7)
plot(f.value, "value")
`;
        const engine = new PineTS(makeBars(), 'TEST', 'D');
        const { plots } = await engine.run(source);
        const values = plots['value']?.data ?? [];

        expect(values.length).toBeGreaterThan(0);
        expect(values[values.length - 1]?.value).toBe(7);
    });
});
