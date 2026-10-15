// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Family: slicing Phase 3 — consumers of the truncated return (fix 2e7bea9,
// revealing id 1746), cascade to the JS locals of removed declarations.
// Revealing script: 2658 (`f_ichimokuData`: `SSB` holds a truncated
// `f_donchian` return; `middleCloud = … SSA - math.abs(SSA - SSB) / 2 …`).
// The hoisted `const p155 = math.param($.get(SSA) - $.get(SSB))` was removed
// as a consumer but `const temp_63 = math.abs(p155)` was kept: the slice read
// an undeclared `p155` — ReferenceError when the secondary context runs it,
// and Studio's safe-script gate refused the script at compile time.

import { describe, it, expect } from 'vitest';
import * as acorn from 'acorn';
import { PineTS, Provider } from 'index';
import { transpile } from '../../src/transpiler/index';

const code = `
//@version=5
indicator("slice dead local")
f_don(_tf, _src) =>
    request.security(syminfo.tickerid, _tf, _src)
f_data(_tf) =>
    a = f_don(_tf, high)
    b = f_don(_tf, low)
    mid = a > b ? a - math.abs(a - b) / 2 : b
    [a, b, mid]
[x, y, z] = f_data("D")
plot(z, "z")
`;

/** Generated locals (`pN`, `temp_N`) read by the source but never declared in it. */
function undeclaredGeneratedLocals(source: string): string[] {
    const declared = new Set<string>();
    const read = new Set<string>();
    const generated = /^(p|temp_)\d+$/;
    const visit = (node: unknown, parentKey: string, parent: { type?: string; computed?: boolean } | null): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const child of node) visit(child, parentKey, parent);
            return;
        }
        const n = node as { type?: string; name?: string; [key: string]: unknown };
        if (n.type === 'Identifier' && n.name && generated.test(n.name)) {
            const isName = parent?.type === 'MemberExpression' && parentKey === 'property' && !parent.computed;
            if (parent?.type === 'VariableDeclarator' && parentKey === 'id') declared.add(n.name);
            else if (!isName) read.add(n.name);
        }
        for (const [key, value] of Object.entries(n)) {
            if (key !== 'loc' && value && typeof value === 'object') visit(value, key, n);
        }
    };
    visit(acorn.parse(source, { ecmaVersion: 'latest' }), '', null);
    return [...read].filter((name) => !declared.has(name));
}

describe('slicing Phase 3: dead locals of removed consumers (2658)', () => {
    it('drops the statements reading a removed declaration', () => {
        const fn = transpile(code) as Function & { _ltfSlices?: Record<string, Function> };
        const slices = Object.values(fn._ltfSlices ?? {});
        expect(slices.length).toBeGreaterThan(0);
        for (const slice of slices) {
            expect(undeclaredGeneratedLocals(`(${slice.toString()})`)).toEqual([]);
        }
    });

    it('runtime: the sliced secondary run matches the full-script slow path', async () => {
        const start = new Date('2024-01-01').getTime();
        const end = new Date('2024-03-01').getTime();
        const previous = process.env.PINETS_DISABLE_LTF_SLICING;
        // The run context: plots by title, and the slices the secondary contexts used.
        type RunContext = { plots: Record<string, { data: unknown[] }>; _ltfTruncatedBodies?: Record<string, Function> };
        const run = async () =>
            (await new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, start, end).run(code)) as unknown as RunContext;
        let reference: RunContext;
        let sliced: RunContext;
        try {
            process.env.PINETS_DISABLE_LTF_SLICING = '1';
            reference = await run();
            delete process.env.PINETS_DISABLE_LTF_SLICING;
            sliced = await run();
        } finally {
            if (previous === undefined) delete process.env.PINETS_DISABLE_LTF_SLICING;
            else process.env.PINETS_DISABLE_LTF_SLICING = previous;
        }
        expect(Object.keys(sliced._ltfTruncatedBodies ?? {})).not.toHaveLength(0);
        const expected = reference.plots.z.data;
        expect(expected.length).toBeGreaterThan(0);
        expect(sliced.plots.z.data).toEqual(expected);
    });
});
