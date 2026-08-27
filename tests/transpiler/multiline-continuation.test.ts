// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Regression: multi-line binary-operator continuation inside a function
 * or method body used to truncate the body. The lexer emitted an INDENT
 * for the (visually deeper) continuation line because it tracks indent
 * via raw column counts. When the next real statement returned to the
 * function's body indent, the matching DEDENT was interpreted by the
 * block parser as "the function body just ended" — every subsequent
 * statement escaped to the top scope and referenced now-undefined
 * function parameters.
 *
 * Discovered while investigating Structural-Leg-Profiler-LuxAlgo, whose
 * `method draw(int startBar, int endBar, ...)` builds a multi-line
 * `summaryText` via `+` continuation, then immediately uses `startBar`
 * / `endBar` to compute `midBar` and place a label. Pre-fix, those last
 * three lines escaped the method body and crashed at runtime with
 * "startBar is not defined".
 *
 * Fix: the lexer suppresses INDENT/DEDENT emission on lines whose most
 * recently emitted non-NEWLINE/non-COMMENT token is a continuation
 * token — any binary/assignment/ternary OPERATOR (except `=>`, which
 * opens a new block), COMMA, COLON, or the `and` / `or` keyword.
 */
// Famille (condition 2) : `commentaires en continuation` — fix fork
// 093080b, ids révélateurs 1568/2553/2562 (describe « Comments inside
// wrapped expressions » ci-dessous).

import { describe, it, expect } from 'vitest';
import { transpile } from '../../src/transpiler/index';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';
import { PineTS, Provider } from 'index';

const makePineTS = () =>
    new PineTS(Provider.Mock, 'BTCUSDC', 'D', null,
        new Date('2019-01-01').getTime(),
        new Date('2019-01-15').getTime());

describe('Multi-line operator continuation inside function bodies', () => {
    // ─────────────────────────────────────────────────────────────────────
    // Codegen — the function body must contain ALL of its statements.
    // ─────────────────────────────────────────────────────────────────────
    it('keeps statements after a multi-line `+` continuation inside the function body', () => {
        const code = `
//@version=5
indicator("x")
f(int x) =>
    int a = x + 1
    string s = "p1: " + str.tostring(x) +
               "p2: " + str.tostring(a)
    int b = a + 1
    b
plot(f(5))
`;
        // Phase-1 view is the cleanest place to assert structural shape.
        const r = pineToJS(code);
        expect(r.success).toBe(true);
        const js = r.code as string;
        // The `b` assignment + return must remain inside `function f(...)`.
        // A simple structural check: between `function f(x) {` and the
        // matching `}` we must see the continuation-following lines.
        const fnStart = js.indexOf('function f(x) {');
        expect(fnStart).toBeGreaterThanOrEqual(0);
        const fnEnd = js.indexOf('}', fnStart);
        expect(fnEnd).toBeGreaterThan(fnStart);
        const body = js.slice(fnStart, fnEnd);
        expect(body).toContain('let b = a + 1');
        expect(body).toMatch(/return\s+b|^\s*b\s*;?\s*$/m);
    });

    it('keeps statements after a multi-line continuation inside a `method` body', () => {
        // Direct shape from Structural-Leg-Profiler.
        const code = `
//@version=6
indicator("x")
type T
    float v
method draw(T this, int startBar, int endBar) =>
    string summary = "L: " + str.tostring(startBar) + " " +
                     "R: " + str.tostring(endBar)
    int midBar = int(math.round((startBar + endBar) / 2))
    midBar
T.new(0).draw(10, 30)
`;
        const js = transpile(code).toString();
        // The `midBar` computation references the method parameters; if
        // it had escaped to top-level, the transpiler would emit it
        // outside the function and the bare identifiers would be
        // undefined at runtime.
        const fnStart = js.indexOf('function $M_draw_T(self, startBar, endBar)');
        expect(fnStart).toBeGreaterThanOrEqual(0);
        const fnEnd = js.indexOf('  $M_draw.__pineMethod__', fnStart);
        expect(fnEnd).toBeGreaterThan(fnStart);
        const body = js.slice(fnStart, fnEnd);
        expect(body).toMatch(/midBar/);
        expect(body).toMatch(/math\.round/);
    });

    it('does NOT swallow indent for `=>` (still opens a new block)', () => {
        // `=>` ends with an OPERATOR token but is the function-body opener,
        // not a continuation — so the next line must still emit INDENT.
        // Without this exclusion the body is mis-parsed as if it were on
        // the header line and the parser breaks immediately.
        const code = `
//@version=5
indicator("x")
f(int x) =>
    int a = x + 1
    a
plot(f(5))
`;
        const r = pineToJS(code);
        expect(r.success).toBe(true);
        expect(r.code).toContain('function f(x) {');
        expect(r.code).toMatch(/let a = x \+ 1/);
    });

    // ─────────────────────────────────────────────────────────────────────
    // Runtime — the bug surfaced as `ReferenceError: <param> is not defined`
    // when the escaped statements ran at top level.
    // ─────────────────────────────────────────────────────────────────────
    it('runtime: function returns the right value after a multi-line continuation', async () => {
        const code = `
//@version=5
indicator("x")

probe(int startBar, int endBar) =>
    string summary = "L: " + str.tostring(startBar) + " " +
                     "R: " + str.tostring(endBar)   + " " +
                     "M: " + str.tostring((startBar + endBar) / 2)
    int mid = int(math.round((startBar + endBar) / 2))
    int sum = startBar + endBar
    [str.length(summary), mid, sum]

[lenV, midV, sumV] = probe(10, 30)

plot(lenV, "lenV")
plot(midV, "midV")
plot(sumV, "sumV")
`;
        const { plots } = await makePineTS().run(code);
        const last = (k: string) => {
            const d = plots[k]?.data;
            return d?.[d.length - 1].value;
        };
        expect(last('lenV')).toBeGreaterThan(0);
        expect(last('midV')).toEqual(20);
        expect(last('sumV')).toEqual(40);
    });

    it('runtime: comma-continuation in a function-arg list also stays inside the body', async () => {
        // Same mechanism, different trigger: a function call argument
        // list spanning multiple lines via comma. Comma is also a
        // continuation token in the lexer fix.
        const code = `
//@version=5
indicator("x")

probe(int a, int b, int c) =>
    int s = math.max(a,
                     b,
                     c)
    int t = a + b + c
    [s, t]

[mx, sm] = probe(1, 5, 3)

plot(mx, "mx")
plot(sm, "sm")
`;
        const { plots } = await makePineTS().run(code);
        const last = (k: string) => {
            const d = plots[k]?.data;
            return d?.[d.length - 1].value;
        };
        expect(last('mx')).toEqual(5);
        expect(last('sm')).toEqual(9);
    });
});

describe('Comments inside wrapped expressions', () => {
    // Regression — TradingView corpus cluster 2553/2562 (chrono_utils lib):
    // a `//` comment trailing the consequent branch of a wrapped ternary hid
    // the `:` from matchEx's line-continuation lookahead, so the parser
    // threw "Expected COLON but got COMMENT at 601:194". Pine comments are
    // whitespace — official docs: "Comments can begin anywhere on the line" —
    // so they must not break operator continuation. Same root cause for a
    // trailing comment hiding a wrapped leading `or` (corpus cluster 1568).
    it('ternary `:` found across a trailing comment + line break', () => {
        const code = `
//@version=6
indicator("x")
f(bool overnight) =>
    int a = 1
    int b = 2
    overnight
      ? a <= b or a >= b // consequent branch comment
      : a >= b and a <= b
plot(f(close > open))
`;
        const r = pineToJS(code);
        expect(r.success).toBe(true);
    });

    it('runtime: ternary branches separated by a comment evaluate correctly', async () => {
        const code = `
//@version=6
indicator("x")
f(bool cond) =>
    cond
      ? 1 // yes branch
      : 2
plot(f(true), "t")
plot(f(false), "fv")
`;
        const { plots } = await makePineTS().run(code);
        const last = (k: string) => {
            const d = plots[k]?.data;
            return d?.[d.length - 1].value;
        };
        expect(last('t')).toEqual(1);
        expect(last('fv')).toEqual(2);
    });

    it('wrapped leading `or` found across a trailing comment + line break', () => {
        const code = `
//@version=6
indicator("x")
f(bool a, bool b, bool c) =>
    a or b // comment
    or c
plot(f(close > open, close > high[1], low < low[1]))
`;
        const r = pineToJS(code);
        expect(r.success).toBe(true);
    });
});
