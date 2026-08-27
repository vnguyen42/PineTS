// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * ta.vwap nu (corpus ids 1861 2651, fork 196776c) — l'auto-call d'un membre nu
 * (`ta.vwap` en position valeur ou opérande directe) doit injecter hlc3 avant
 * l'ID `_taN`, sinon il rend NaN. Voir le describe « Bare ta.vwap source
 * lowering » ci-dessous.
 */

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';
import { transpile } from '../../src/transpiler';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';

const runMock = async (source: string) => {
    const engine = new PineTS(
        Provider.Mock,
        'BTCUSDC',
        '60',
        null,
        new Date('2024-01-01').getTime(),
        new Date('2024-01-10').getTime()
    );
    return engine.run(source);
};

const plotValues = (
    result: { plots: Record<string, { data: Array<{ value: unknown }> }> },
    name: string
): unknown[] => result.plots[name].data.map((point) => point.value);

describe('Parser branch value lowering', () => {
    it('returns simple if branch initializers for both branches without self-reading the target', async () => {
        const source = `//@version=5
indicator("branch initializer")
cond = bar_index % 2 == 0
a = 10.0
b = 20.0
x = if cond
    x = a
else
    x = b
plot(x, "x")
`;
        const parsed = pineToJS(source);
        expect(parsed.success).toBe(true);
        expect(parsed.code).toContain('let x = (cond ? a : b);');

        const jsCode = transpile(source).toString();
        expect(jsCode).toContain('$.get($.let.glb1_a, 0)');
        expect(jsCode).toContain('$.get($.let.glb1_b, 0)');
        expect(jsCode).not.toMatch(/\?[^;\n]*glb1_x[^;\n]*:[^;\n]*glb1_x/);

        const values = plotValues(await runMock(source), 'x');
        expect(values.slice(0, 6)).toEqual([10, 20, 10, 20, 10, 20]);
    });

    it('returns a branch initializer when its identifier differs from the external target', async () => {
        const source = `//@version=5
indicator("identifier target")
cond = bar_index % 2 == 0
x = if cond
    branch = 1.0
else
    branch = 2.0
plot(x, "x")
`;
        const parsed = pineToJS(source);
        expect(parsed.success).toBe(true);
        expect(parsed.code).toContain('let x = (cond ? 1.0 : 2.0);');
        expect(parsed.code).not.toContain('branch');

        const values = plotValues(await runMock(source), 'x');
        expect(values.slice(0, 6)).toEqual([1, 2, 1, 2, 1, 2]);
    });

    it('keeps multi-statement if branches on the statement/IIFE path', async () => {
        const source = `//@version=5
indicator("multi-statement branch")
var float result = 0.0
result := if close > open
    body = close - open
    wick = high - close
    body + wick
else
    body = open - close
    wick = open - low
    body + wick
plot(result, "result")
`;
        const parsed = pineToJS(source);
        expect(parsed.success).toBe(true);

        const jsCode = transpile(source).toString();
        expect(jsCode).toContain('$.set($.var.glb1_result, (() => {');
        expect(jsCode).toContain('$.let.if2_body');
        expect(jsCode).toContain('$.let.els1_body');
        expect(jsCode).toContain('$.get($.let.if2_body, 0) + $.get($.let.if2_wick, 0)');
        expect(jsCode).toContain('$.get($.let.els1_body, 0) + $.get($.let.els1_wick, 0)');

        const values = plotValues(await runMock(source), 'result');
        expect(values.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))).toBe(true);
    });

    it('returns switch cases whose final statements are declarations', async () => {
        const source = `//@version=5
indicator("switch initializer")
mode = bar_index % 2
x = switch mode
    0 =>
        x = 10.0
    =>
        x = 20.0
plot(x, "x")
`;
        const parsed = pineToJS(source);
        expect(parsed.success).toBe(true);
        expect(parsed.code).toContain('return 10.0;');
        expect(parsed.code).toContain('return 20.0;');
        expect(parsed.code).not.toContain('return x;');

        const values = plotValues(await runMock(source), 'x');
        expect(values.slice(0, 6)).toEqual([10, 20, 10, 20, 10, 20]);
    });

    it('keeps HMA-like derived conditions finite after warmup', async () => {
        const source = `//@version=5
indicator("hma branch")
n1 = ta.wma(close, 3)
n2 = ta.wma(close[1], 3)
h = if n1 > n2
    h = n1 - 2
else
    h = n1 + 2
c1 = h + n1 - close
signal = n1 > n2
plot(c1, "c1")
plot(signal ? 1 : 0, "signal")
`;
        const result = await runMock(source);
        const c1 = plotValues(result, 'c1');
        const signal = plotValues(result, 'signal');
        expect(c1.slice(5).some((value: unknown) => typeof value === 'number' && Number.isFinite(value))).toBe(true);
        expect(signal.slice(5).some((value: unknown) => value === 1)).toBe(true);
    });
});

describe('Bare ta.vwap source lowering', () => {
    it('uses hlc3 for a bare member while preserving explicit close and hlc3 sources', async () => {
        const source = `//@version=5
indicator("vwap source")
plot(ta.vwap, title="vwap0")
plot(ta.vwap(close), title="vwapc")
plot(ta.vwap(hlc3), title="vwaph")
`;
        const jsCode = transpile(source).toString();
        expect(jsCode).toContain('ta.vwap($.data.hlc3, "_ta0")');
        // The explicit `ta.vwap(close)` keeps its own source argument
        // (param-wrapped), not the bare-member hlc3 default. VIN-118 wraps
        // the bare member's result in a param as well, so the exact param id
        // of the close argument is an implementation detail — assert shape.
        expect(jsCode).toMatch(/ta\.vwap\(p\d+, "_ta1"\)/);
        const operandCode = transpile(`//@version=5
indicator("vwap operand")
signal = close > ta.vwap
plot(signal)
`).toString();
        expect(operandCode).toContain('ta.vwap($.data.hlc3, "_ta0")');

        const result = await runMock(source);
        const bare = plotValues(result, 'vwap0');
        const close = plotValues(result, 'vwapc');
        const hlc3 = plotValues(result, 'vwaph');
        expect(bare.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))).toBe(true);
        expect(close.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))).toBe(true);
        expect(bare).toEqual(hlc3);

        const closeOnly = await runMock(`//@version=5
indicator("vwap close")
plot(ta.vwap(close), "vwapc")
`);
        expect(close).toEqual(plotValues(closeOnly, 'vwapc'));
    });
});
