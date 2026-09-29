// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Strict Pine mode (explicit //@version=5|6 sources):
 *
 *  1. Missing argument/parameter separators are compile errors with line
 *     info — `ta.rsi(close 14)` must never silently re-lex as two args.
 *  2. Identifiers that are not Pine (undeclared names, JS globals such as
 *     process/globalThis/fetch/require/eval/Function/Math/Object/Reflect/
 *     Proxy/console/Infinity/undefined, prototype-chain member access like
 *     `x.constructor.constructor`) are compile errors with line info.
 *  3. Valid Pine — builtins, namespaces (ta.*, math.*, str.*, color.*,
 *     input.*, strategy.*, request.security), user functions, `var`, arrays,
 *     enums, UDTs, methods, for loops — still compiles and runs.
 *  4. Version-less sources (PineTS/JS mode) and explicit v4 sources keep
 *     their existing library behavior (v4 flat builtins, JS-mode globals).
 */

import { describe, it, expect } from 'vitest';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';
import { transpile } from '../../src/transpiler/index';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';

function compileError(source: string): string {
    const result = pineToJS(source);
    if (result.success) {
        throw new Error(`expected compile failure, got success: ${result.code}`);
    }
    if (!('error' in result) || typeof result.error !== 'string') {
        throw new Error(`compile failure without a message: ${JSON.stringify(result)}`);
    }
    return result.error;
}

function compiles(source: string): string {
    const result = pineToJS(source);
    if (result.success) {
        return result.code;
    }
    const message = 'error' in result && typeof result.error === 'string' ? result.error : JSON.stringify(result);
    throw new Error(`expected success, got: ${message}`);
}

describe('Strict Pine — missing argument separators', () => {
    const cases: Array<[string, string, RegExp]> = [
        ['positional call args', 'plot(ta.rsi(close 14))', /Expected ',' between call arguments.*at 3:\d+/],
        ['member-expression second arg', 'strategy.entry("L" strategy.long)', /Expected ',' between call arguments.*at 3:\d+/],
        ['three fused args', 'plot(ta.sma(close 20 5))', /Expected ',' between call arguments.*at 3:\d+/],
        ['named arg after positional without comma', 'plot(close color=color.red)', /Expected ',' between call arguments.*at 3:\d+/],
        ['fused function params', 'f(x 1) => x', /Expected ',' between parameters.*at 3:\d+/],
    ];
    it.each(cases)('rejects %s', (_label, source, pattern) => {
        expect(compileError(`//@version=5\nindicator("t")\n${source}\n`)).toMatch(pattern);
    });

    it('still accepts comma-separated, newline-wrapped and trailing-comma calls', () => {
        compiles(
            `//@version=5
indicator("t")
plot(ta.sma(
    close,
    14,
))
x = math.max(close, open, high)
plot(x)
`,
        );
    });
});

describe('Strict Pine — undeclared / non-Pine identifiers', () => {
    const cases: Array<[string, string]> = [
        ['process', 'plot(process.version)'],
        ['globalThis', 'x = globalThis'],
        ['fetch', 'plot(fetch("https://x"))'],
        ['require', 'x = require("fs")'],
        ['eval', 'x = eval("1")'],
        ['Function', 'x = Function("return 1")'],
        ['Math (bare JS global)', 'plot(Math.abs(close))'],
        ['Object', 'x = Object.keys(close)'],
        ['Reflect', 'x = Reflect.get("a")'],
        ['Proxy', 'x = Proxy'],
        ['console', 'console.log("hi")'],
        ['Infinity (JS literal)', 'plot(Infinity)'],
        ['undefined (JS literal)', 'plot(undefined)'],
        ['undeclared plain name', 'plot(bogusName)'],
        ['undeclared assignment target', 'bogusTarget := 1'],
    ];
    it.each(cases)('rejects %s', (_label, body) => {
        const error = compileError(`//@version=5\nindicator("t")\n${body}\n`);
        expect(error).toMatch(/Undeclared identifier/);
        expect(error).toMatch(/line \d/);
    });

    it('reports the offending line of a multi-line script', () => {
        const error = compileError(
            `//@version=5
indicator("t")
x = close
plot(process.cwd())
`,
        );
        expect(error).toContain("'process'");
        expect(error).toContain('line 4');
    });

    it('rejects an undeclared identifier used deep inside user-function bodies', () => {
        const error = compileError(
            `//@version=5
indicator("t")
f(x) =>
    y = x + Math.random()
    y
plot(f(close))
`,
        );
        expect(error).toContain("'Math'");
    });
});

describe('Strict Pine — prototype-chain member access', () => {
    it.each([
        ['plot(close.constructor.constructor("return 1")())', 'constructor'],
        ['x = "".__proto__', '__proto__'],
        ['x = close.prototype', 'prototype'],
        ['x = close["constructor"]', 'constructor'],
    ])('rejects %s', (body, property) => {
        const error = compileError(`//@version=5\nindicator("t")\n${body}\n`);
        expect(error).toContain(`Member access '${property}' is not allowed`);
        expect(error).toMatch(/line \d/);
    });

    it('allows member access on Pine namespaces and UDT fields', () => {
        compiles(
            `//@version=5
indicator("t")
type MyType
    float value
m = MyType.new(1.5)
plot(m.value)
plot(syminfo.tickerid)
plot(barstate.isconfirmed ? 1 : 0)
`,
        );
    });
});

describe('Strict Pine — valid Pine still compiles and runs', () => {
    it('compiles builtins, namespaces, user functions, var, arrays, input, strategy', () => {
        compiles(
            `//@version=5
strategy("s", overlay=true)
var float[] buf = array.new<float>()
myFn(x) =>
    y = ta.sma(x, 14)
    y
len = input.int(14, "Len")
c = color.new(color.red, 10)
fast = ta.ema(close, 5)
slow = ta.ema(close, 20)
array.push(buf, fast)
labelText = str.format("f={0,number,#.##}", fast)
strategy.entry("L", strategy.long, 1)
plot(myFn(close), color=c)
plot(array.get(buf, array.size(buf) - 1))
plot(slow > fast ? 1 : 0)
plot(labelText == "" ? na : 1)
plot(math.abs(slow - fast))
plot(ta.crossover(fast, slow) ? 1 : 0)
`,
        );
    });

    it('compiles request.security with tuple return and destructure', () => {
        compiles(
            `//@version=5
indicator("r")
[htfO, htfH, htfL, htfC] = request.security(syminfo.tickerid, "D", [open, high, low, close])
plot(htfO + htfH)
`,
        );
    });

    it('accepts the documented v6 built-ins that carry no value here (bid, ask, settlement_as_close, footprint, volume_row)', () => {
        // The names are real Pine; the runtime has no values for them, so they
        // must not be rejected as "not a Pine built-in" at compile time — they
        // fail cleanly at runtime when actually read.
        for (const body of [
            'x = bid',
            'x = ask',
            'x = settlement_as_close',
            'x = footprint',
            'x = volume_row',
        ]) {
            compiles(`//@version=6\nindicator("t")\n${body}\n`);
        }
        compiles(
            `//@version=6
indicator("t")
if settlement_as_close
    x = close
plot(x)
`,
        );
    });

    it('runs a strict-mode script end to end', async () => {
        const DAY = 86_400_000;
        const bars = Array.from({ length: 40 }, (_, i) => {
            const base = 100 + i;
            return {
                openTime: Date.UTC(2020, 0, 1) + i * DAY,
                open: base,
                high: base + 1,
                low: base - 1,
                close: base + 0.5,
                volume: 1000 + i,
            };
        });
        const pineTS = new PineTS(bars, 'TEST', 'D');
        const code = `//@version=5
indicator("strict ok")
buf = array.new<float>()
var total = 0.0
for i = 0 to 4
    total += close[i]
    array.push(buf, ta.sma(close, 5))
plot(total, "Total")
plot(array.size(buf), "Count")
`;
        const { plots } = await pineTS.run(code);
        expect(plots['Total']).toBeDefined();
        expect(plots['Count']).toBeDefined();
    });

    it('full pipeline rejects the same constructs as pineToJS', () => {
        expect(() => transpile('//@version=5\nindicator("t")\nplot(process.version)\n')).toThrow(/Undeclared identifier 'process'/);
        expect(() => transpile('//@version=5\nindicator("t")\nplot(ta.rsi(close 14))\n')).toThrow(/Expected ',' between call arguments/);
    });
});

describe('Strict Pine — version-less and v4 sources keep library behavior', () => {
    it('v4 flat builtins still compile', () => {
        compiles(
            `//@version=4
study("v4")
plot(sma(close, 14))
plot(rsi(close, 7))
`,
        );
    });

    it('version-less PineTS/JS sources keep JS globals', () => {
        const fn = transpile('function demo(context) { return context.data.close; }');
        expect(typeof fn).toBe('function');
    });

    it('version-less fallback retry keeps its behavior', () => {
        // A version-less Pine-shaped string that only parses as Pine v5 must
        // not be subject to the identifier whitelist (library behavior).
        const code = transpile('plot(close)').toString();
        expect(code).toBeDefined();
    });
});