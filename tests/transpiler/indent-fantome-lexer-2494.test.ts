// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille : `INDENT fantôme lexer` (FAMILLES.md) — ids révélateurs 2494 2722,
// fix fork `117f683` (lexer: treat comments and operator-first lines as
// non-structural). JOURNAL.md:57,75-79.
//
// Contrat observable (deux comportements du même fix lexer) :
//   a) une ligne de commentaire `//` à colonne plus basse entre deux lignes
//      de corps ne doit pas poper l'empilement d'indentation — sinon la
//      ligne de corps suivante rouvre un bloc et le parseur crashe en
//      « Unexpected token INDENT » ;
//   b) une ligne commençant par un opérateur binaire infixe (continuation
//      d'expression après parenthèse fermante) est une continuation, pas un
//      nouveau bloc indenté — le même crash « Unexpected token INDENT »
//      frappait la forme `v = (a + b)\n    + c`.
//
// Run : npx vitest run tests/transpiler/indent-fantome-lexer-2494.test.ts

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

async function runPine(src: string) {
    const pine = new PineTS(makeBars(20), 'TEST', 'D');
    return pine.run(dedent(src));
}

describe('INDENT fantôme lexer (2494 2722, fix 117f683)', () => {
    it('commentaire à colonne 0 entre deux lignes de corps : pas d\'INDENT fantôme, le bloc reste un seul if', async () => {
        // La ligne commentaire est à la colonne 0 alors que les deux lignes
        // de corps sont indentées d'un niveau. Avant le fix, elle popait la
        // pile d'indentation et la ligne suivante rouvrait un bloc →
        // « Unexpected token INDENT ». v est déclarée AVANT le if (avec `:=`
        // pour la réassigner depuis le corps) afin de rester observable par
        // le plot ; x vit dans le corps, APRÈS le commentaire.
        const ctx = await runPine(`
//@version=5
indicator("repro")
var v = 0
if close > open
    x = 1
// commentaire a la colonne 0
    v := x + 2
plot(v, "p")
`);
        // Barre 0 (open 100, close 103) : x=1 puis v := x+2 → 3. Si le
        // commentaire avait cassé la structure, le transpile aurait échoué
        // en « Unexpected token INDENT ».
        expect(ctx.plots.p.data[0].value).toBe(3);
    });

    it('ligne commençant par un opérateur binaire : continuation après parenthèse fermante, pas de bloc', async () => {
        const ctx = await runPine(`
//@version=5
indicator("repro")
total = (close + high)
    + low
ref = close + high + low
plot(total == ref ? 1 : 0, "v")
`);
        // `+ low` à indentation plus profonde est une continuation de
        // l'expression (TV l'accepte) ; avant le fix le lexer émettait un
        // INDENT → « Unexpected token INDENT ». Le jumeau non-continué
        // doit être bit-à-bit identique sur chaque barre.
        expect(ctx.plots.v.data.every((p: { value: number }) => p.value === 1)).toBe(true);
    });
});