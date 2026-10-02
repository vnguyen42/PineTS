// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Corpus ids 1818 (v4 `type = input(...)`) and 1802 / 2617 (`f(a[1] < b, b > 70)`).
//
// - `type` / `enum` are contextual keywords: only `type Name` / `enum Name` start a
//   declaration; `type = …` is a variable (legal in v4, and as a v5/v6 name).
// - `x < y, z > 70` inside call arguments is two comparisons: type arguments only
//   exist when a `(` follows the closing `>` (`array.new<float>(…)`).
//
// Run : npx vitest run tests/transpiler/v4-type-variable-and-comparison-args.test.ts

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

function makeBars(n: number) {
    const DAY = 86_400_000;
    const t0 = Date.UTC(2020, 0, 1);
    const bars = [];
    for (let i = 0; i < n; i++) {
        const base = 100 + 10 * Math.sin(i / 2) + i * 0.7;
        const close = base + Math.cos(i / 3) * 3;
        const open = base;
        bars.push({ openTime: t0 + i * DAY, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 + i });
    }
    return bars;
}

describe('v4 `type` variable and comparisons read as type arguments', () => {
    it('`type = input(...)` is a variable in v4', async () => {
        const pine = new PineTS(makeBars(10), 'TEST', 'D');
        const ctx = await pine.run(`//@version=4
strategy("repro")
type = input("Ribbons", options=["Ribbons", "Oscillator"])
plot(type == "Ribbons" ? close : na, "v")
`);
        const data = ctx.plots.v.data;
        expect(data[data.length - 1].value).toBe(makeBars(10)[9].close);
    });

    it('`type Name` still declares a UDT in v5', async () => {
        const pine = new PineTS(makeBars(5), 'TEST', 'D');
        const ctx = await pine.run(`//@version=5
indicator("repro")
type Point
    float x
p = Point.new(2.5)
plot(p.x, "v")
`);
        expect(ctx.plots.v.data[0].value).toBe(2.5);
    });

    it('`f(a[1] < b, b > 70)` passes two comparisons', async () => {
        const pine = new PineTS(makeBars(10), 'TEST', 'D');
        const ctx = await pine.run(`//@version=5
indicator("repro")
f(lo, hi) => lo ? -1 : hi ? 1 : 0
r = bar_index * 10
plot(f(r < 30 and r[1] < r, r > 70 and r[1] < r), "v")
`);
        const values = ctx.plots.v.data.map((point: { value: number }) => point.value);
        expect(values).toEqual([0, -1, -1, 0, 0, 0, 0, 0, 1, 1]);
    });

    it('`array.new<float>(…)` keeps its type argument', async () => {
        const pine = new PineTS(makeBars(3), 'TEST', 'D');
        const ctx = await pine.run(`//@version=5
indicator("repro")
a = array.new<float>(2, 1.5)
plot(array.sum(a), "v")
`);
        expect(ctx.plots.v.data[0].value).toBe(3);
    });
});
