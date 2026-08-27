// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * DYNAMIC_HISTORY_INDEX_FN_PARAMS (corpus id 2280)
 *
 * Regression tests for function parameters with a Pine type annotation or a
 * default value (`float src = close`, `int length = 5`) used inside a dynamic
 * history index (`src[length - 1 - i]`).
 *
 * The parser wraps those params in AssignmentPattern nodes. They were never
 * registered as local series vars (only plain `Identifier` params were), so
 * the lowerers scoped them to the global context (`$.let.src` / `$.let.length`
 * — both undefined at runtime). Every dynamic-index read of such a param
 * produced NA, killing series like the FRAMA calculation of BankNifty_CSM/3
 * (all 21 552 bars NA).
 *
 * Fix: transformFunctionDeclaration registers the left Identifier of every
 * param (Identifier or AssignmentPattern) as a local series var, mirroring
 * the plain-param path.
 */

import { describe, it, expect } from 'vitest';
import { transpile } from '../../src/transpiler/index';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';

const FRAMA_LIKE_SOURCE = `//@version=5
indicator("frama-like")

f(float src = close, int length = 5, float mult = 1.0) =>
    sum_wt = 0.0
    sum_wt_src = 0.0
    for i = 0 to length - 1
        weight = math.exp(math.log(mult) * i * i / (length * length))
        sum_wt += weight
        sum_wt_src += weight * src[length - 1 - i]
    frama_value = sum_wt_src / sum_wt
    frama_value

plot(f(close, 5, 1.0), title="out")
plot(close, title="c")
`;
const EXPECTED_TYPED_DEFAULT_BODY = `function f(n = 5) {
    const $$ = $.peekCtx();
    return $.precision($.get(n, 0) + 1);
  }`;

describe('Dynamic history index referencing function params (FIX-1, 2280)', () => {
    it('lowers src[length - 1 - i] to the local params, not $.let.src/$.let.length', () => {
        const js = transpile(FRAMA_LIKE_SOURCE).toString();

        // The object and the index expression must resolve to the function's
        // own params (plain identifiers wrapped in $.get), never the global
        // context.
        expect(js).toContain('$.get(src, $.get(length, 0) - 1 - i)');
        expect(js).not.toContain('$.let.src');
        expect(js).not.toContain('$.let.length');
    });

    it('keeps plain-Identifier params byte-stable (no scoping change)', () => {
        const source = `//@version=5
indicator("plain")
f(x, y) =>
    s = 0.0
    for i = 0 to y - 1
        s += x[y - 1 - i]
    s
plot(f(close, 5))`;
        const js = transpile(source).toString();
        expect(js).toContain('$.get(x, $.get(y, 0) - 1 - i)');
        expect(js).not.toContain('$.let.x');
    });

    it('keeps GLOBAL-variable indexes scoped to the global context inside functions', () => {
        const source = `//@version=5
indicator("glob")
g = input.int(5, "G")
f(x) =>
    s = 0.0
    for i = 0 to g - 1
        s += x[g - 1 - i]
    s
plot(f(close))`;
        const js = transpile(source).toString();
        // The global `g` must still be resolved through the global context
        // (the working path must not be touched by the fix).
        expect(js).toMatch(/\$\.get\(x, \$\.get\(\$\.let\.glb1_g, 0\) - 1 - i\)/);
        expect(js).not.toContain('$.get(x, $.get(g, 0) - 1 - i)');
    });

    it('emits the byte-stable body for a typed default parameter without a global', () => {
        const source = `//@version=5
indicator("scalar-default")
f(int n = 5) =>
    n + 1
plot(f(), title="out")`;
        const js = transpile(source).toString();

        expect(js).toContain(EXPECTED_TYPED_DEFAULT_BODY);
        expect(js).not.toContain('$.let.n');
    });

    it('keeps a typed default parameter local when it shadows a global', () => {
        const source = `//@version=5
indicator("shadow-default")
n = 99
f(int n = 5) =>
    n + 1
plot(f(), title="out")
plot(n, title="global")`;
        const js = transpile(source).toString();

        // The function body reads its local parameter, while the global
        // declaration and the later global plot remain scoped to glb1_n.
        expect(js).toContain(EXPECTED_TYPED_DEFAULT_BODY);
        expect(js).not.toContain('$.precision($.get($.let.glb1_n, 0) + 1)');
        expect(js).toContain('$.let.glb1_n = $.init($.let.glb1_n, 99);');
        expect(js).toMatch(/plot\.param\(\$\.let\.glb1_n, undefined/);
    });

    it('computes finite values at runtime for the typed/default-param function', async () => {
        // Provider.Mock 60-min BTC closes — the FRAMA-like windowed sum must
        // be finite on every bar once the window is full (before the fix every
        // bar was NA because $.let.src/$.let.length are undefined).
        const engine = new PineTS(
            Provider.Mock, 'BTCUSDC', '60', null,
            new Date('2024-01-01').getTime(), new Date('2024-01-10').getTime(),
        );
        const { plots } = await engine.run(FRAMA_LIKE_SOURCE);
        const values = plots['out']?.data.map((p: { value: unknown }) => p.value) ?? [];
        expect(values.length).toBeGreaterThan(10);
        // Warmup: window of 5 — after bar 4 every value must be finite.
        const tail = values.slice(5);
        expect(tail.length).toBeGreaterThan(0);
        expect(tail.every((v: unknown) => Number.isFinite(Number(v)))).toBe(true);
        // Reference: with mult=1.0 the weights collapse to exp(0)=1, so the
        // value is the 5-bar arithmetic mean of closes.
        const closes = plots['c']!.data.map((p: { value: unknown }) => Number(p.value));
        expect(values[5]).toBeCloseTo(
            (closes[1] + closes[2] + closes[3] + closes[4] + closes[5]) / 5,
            6,
        );
        expect(values[6]).toBeCloseTo(
            (closes[2] + closes[3] + closes[4] + closes[5] + closes[6]) / 5,
            6,
        );
    });
});