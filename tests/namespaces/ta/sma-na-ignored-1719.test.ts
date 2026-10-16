// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille « sma-na-ignored » — script révélateur 1719 (NYSE:SQ 60, v4 :
// `vol = volume / hilow` vaut na sur une barre O=H=L=C, puis
// `smooth = sma(v, 14)`). TradingView ignore les valeurs na de la source de
// ta.sma : la moyenne porte sur les `length` dernières valeurs NON-na
// (FAQ Pine « na values in the source series are ignored »). Le moteur rendait
// na tant que la fenêtre de 14 barres contenait la barre na, et le signal de
// 1719 manquait ses entrées des barres 448 et 534 (196 trades contre TV 198).
// Preuve sur le plot TV `ema(out, 84)` de 1719 : le modèle « fenêtre des 14
// dernières valeurs non-na » reproduit 18743/18744 barres TV, le modèle
// « na propagé » non.
//
// RED-PROOF : sur le parent, les barres 4 et 5 valent NaN.

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

type PlotContext = { plots: Record<string, { data: Array<{ value: number }> }> };

describe('sma-na-ignored (1719)', () => {
    it('une valeur na de la source est ignorée : la fenêtre reprend sur les dernières valeurs non-na', async () => {
        const candles = [1, 2, 3, 4, 5, 6, 7, 8].map((close, bar) => ({
            openTime: bar * 86_400_000,
            closeTime: bar * 86_400_000 + 86_399_999,
            open: close,
            high: close,
            low: close,
            close,
            volume: 1000,
        }));
        const source = `
//@version=5
indicator("t")
src = bar_index == 3 ? na : close
plot(ta.sma(src, 3), "p")
`;
        // PineTS.run is typed loosely; the plots shape is fixed by the engine.
        const ctx = (await new PineTS(candles, 'TEST', 'D').run(source)) as unknown as PlotContext;
        const values = ctx.plots.p.data.map((d) => d.value);
        // 0,1 : warm-up ; 2 : (1+2+3)/3 ; 3 : source na → na ;
        // 4 : (2+3+5)/3 ; 5 : (3+5+6)/3 ; 6 : (5+6+7)/3 ; 7 : (6+7+8)/3.
        // Précision 9 : indépendante de l'arrondi éventuel des sorties ta.
        expect(values.slice(0, 2).every((v: number) => Number.isNaN(v))).toBe(true);
        expect(values[2]).toBeCloseTo(2, 9);
        expect(Number.isNaN(values[3])).toBe(true);
        expect(values[4]).toBeCloseTo(10 / 3, 9);
        expect(values[5]).toBeCloseTo(14 / 3, 9);
        expect(values[6]).toBeCloseTo(6, 9);
        expect(values[7]).toBeCloseTo(7, 9);
    });

    // Revue : le remplissage d'une fenêtre incomplète saute aussi les na —
    // relire un décalage brut de barre après des na sautés comptait une
    // valeur deux fois ou comblait un vrai trou. ROUGE avant le correctif
    // (16.6667 = (30+10+10)/3 à la barre 2 ; 25 à la barre 4).
    async function runCloses(script: string) {
        const candles = [10, 20, 30, 40, 50, 60, 70, 80].map((close, bar) => ({
            openTime: bar * 86_400_000, closeTime: bar * 86_400_000 + 86_399_999,
            open: close, high: close, low: close, close, volume: 1000,
        }));
        const ctx = (await new PineTS(candles, 'TEST', 'D').run(script)) as unknown as PlotContext;
        return ctx.plots.p.data.map((d) => d.value);
    }

    it('fenêtre incomplète après un na : pas de double comptage', async () => {
        const values = await runCloses(`
//@version=5
indicator("t")
src = bar_index == 1 ? na : close
plot(ta.sma(src, 3), "p")
`);
        expect(Number.isNaN(values[2])).toBe(true);
        expect(values[3]).toBeCloseTo((40 + 30 + 10) / 3, 9);
    });

    it('fenêtre incomplète après deux na : pas de trou comblé', async () => {
        const values = await runCloses(`
//@version=5
indicator("t")
src = bar_index == 2 or bar_index == 3 ? na : close
plot(ta.sma(src, 4), "p")
`);
        expect(Number.isNaN(values[4])).toBe(true);
        expect(values[5]).toBeCloseTo((60 + 50 + 20 + 10) / 4, 9);
    });

    // Self-referential source (NYSE:SQ 1613: `chopIndex := sma(chopIndex, n)`):
    // the variable history holds the na outputs of the warm-up, not the values
    // passed in. After a leading na the window fills from its own calls (bar 5 on), as before the
    // na rule; rebuilding it from the source history kept it empty forever and
    // 1613 lost all its trades. ROUGE avec la fenêtre reconstruite depuis
    // l'historique seul, VERT après.
    it('source auto-référencée : la fenêtre se remplit par ses propres appels', async () => {
        const values = await runCloses(`
//@version=5
indicator("t")
x = bar_index < 3 ? na : close
x := ta.sma(x, 3)
plot(x, "p")
`);
        expect(values.slice(0, 5).every((v: number) => Number.isNaN(v))).toBe(true);
        expect(values[5]).toBeCloseTo(50, 9);
        expect(values[7]).toBeCloseTo(70, 9);
    });
});
