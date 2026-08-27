// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille « surcharges de fonctions + retour de réaffectation » (FAMILLES.md)
// — ids révélateurs 2699/2126, fixée par le commit fork 1fe12e8
// (JOURNAL.md:229-235). Deux racines amont indépendantes :
//   1. Les overloads Pine (même nom, arités différentes) étaient émis en
//      `function <nom>` frères dans le même scope JS → last-wins ; un appel
//      3-args atterrissait dans la surcharge 2-params (le crash de 2699 :
//      `DFT3(x, y, 1)`). Fix : variantes `<nom>_$ov<i>` + registre
//      min/max-arity + dispatcher par `arguments.length` (exact d'abord,
//      puis dernière compatible [min..max], sinon last-wins).
//   2. `Context.set()` retournait undefined alors que le codegen émet
//      `return $.precision($.set(…))` pour une fonction finissant par une
//      réaffectation `x := …` (docs TV : le retour est la dernière valeur du
//      corps) → NaN silencieux (ema2 de la lib ta/5, 2126 SILENT_SUSPECT).
//      Fix : set() retourne la valeur écrite.
//
// RED-PROOF : les deux assertions échouent sur le worktree parent
// `1fe12e8^` (p1 = −1 au lieu de 6 ; p2 = NaN au lieu de 2).
//
// Contrat observable : une source Pine donnée plot la valeur attendue —
// jamais le texte du JS généré.

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

interface Candle {
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

function runOnce(closeValues: number[], source: string): Promise<{ plots: Record<string, { data: Array<{ value: number | null }> }> }> {
    const candles: Candle[] = closeValues.map((close, bar) => ({
        openTime: bar * 86_400_000,
        closeTime: bar * 86_400_000 + 86_399_999,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1000,
    }));
    return new PineTS(candles, 'TEST', 'D').run(source);
}

function lastPlotValue(context: { plots: Record<string, { data: Array<{ value: number | null }> }> }, key: string): number | null {
    const data = context.plots[key]?.data ?? [];
    const v = data[data.length - 1]?.value;
    return v == null || Number.isNaN(v) ? null : v;
}

describe('surcharges de fonctions + retour de réaffectation (commit 1fe12e8)', () => {
    it('2699 : un appel 3-args atteint la surcharge 3-params, pas la dernière déclarée (last-wins)', async () => {
        const source = `
//@version=5
indicator("overload 2699", overlay=true)
f(a, b, c) => a + b + c
f(a, b) => a - b
plot(f(1.0, 2.0, 3.0), "p1")`;
        // Avant 1fe12e8 : la 2-params (dernière déclarée) gagnait → 1−2 = −1.
        // Après : dispatcher par arité → 1+2+3 = 6.
        const context = await runOnce([100, 101, 102], source);
        expect(lastPlotValue(context, 'p1')).toBe(6);
    });

    it('2126 : une fonction se terminant par `x := …` retourne la valeur écrite', async () => {
        const source = `
//@version=5
indicator("reassign 2126", overlay=true)
f() =>
    x = 1.0
    x := x + 1.0
plot(f(), "p2")`;
        // Avant 1fe12e8 : set() retournait undefined → $.precision(undefined)
        // → NaN. Après : retour = 2.0 (dernière valeur du corps, docs TV).
        const context = await runOnce([100, 101, 102], source);
        expect(lastPlotValue(context, 'p2')).toBe(2);
    });
});