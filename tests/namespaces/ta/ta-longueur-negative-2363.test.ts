// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille : `boucle infinie ta.* longueur négative` (FAMILLES.md) — id
// révélateur 2363, fix fork `a7aae22` (ta: reject non-positive window
// lengths instead of hanging). JOURNAL.md:172-176,178-181.
//
// Contrat observable : ta.lowest/ta.highest (et linreg/median/variance, même
// motif de fenêtre) avec une longueur ≤ 0 ne doivent PAS boucler infiniment :
// le run rend une erreur runtime TV-shaped « Invalid value of the 'length'
// argument (N) in the 'ta.<fn>' function. It must be > 0. ». Avant le fix,
// la boucle nue `while (window.length > length) window.pop()` ne terminait
// jamais pour une longueur négative (2363 pendait à l'infini).
//
// Borne : le test échoue lui-même par timeout vitest (5 s) si le moteur
// régresse vers la boucle infinie — le run ne doit jamais « réussir » en
// silence.
//
// Run : npx vitest run tests/namespaces/ta/ta-longueur-negative-2363.test.ts

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

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

describe('longueur négative/interdite sur les fenêtres ta.* (2363, fix a7aae22)', () => {
    it('ta.lowest(close, -570) : erreur runtime TV-shaped, pas de boucle infinie', async () => {
        const pine = new PineTS(makeBars(20), 'TEST', 'D');
        await expect(pine.run(dedent(`
//@version=5
indicator("repro")
v = ta.lowest(close, -570)
plot(v)
`))).rejects.toThrow(/Invalid value of the 'length' argument \(-570\) in the 'ta\.lowest' function\. It must be > 0\./);
    });

    it('ta.highest(close, 0) : longueur nulle également rejetée avec le même contrat', async () => {
        const pine = new PineTS(makeBars(20), 'TEST', 'D');
        await expect(pine.run(dedent(`
//@version=5
indicator("repro")
v = ta.highest(close, 0)
plot(v)
`))).rejects.toThrow(/Invalid value of the 'length' argument \(0\) in the 'ta\.highest' function\. It must be > 0\./);
    });
});