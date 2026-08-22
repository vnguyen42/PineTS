// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// V4 `return` identifier (VIN-42 iteration 3) — `return` is a legal Pine v4
// identifier that became a reserved keyword in v5. The codegen renames it
// through the JS_RESERVED_WORDS mechanism, STRICTLY gated on the source being
// v4 (v5/v6/version-less sources keep their generated JS byte-identical and
// keep failing on the raw JS keyword as before).
// Convention: same as the other v4-*.test.ts transpiler suites — codegen-level
// assertions on pineToJS output, plus a compile-validity check (`new Function`)
// for the emitted JS, mirroring how the corpus harness surfaces the failure
// (SyntaxError "Unexpected keyword 'return'").

import { describe, it, expect } from 'vitest';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';

const v4 = (body: string) => `//@version=4\n${body}`;

function codeOf(body: string): string {
    const result = pineToJS(v4(body));
    if (!result.success) throw new Error(result.error);
    return result.code;
}

// The generated JS must be parseable — the corpus harness compiles the emitted
// code at transpile time (1542/1678 failed there with "Unexpected keyword
// 'return'" before the fix).
function assertCompiles(code: string): void {
    expect(() => new Function(code)).not.toThrow();
}

describe('V4 `return` identifier (version-gated JS-reserved rename)', () => {
    it('renames the declaration: `return = x`', () => {
        const code = codeOf('return = close > open ? 1.0 : 0.0\nplot(return)');
        expect(code).toContain('let return_$0 = (close > open ? 1.0 : 0.0);');
        expect(code).toContain('plot(return_$0);');
        expect(code).not.toMatch(/let return\b/);
        assertCompiles(code);
    });

    it('renames the reassignment: `return := ...` (corpus 1542 toWhole/toPips)', () => {
        const code = codeOf(`
toWhole(number) =>
    return = atr < 1.0 ? (number / syminfo.mintick) / (10 / syminfo.pointvalue) : number
    return := atr >= 1.0 and atr < 100.0 and syminfo.currency == "JPY" ? return * 100 : return
x = toWhole(123)
plot(x)`);
        expect(code).toContain('let return_$0 = (atr < 1.0 ? number / syminfo.mintick / (10 / syminfo.pointvalue) : number);');
        expect(code).toContain('return_$0 = (atr >= 1.0 && atr < 100.0 && syminfo.currency == \'JPY\' ? return_$0 * 100 : return_$0);');
        expect(code).not.toMatch(/\b(?:let|var)\s+return\b/);
        assertCompiles(code);
    });

    it('renames reads in expressions: `return * 100`', () => {
        const code = codeOf('return = 5.0\nx = return * 100\nplot(x)');
        expect(code).toContain('let return_$0 = 5.0;');
        expect(code).toContain('let x = return_$0 * 100;');
        assertCompiles(code);
    });

    it('renames usage as an argument: `double(return)`', () => {
        const code = codeOf(`
double(x) => x * 2
return = 5.0
y = double(return)
plot(y)`);
        expect(code).toContain('double(return_$0)');
        expect(code).not.toContain('double(return)');
        assertCompiles(code);
    });

    it('function ending on the `return` identifier still works (corpus 1542 f_bbwp shape)', () => {
        const code = codeOf(`
double(x) => x * 2
f() =>
    return = 5.0
    y = double(return)
    return := return + y
    return
z = f()
plot(z)`);
        // The renamed identifier is the function's return value.
        expect(code).toContain('return return_$0;');
        expect(code).not.toMatch(/let return\b/);
        assertCompiles(code);
    });

    it('top-level `return` identifier works', () => {
        const code = codeOf('return = close\nplot(return)');
        expect(code).toContain('let return_$0 = close;');
        expect(code).toContain('plot(return_$0);');
        assertCompiles(code);
    });

    it('renames a function parameter named `return` (v4)', () => {
        const code = codeOf('f(return) => return + 1\nplot(f(2))');
        // The param binding and every body reference are renamed together —
        // `function f(return)` would be a JS SyntaxError.
        expect(code).toContain('function f(return_$0)');
        expect(code).toContain('return return_$0 + 1;');
        expect(code).not.toContain('function f(return)');
        assertCompiles(code);
    });

    it('renames a function parameter named `return` with a default value (v4)', () => {
        const code = codeOf('f(return = 5) => return + 1\nplot(f())');
        expect(code).toContain('function f(return_$0 = 5)');
        expect(code).toContain('return return_$0 + 1;');
        assertCompiles(code);
    });

    it('v5 with `return = x` FAILS as before (raw JS keyword → SyntaxError)', () => {
        // The rename is STRICTLY gated on version 4: a v5 source must keep its
        // pre-fix output (raw `return`), which is invalid JS and fails at
        // compile time exactly like the corpus harness reported for 1542/1678.
        const result = pineToJS('//@version=5\nreturn = close\nplot(return)');
        expect(result.success).toBe(true);
        expect(result.code).toContain('let return = close;');
        expect(() => new Function(result.code)).toThrow(/return/);
    });

    it('v5 parameter named `return` stays unchanged (invalid JS as before)', () => {
        const result = pineToJS('//@version=5\nf(return) => return + 1\nplot(f(2))');
        expect(result.success).toBe(true);
        expect(result.code).toContain('function f(return)');
        expect(() => new Function(result.code)).toThrow(/return/);
    });

});
