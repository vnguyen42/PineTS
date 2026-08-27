// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille : `` `method` comme variable `` (FAMILLES.md) — ids révélateurs
// 1649 1576, fix fork `06350d0` (parser: dispatch 'method' statements by
// declaration lookahead). JOURNAL.md:59,154-158.
//
// Contrat observable : `method` n'est pas un mot réservé TradingView ; une
// variable nommée `method` (`method = 5`) est une déclaration valide qui
// doit se transpiler et se ploter à sa valeur. Avant le fix,
// parseStatement routait toute statement commençant par `method` vers
// parseMethodDeclaration → « Expected IDENTIFIER but got OPERATOR ».
//
// Run : npx vitest run tests/transpiler/method-comme-variable-1649.test.ts

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

function dedent(s: string): string {
    const lines = s.replace(/^\n/, '').replace(/\n\s*$/, '').split('\n');
    const widths = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length);
    const indent = Math.min(...widths);
    return lines.map((l) => l.slice(indent)).join('\n');
}

describe('`method` comme variable (1649 1576, fix 06350d0)', () => {
    it('method = 5 est une variable : le run plotte 5 sur chaque barre', async () => {
        const pine = new PineTS(makeBars(20), 'TEST', 'D');
        const ctx = await pine.run(dedent(`
//@version=5
indicator("repro")
method = 5
plot(method, "v")
`));
        expect(ctx.plots.v.data[0].value).toBe(5);
        expect(ctx.plots.v.data[ctx.plots.v.data.length - 1].value).toBe(5);
    });
});