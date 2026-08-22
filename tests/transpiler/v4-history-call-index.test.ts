// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// V4 variable index on a CALL result (VIN-42 iteration 3, corpus 1708) —
// `highest(length1)[check]` in an if condition failed at runtime with
// `ReferenceError: check is not defined`: the variable index escaped the
// context rename. ExpressionTransformer now scopes/unwraps the index
// (loop vars stay raw, function params get the scalar unwrap, context
// variables become `$.let.glb1_*` accesses). The history-on-call machinery
// itself (`$.get($.param(...), N)`) is untouched for literal indexes.
// Convention: same as history-on-call.test.ts — deterministic bars, assertions
// through the full transpile() pipeline (the JS-level transform pass) and
// end-to-end engine runs.

import { describe, it, expect } from 'vitest';
import { transpile } from '../../src/transpiler';
import { PineTS } from '../../src/PineTS.class';

const v4 = (body: string) => `//@version=4\n${body}`;

function transpiledCode(body: string): string {
    // The history-on-call transform lives in the JS-level pipeline that
    // `transpile()` runs after pineToJS codegen — not in pineToJS itself.
    const fn = transpile(v4(body));
    return fn.toString();
}

// --- deterministic data (no network); the peak at bar 10 makes the first
// conjunct true later in the run, so the call()[var] operand is actually
// reached. The smoke assertion below checks full-bar completion rather than
// unrelated value semantics of a short-circuited history expression.
function makeBars(n: number) {
    const DAY = 86_400_000;
    const t0 = Date.UTC(2020, 0, 1);
    const bars = [];
    for (let i = 0; i < n; i++) {
        const base = 100 + i * 0.3;
        const open = base;
        const close = i === 10 ? 195 : base + Math.sin(i) * 3;
        const high = i === 10 ? 200 : Math.max(open, close) + 2 + (i % 3);
        const low = i === 10 ? 90 : Math.min(open, close) - 2 - (i % 2);
        bars.push({ openTime: t0 + i * DAY, open, high, low, close, volume: 1000 + i });
    }
    return bars;
}

describe('V4 variable index on a call result (corpus 1708)', () => {
    it('scopes a context-variable index in an if condition to $.let.glb1_*', () => {
        const code = transpiledCode(`
length1 = input(20)
check = input(9)
u = 0.0
u := u[1]
if (highest(length1) == high[check] and highest(length1) == highest(length1)[check] and barssince(barstate.isfirst) > check)
    u := high[check]
plot(u)`);
        // The call-result index is read through the context binding, not a
        // raw JS identifier (which was the ReferenceError before the fix).
        expect(code).toMatch(/\$\.param\([^)]*\)\s*,\s*\$\.get\(\$\.let\.glb1_check,\s*0\)/);
        expect(code).not.toMatch(/param\([^)]*\)\s*,\s*check\)/);
        expect(code).toContain('$.get(high, $.get($.let.glb1_check, 0))');
    });

    it('keeps loop-variable indexes raw (JS-scoped)', () => {
        const code = transpiledCode(`
sum = 0.0
for i = 1 to 10
    sum := sum + highest(5)[i]
plot(sum)`);
        expect(code).toMatch(/\$\.param\([^)]*\)\s*,\s*i\)/);
        expect(code).not.toMatch(/glb1_i\b/);
    });

    it('unwraps function-parameter indexes to the current scalar ($.get(p, 0))', () => {
        const code = transpiledCode(`
f(p) =>
    x = sma(close, 5)[p]
    x
plot(f(2))`);
        expect(code).toContain('$.get(p, 0)');
        expect(code).not.toMatch(/param\([^)]*\)\s*,\s*p\)/);
    });

    it('leaves the pre-existing literal-index top-level pattern unchanged', () => {
        const code = transpiledCode('x = sma(close, 5)[1]\nplot(x)');
        // Literal index: the same $.get($.param(...), N) shape as before the
        // fix — the identifier branch must not interfere with it.
        expect(code).toMatch(/\$\.param\([^)]*\)\s*,\s*1\)/);
    });
    it('scopes a context-variable index in a function return ternary for v4 and v5', () => {
        const body = `
length = input(1)
f() =>
    c = close
    true ? c[length] : na
x = f()
plot(x)`;
        const v4Code = transpiledCode(body);
        const v5Code = transpile(`//@version=5\nlength = input.int(1)\nf() =>\n    c = close\n    true ? c[length] : na\nx = f()\nplot(x)`).toString();
        for (const code of [v4Code, v5Code]) {
            expect(code).toContain('$.get($.let.glb1_length, 0)');
            expect(code).not.toMatch(/,\s*length\)/);
        }
    });


    it('keeps loop-variable history indexes raw inside a function body', () => {
        const code = transpiledCode(`
f() =>
    sum = 0.0
    for i = 1 to 10
        sum := sum + close[i]
    sum
x = f()
plot(x)`);
        expect(code).toMatch(/\$\.get\(close,\s*i\)/);
        expect(code).not.toMatch(/glb1_i\b/);
    });

    it('runs the corpus 1708 if-condition pattern end-to-end (no ReferenceError)', async () => {
        const engine = new PineTS(makeBars(60), 'TEST', 'D');
        const source = v4(`
length1 = input(20)
check = input(9)
u = 0.0
u := u[1]
if (highest(length1) == high[check] and highest(length1) == highest(length1)[check] and barssince(barstate.isfirst) > check)
    u := high[check]
plot(u, "u")`);
        const context = await engine.run(source);
        const values = context.plots['u'].data.map((d: { value: unknown }) => d.value);
        // Before the fix: ReferenceError `check is not defined` when the
        // corpus condition first reaches its call()[var] operand. The exact
        // corpus contract here is successful completion of every bar; history
        // values are intentionally not asserted because a short-circuited
        // RHS is a separate pre-existing series-registration concern.
        expect(values).toHaveLength(60);
    });

});
