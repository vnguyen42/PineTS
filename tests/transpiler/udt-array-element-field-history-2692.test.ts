// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Family: UDT field subscript `obj.field[N]` (udt-field-subscript.test.ts) —
// the UDT instance registry missed bindings read from a UDT array.
// Revealing script: 2692 (`var aUniBl = array.new<unicorn>(2, unicorn.new(…))`,
// `firstBl = aUniBl.first()`, then `if … not firstBl.active[1]` and
// `close[1] < firstBl.TsL[1]`). Unregistered, `firstBl` was never lowered
// inside the if-test: the generated JS read a free `firstBl` (ReferenceError
// at run time, refused by Studio's safe-script gate). Registered, the
// subscript reads the historic object like any UDT instance: `(firstBl[1]).active`.

import { describe, it, expect } from 'vitest';
import { transpile } from '../../src/transpiler/index';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';

const source = `//@version=5
indicator("udt array element history")
type unicorn
    bool active = false
    float level = na
var aUni = array.new<unicorn>(1, unicorn.new(false, na))
firstU = aUni.first()
float prevLevel = na
if not firstU.active[1]
    prevLevel := firstU.level[1]
firstU.active := bar_index % 3 == 0
firstU.level := close
plot(nz(prevLevel, -1), "prev")
plot(nz(close[1], -2), "close1")
plot(bar_index, "bar")
`;

describe('UDT array element: field history subscript (2692)', () => {
    it('lowers the element binding to its historic object', () => {
        const code = transpile(source).toString();
        expect(code).toContain('!$.get($.let.glb1_firstU, 1).active');
        expect(code).toContain('$.get($.let.glb1_firstU, 1).level');
        expect(code).not.toMatch(/(?<![.\w])firstU\./);
    });

    it('runtime: reads the previous bar object (one persistent object: the values set on the previous bar)', async () => {
        const context = await new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2024-01-01').getTime(), new Date('2024-02-01').getTime()).run(source);
        // One value per bar in every plot (nz keeps the na bars), so indices align.
        const values = (name: string) => context.plots[name].data.map((point: { value: unknown }) => point.value);
        const [prev, close1, bar] = [values('prev'), values('close1'), values('bar')];
        expect(prev.length).toBe(bar.length);
        expect(prev.length).toBeGreaterThan(10);
        for (let i = 1; i < prev.length; i++) {
            // The persistent object still holds what bar i-1 assigned: active = (bar-1) % 3 == 0, level = close[1].
            expect(prev[i]).toBe((Number(bar[i]) - 1) % 3 !== 0 ? close1[i] : -1);
        }
    });
});
