// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Family: trailing-loop-return — a loop that ends a function body (or an
 * if/else branch that ends it) is the function's value. Revealing script: 1799
 * ("Zendog V3 DCA bot"): `stepped_deviation(so_index) => … if so_index > 0 /
 * for _i = 1 to so_index by 1 / _stepped_deviation := …`. The function
 * returned undefined, so every safety-order price and quantity built on it was
 * NaN (the orders were dropped, or became default-size market orders).
 *
 * Pine docs, Loops / Keywords and return expressions: "A loop's returned
 * results come from the latest execution of the last expression or nested
 * code block within its body as of the final iteration [...] Loops return na
 * results [...] when no iterations occur", and with `break`/`continue` "the
 * last iteration where the script evaluated the return expression"; the docs'
 * example return expression is a `+=` reassignment. A body ending in a bare
 * `break`/`continue` has no return expression and is left as is.
 */

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

function makeBars(count = 4) {
    const start = Date.UTC(2020, 0, 1);
    return Array.from({ length: count }, (_, i) => ({
        openTime: start + i * 86_400_000,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100 + i,
        volume: 1_000 + i,
    }));
}

const source = `
//@version=5
indicator("trailing loop return")
steppedDeviation(n) =>
    float dev = 0
    if n > 0
        for i = 1 to n by 1
            dev := dev + 1.5 * math.pow(1.2, i - 1)
    else
        dev := 0
sumTo(n) =>
    float acc = 0
    for i = 1 to n
        acc += i
lastTimesTen(n) =>
    for i = 1 to n
        i * 10
countUp(n) =>
    int k = 0
    while k < n
        k += 2
noIteration() =>
    int k = 0
    while k < 0
        k += 1
oddUntilBreak() =>
    float out = 0
    for i = 1 to 10
        if i == 8
            break
        if i % 2 == 0
            continue
        out := i
breakLast(n) =>
    float acc = 0
    for i = 1 to n
        acc += i
        break
breakLast(3)
plot(steppedDeviation(3), "dev")
plot(steppedDeviation(0), "dev0")
plot(sumTo(4), "sum")
plot(lastTimesTen(3), "ten")
plot(countUp(5), "while")
plot(na(noIteration()) ? 1 : 0, "none")
plot(oddUntilBreak(), "break")
`;

describe('trailing loop is the function value (1799)', () => {
    it('returns the last evaluated value of a loop ending the body or a branch', async () => {
        const context = await new PineTS(makeBars(), 'TEST', 'D').run(source);
        const last = (title: string) => context.plots[title].data.at(-1)?.value;
        expect(last('dev')).toBeCloseTo(1.5 * (1 + 1.2 + 1.44), 12);
        expect(last('dev0')).toBe(0);
        expect(last('sum')).toBe(10);
        expect(last('ten')).toBe(30);
        expect(last('while')).toBe(6);
        expect(last('none')).toBe(1);
        expect(last('break')).toBe(7);
    });
});
