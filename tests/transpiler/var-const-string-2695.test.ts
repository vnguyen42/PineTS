// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille : `` `var const string` statement-level `` (FAMILLES.md) — ids
// révélateurs 2695 2690, fix fork `359f652` (parser: accept multi-qualifier
// types after var/varip). JOURNAL.md:59,160-164.
//
// Contrat observable : `var const string G = "…"` est une déclaration
// statement-level légale (qualifiers const/simple/series/input avant le
// type). La variable doit contenir la chaîne et le script doit s'exécuter.
// Avant le fix, la branche typed de parseVarDeclaration lisait un
// identifiant comme type puis le suivant comme nom → « Expected OPERATOR
// but got IDENTIFIER » (string devenait un nom fantôme).
//
// Run : npx vitest run tests/transpiler/var-const-string-2695.test.ts

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

describe('`var const string` statement-level (2695 2690, fix 359f652)', () => {
    it('var const string G = "abc" : G contient la chaîne, le comparaison vaut 1', async () => {
        const pine = new PineTS(makeBars(20), 'TEST', 'D');
        const ctx = await pine.run(dedent(`
//@version=5
indicator("repro")
var const string G = "abc"
plot(G == "abc" ? 1 : 0, "v")
`));
        expect(ctx.plots.v.data[0].value).toBe(1);
        expect(ctx.plots.v.data[ctx.plots.v.data.length - 1].value).toBe(1);
    });
});