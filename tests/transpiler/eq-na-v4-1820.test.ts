// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille : `` `== na` v4 `` (FAMILLES.md) — id révélateur 1820,
// fix fork `2553054` (v4: lower 'expr == na' / 'expr != na' to
// na(expr) / not na(expr)). JOURNAL.md:455-458.
//
// Contrat observable : en v4, comparer une série à la valeur nue `na` est un
// test d'absence. `x == na` est abaissé en `na(x)` et `x != na` en
// `not na(x)` — observable par les valeurs plotées : sur la première barre
// (x = close[1] = na), `x == na` vaut 1 et `x != na` vaut 0 ; sur la barre
// suivante (x défini), l'inverse. Sans le lowering, `x == na` propage na
// (comparaison avec na) et les deux plots restent à 0 partout.
//
// Run : npx vitest run tests/transpiler/eq-na-v4-1820.test.ts

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

describe('lowering v4 `== na` / `!= na` (1820, fix 2553054)', () => {
    it('x == na est un test d\'absence : 1 sur la barre où x=na, 0 ailleurs ; x != na est l\'inverse', async () => {
        const pine = new PineTS(makeBars(20), 'TEST', 'D');
        const ctx = await pine.run(dedent(`
//@version=4
x = close[1]
a = x == na ? 1 : 0
b = x != na ? 1 : 0
plot(a, "a")
plot(b, "b")
`));
        // Barre 0 : x = close[1] = na → na(x) vrai → a=1, b=0.
        expect(ctx.plots.a.data[0].value).toBe(1);
        expect(ctx.plots.b.data[0].value).toBe(0);
        // Barre 1 : x = close[0] défini → a=0, b=1.
        expect(ctx.plots.a.data[1].value).toBe(0);
        expect(ctx.plots.b.data[1].value).toBe(1);
    });
});