// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille : args nommés d'un builtin nu → positionnels (1715).
// Contrat observable : nz(source = ..., replacement = ...) doit produire le
// même scalaire que nz(..., ...), sans laisser l'objet d'arguments nommé entrer
// dans le graphe d'exécution.

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

function makeBars(n: number) {
    const DAY = 86_400_000;
    const t0 = Date.UTC(2020, 0, 1);
    const bars = [];
    for (let i = 0; i < n; i++) {
        const close = 100 + i;
        bars.push({ openTime: t0 + i * DAY, open: close, high: close + 1, low: close - 1, close, volume: 1000 + i });
    }
    return bars;
}

function dedent(s: string): string {
    const lines = s.replace(/^\n/, '').replace(/\n\s*$/, '').split('\n');
    const widths = lines.filter((line) => line.trim()).map((line) => line.match(/^ */)![0].length);
    const indent = Math.min(...widths);
    return lines.map((line) => line.slice(indent)).join('\n');
}

describe('builtin nu nz avec args nommés (1715)', () => {
    it('nz(source = ..., replacement = ...) == nz(..., ...) sur toute la série, replacement honoré', async () => {
        const pine = new PineTS(makeBars(20), 'TEST', 'D');
        // replacement = 999 (non-défaut) : sur la 1re barre close[1] est na, donc
        // nz doit rendre 999. Une régression qui ignore/mal-nomme `replacement`
        // retomberait sur 0 (défaut) — détectée ici, contrairement à replacement=0.
        const ctx = await pine.run(dedent(`
//@version=5
indicator("repro")
withNamedArgs = nz(source = close[1], replacement = 999)
withPositionalArgs = nz(close[1], 999)
plot(withNamedArgs == withPositionalArgs ? 1 : 0, "v")
plot(withNamedArgs, "nv")
`));

        // 1) Égalité nommé == positionnel sur CHAQUE barre (pas seulement la dernière).
        const values = (title: string) => (ctx.plots?.[title]?.data ?? []).map((d) => d?.value);
        const eq = values('v').filter((v) => v != null && !Number.isNaN(v as number));
        expect(eq.length).toBeGreaterThan(0);
        expect(eq.every((v) => v === 1)).toBe(true);
        // 2) Le replacement est réellement appliqué : la barre na rend 999, pas 0.
        expect(values('nv')).toContain(999);
    });
});
