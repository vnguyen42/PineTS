import { describe, it, expect } from 'vitest';
import { PineTS, Provider } from 'index';
import { transpile } from '../../src/transpiler/index';

/**
 * Regression suite for two upstream bugs fixed together:
 *
 *  1. Pine function overloads (same name, different arities) — codegen emits
 *     every declaration as `function <name>(…)` in the same JS scope, so JS
 *     last-wins collapses all overloads onto the last declared variant. An
 *     internal 3-arg call `DFT3(x, y, 1)` then lands in the 2-param exported
 *     body with the array bound to `xval` → `array.set` crashes on a
 *     non-float value. Fix: `renameFunctionArityVariants` renames each
 *     duplicate declaration to `<name>_$ov<i>` and registers the variants;
 *     `injectFunctionDispatchers` routes calls by `arguments.length` (exact
 *     arity first, then last declared compatible range, then last declared
 *     variant as fallback).
 *
 *  2. A function whose LAST statement is a reassignment (`x := …`) returns
 *     undefined — `Context.set()` returned nothing in both branches while
 *     codegen emits `return $.precision($.set(…))`, so the function returned
 *     NaN (Pine: "A function's returned value is that of the last value in
 *     the function's body"). Fix: `Context.set()` returns the written value.
 */

describe('function overload arity dispatch + reassignment return', () => {
    const makePineTS = () =>
        new PineTS(Provider.Mock, 'BTCUSDC', 'D', null,
            new Date('2019-04-01').getTime(),
            new Date('2019-04-15').getTime());

    function lastValue(plots: any, name: string): number | undefined {
        const data = plots?.[name]?.data ?? [];
        return data.length > 0 ? data[data.length - 1].value : undefined;
    }

    function finiteCount(plots: any, name: string): number {
        const data = plots?.[name]?.data ?? [];
        return data.filter((p: any) => typeof p.value === 'number' && Number.isFinite(p.value)).length;
    }

    it('dispatches arity overloads to the exact variant (constant values)', async () => {
        const code = `
//@version=5
indicator("overload arity", overlay=true)
g(a, b) =>
    a + b
g(a, b, c) =>
    a * b * c
p1 = g(1.0, 2.0)
p2 = g(1.0, 2.0, 3.0)
plot(p1, "p1")
plot(p2, "p2")
`;
        const jsCode = transpile(code).toString();
        // Both declarations must survive with unique bindings (no last-wins).
        expect(jsCode).toMatch(/function g_\$ov0\(a, b\)/);
        expect(jsCode).toMatch(/function g_\$ov1\(a, b, c\)/);

        const { plots } = await makePineTS().run(code);
        // 2-arg call → 2-param variant (1+2), 3-arg call → 3-param variant (1*2*3).
        expect(lastValue(plots, 'p1')).toBe(3);
        expect(lastValue(plots, 'p2')).toBe(6);
        expect(finiteCount(plots, 'p1')).toBeGreaterThan(0);
        expect(finiteCount(plots, 'p2')).toBeGreaterThan(0);
    });

    it('routes an internal 3-arg call to the 3-param body, not the 2-param export (DFT3 crash shape)', async () => {
        // Mirrors Celje_2300/aprox/1: an internal 3-arg helper declared before
        // a 2-param exported overload of the same name. Last-wins used to send
        // the 3-arg call into the 2-param body (array bound to xval).
        const code = `
//@version=5
indicator("overload internal 3-arg", overlay=true)
helper(arr) =>
    array.get(arr, 0)
dft(a, b, _dir) =>
    array.get(a, 0) + array.get(b, 0)
dft(xval = close, _dir = 2) =>
    xval[0]
p = dft(array.new_float(2, 5.0), array.new_float(2, 7.0), 1)
plot(p, "p")
`;
        const jsCode = transpile(code).toString();
        expect(jsCode).toMatch(/function dft_\$ov0\(a, b, _dir\)/);
        expect(jsCode).toMatch(/function dft_\$ov1\(xval = close, _dir = 2\)/);

        const { plots } = await makePineTS().run(code);
        // The 3-arg call must reach the 3-param body: 5.0 + 7.0 = 12.0.
        expect(lastValue(plots, 'p')).toBe(12);
    });

    it('returns the written value when the last statement is a reassignment (local float)', async () => {
        const code = `
//@version=5
indicator("reassign return local", overlay=true)
f(src) =>
    float r = na
    r := src * 2.0
plot(f(close), "f")
`;
        const { plots } = await makePineTS().run(code);
        expect(finiteCount(plots, 'f')).toBeGreaterThan(0);
        // r := close * 2.0 → the function returns close*2 on every bar.
        const last = lastValue(plots, 'f');
        expect(typeof last).toBe('number');
        expect(Number.isFinite(last)).toBe(true);
    });

    it('returns the written value when the last statement is a reassignment (var float)', async () => {
        const code = `
//@version=5
indicator("reassign return var", overlay=true)
f(src) =>
    var float r = na
    r := src * 2.0
plot(f(close), "f")
`;
        const { plots } = await makePineTS().run(code);
        expect(finiteCount(plots, 'f')).toBeGreaterThan(0);
        const last = lastValue(plots, 'f');
        expect(typeof last).toBe('number');
        expect(Number.isFinite(last)).toBe(true);
    });

    it('returns the written value when the last statement is a compound reassignment (+=)', async () => {
        const code = `
//@version=5
indicator("reassign return plus-equal", overlay=true)
f(src) =>
    float r = 0.0
    r += src
plot(f(close), "f")
`;
        const { plots } = await makePineTS().run(code);
        expect(finiteCount(plots, 'f')).toBeGreaterThan(0);
        const last = lastValue(plots, 'f');
        expect(typeof last).toBe('number');
        expect(Number.isFinite(last)).toBe(true);
    });

    it('propagates async to EVERY variant when one overload awaits (request.security)', async () => {
        const code = `
//@version=5
indicator("async overload", overlay=true)
f(a) =>
    request.security(syminfo.tickerid, "D", a)
f(a, b) =>
    a + b
plot(f(close), "f1")
plot(f(close, 2.0), "f2")
`;
        const jsCode = transpile(code).toString();
        // Both variants must be marked async — a non-async variant whose body
        // contains `await` is a SyntaxError at Function-construction time.
        expect(jsCode).toMatch(/async function f_\$ov0/);
        expect(jsCode).toMatch(/async function f_\$ov1/);

        const { plots } = await makePineTS().run(code);
        // f2 is the 2-param variant: close + 2.0.
        expect(finiteCount(plots, 'f2')).toBeGreaterThan(0);
        const f2 = lastValue(plots, 'f2');
        expect(typeof f2).toBe('number');
        expect(Number.isFinite(f2)).toBe(true);
    });
});
