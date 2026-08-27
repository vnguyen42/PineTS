// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Singletons v4 (VIN-93 partiel), corpus 1540/1542/2617/1804.
 *
 * These tests cover the three observable v4 lowerings in the family:
 * security resolution=, the two-argument offset history operator, and a
 * context-bound history index inside a function's return ternary.
 */

import { describe, expect, it } from 'vitest';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';
import { transpile } from '../../src/transpiler/index';

describe('singletons v4 (VIN-93 partiel)', () => {
    it('maps security resolution= to the timeframe argument (1542)', () => {
        const result = pineToJS(`
//@version=4
a = security(symbol=syminfo.tickerid, resolution="D", expression=close)
plot(a)
`);
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);
        expect(result.code).toContain("timeframe: 'D'");
        expect(result.code).not.toContain('resolution:');
    });

    it('lowers two-argument offset to the history operator (1540)', () => {
        const result = pineToJS(`
//@version=4
x = offset(close, 1)
plot(x)
`);
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);
        expect(result.code).toContain('close[1]');
        expect(result.code).not.toContain('offset(close, 1)');
    });

    it('scopes a history index in a complex function return (2617)', () => {
        const code = transpile(`
//@version=4
length = input(1)
f() =>
    c = close
    true ? c[length] : na
x = f()
plot(x)
`).toString();
        expect(code).toContain('$.get($.let.glb1_length, 0)');
        expect(code).not.toMatch(/,\s*length\)/);
    });
});
