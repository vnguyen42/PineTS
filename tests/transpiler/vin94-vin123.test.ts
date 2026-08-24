// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';
import { transpile } from '../../src/transpiler';

type PlotResult = {
    plots: Record<string, { data: Array<{ value: number }> }>;
};

function makePineTS() {
    return new PineTS(
        Provider.Mock,
        'BTCUSDC',
        '1h',
        10,
        new Date('2024-01-01').getTime()
    );
}

function plotValues(result: PlotResult, name: string): number[] {
    return result.plots[name].data.map((point) => point.value);
}

function expectSeriesEqual(actual: number[], expected: number[]): void {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((value, index) => {
        const other = expected[index];
        if (Number.isNaN(other)) {
            expect(value).toBeNaN();
        } else {
            expect(value).toBeCloseTo(other, 10);
        }
    });
}

describe('VIN-94 function parameter shadowing', () => {
    it('uses shadowing parameters for SMA, RMA, and nested calls', async () => {
        const source = `//@version=5
indicator("VIN-94")
source = close
length = 2
smaParam(source, length) => ta.sma(source, length)
rmaParam(source, length) => ta.rma(source, length)
contextParam(close) => close + 1
nestedParam(source, length) => ta.rma(smaParam(source, length), length)
smaOut = smaParam(open, length)
smaExpected = ta.sma(open, length)
globalSma = ta.sma(source, length)
rmaOut = rmaParam(open, length)
rmaExpected = ta.rma(open, length)
nestedOut = nestedParam(open, length)
contextOut = contextParam(open)
contextExpected = open + 1
nestedExpected = ta.rma(ta.sma(open, length), length)
plot(smaOut, "smaOut")
plot(smaExpected, "smaExpected")
plot(globalSma, "globalSma")
plot(rmaOut, "rmaOut")
plot(rmaExpected, "rmaExpected")
plot(contextOut, "contextOut")
plot(contextExpected, "contextExpected")
plot(nestedOut, "nestedOut")
plot(nestedExpected, "nestedExpected")
`;

        const code = transpile(source).toString();
        const functionBody = code.match(/function smaParam\(source, length\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
        expect(functionBody).toContain('ta.param(source');
        expect(functionBody).toContain('ta.param(length');
        expect(functionBody).not.toContain('$.let.glb1_source');
        expect(functionBody).not.toContain('$.let.glb1_length');

        const result = await makePineTS().run(source);
        expectSeriesEqual(plotValues(result, 'smaOut'), plotValues(result, 'smaExpected'));
        expectSeriesEqual(plotValues(result, 'rmaOut'), plotValues(result, 'rmaExpected'));
        expectSeriesEqual(plotValues(result, 'nestedOut'), plotValues(result, 'nestedExpected'));
        expectSeriesEqual(plotValues(result, 'contextOut'), plotValues(result, 'contextExpected'));

        const paramValues = plotValues(result, 'smaOut');
        const globalValues = plotValues(result, 'globalSma');
        expect(paramValues.some((value, index) => Number.isFinite(value) && value !== globalValues[index])).toBe(true);
    });
});

describe('VIN-123 named ta.change arguments', () => {
    it('matches positional length for namespaced v5 and lowered v4 calls', async () => {
        const v5Source = `//@version=5
indicator("VIN-123 v5")
named = ta.change(close, length=2)
positional = ta.change(close, 2)
plot(named, "named")
plot(positional, "positional")
`;
        const v5Result = await makePineTS().run(v5Source);
        expectSeriesEqual(plotValues(v5Result, 'named'), plotValues(v5Result, 'positional'));

        const v4Source = `//@version=4
indicator("VIN-123 v4")
named = change(close, length=2)
positional = change(close, 2)
plot(named, "named")
plot(positional, "positional")
`;
        const v4NamedCode = transpile(`//@version=4
indicator("VIN-123 v4 code")
named = change(close, length=2)
plot(named)
`).toString();
        expect(v4NamedCode).toContain('ta.change(');
        expect(v4NamedCode).toContain('ta.param(2');
        expect(v4NamedCode).not.toMatch(/ta\.param\(\{\s*length:\s*2/);

        const v4Result = await makePineTS().run(v4Source);
        expectSeriesEqual(plotValues(v4Result, 'named'), plotValues(v4Result, 'positional'));
    });
});
