// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille « crossover-na-previous » — script révélateur 1719 (NYSE:SQ 60, v4 :
// `buy = crossover(close, st_line) and close > o`). Barre 446 plate → st_line
// na ; barre 447 : close 9.74 > st_line 9.715. TV marque buy = 1 à 447 (plot
// `buy` capturé) alors que st_line[1] est na : la comparaison précédente est
// prise sur la dernière barre où les deux séries sont non-na (445 : 9.54 ≤
// 9.726). Contre-preuve sur la même capture, barre 124 : première valeur de
// st_line sans aucune barre valide avant, close > st_line et close > o, TV
// buy = 0 — donc pas de « na précédent = condition satisfaite ». Le moteur
// rendait false dès que la barre précédente était na, et 1719 perdait son
// entrée de la barre 448. crossunder suit la même règle (symétrique, pas de
// barre discriminante dans 1719).
//
// RED-PROOF : sur le parent, les cas « reprise après na » rendent 0.

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

type PlotContext = { plots: Record<string, { data: Array<{ value: number }> }> };

async function run(source: string) {
    const closes = [1, 1, 1, 5, 5, 1];
    const candles = closes.map((close, bar) => ({
        openTime: bar * 86_400_000,
        closeTime: bar * 86_400_000 + 86_399_999,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1000,
    }));
    // PineTS.run is typed loosely; the plots shape is fixed by the engine.
    const ctx = (await new PineTS(candles, 'TEST', 'D').run(source)) as unknown as PlotContext;
    return (key: string) => ctx.plots[key].data.map((d) => d.value);
}

describe('crossover-na-previous (1719)', () => {
    it('la barre précédente na est sautée : comparaison sur la dernière paire non-na', async () => {
        const plot = await run(`
//@version=5
indicator("t")
y = bar_index == 2 ? na : 3.0
over = ta.crossover(close, y)
plot(over ? 1 : 0, "over")
z = bar_index == 4 ? na : 3.0
under = ta.crossunder(close, z)
plot(under ? 1 : 0, "under")
`);
        // crossover à 3 : précédent non-na = barre 1 (1 <= 3), courant 5 > 3.
        expect(plot('over')).toEqual([0, 0, 0, 1, 0, 0]);
        // crossunder à 5 : précédent non-na = barre 3 (5 >= 3), courant 1 < 3.
        expect(plot('under')).toEqual([0, 0, 0, 0, 0, 1]);
    });

    // Garde (vert aussi sur le parent) : exclut la variante « na précédent =
    // condition satisfaite », réfutée par la barre 124 de 1719.
    it('aucune paire non-na avant : pas de croisement', async () => {
        const plot = await run(`
//@version=5
indicator("t")
y = bar_index < 3 ? na : 3.0
over = ta.crossover(close, y)
plot(over ? 1 : 0, "over")
`);
        expect(plot('over')).toEqual([0, 0, 0, 0, 0, 0]);
    });

    // Revue : ta.cross suit la même règle (cross = crossover ou crossunder).
    // ROUGE avant le correctif de cross.ts (barre précédente na → false).
    it('ta.cross saute aussi la barre précédente na', async () => {
        const plot = await run(`
//@version=5
indicator("t")
y = bar_index == 2 ? na : 3.0
c1 = ta.cross(close, y)
plot(c1 ? 1 : 0, "c1")
z = bar_index == 4 ? na : 3.0
c2 = ta.cross(close, z)
plot(c2 ? 1 : 0, "c2")
`);
        expect(plot('c1')).toEqual([0, 0, 0, 1, 0, 1]);
        expect(plot('c2')).toEqual([0, 0, 0, 1, 0, 1]);
    });
});
