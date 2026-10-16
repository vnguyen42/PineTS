// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille « ema-loop-chained-calls » — script révélateur 2539 (« Hypertrend » :
// `for i = 0 to 20` → `ta.ema(close, loopCount) / ta.sma(close, loopCount)`).
// Un même site d'appel ta.ema exécuté plusieurs fois dans la même exécution
// de barre (corps de boucle) enchaîne sur le résultat de l'appel précédent,
// comme TradingView. Le moteur repartait à chaque appel de l'état validé à la
// barre précédente. Preuve : le plot TV `ta.sma(SCORE,20) / ta.ema(SCORE,20)`
// de 2539 (CME_MINI:NQ1! 120) est reproduit sur 20916/20916 barres par le
// modèle enchaîné, et sur aucune barre par le modèle « repartir de la barre
// précédente ». 2539 : 5/330 → 339/339 trades (NQ1! 120), 13/372 → 387/387
// (CL1! 60).
//
// RED-PROOF : sur le parent, l'appel L=2 de la barre 0 n'est pas amorcé (NaN)
// et les barres suivantes repartent de l'état de la barre précédente.

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

type PlotContext = { plots: Record<string, { data: Array<{ value: number }> }> };

describe('ema-loop-chained-calls (2539)', () => {
    it('les appels successifs d\'un même ta.ema dans une boucle s\'enchaînent dans la barre', async () => {
        const candles = [10, 40, 10].map((close, bar) => ({
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
v = 0.0
for L = 1 to 2
    v := ta.ema(close, L)
plot(v, "p")
`;
        // PineTS.run is typed loosely; the plots shape is fixed by the engine.
        const ctx = (await new PineTS(candles, 'TEST', 'D').run(source)) as unknown as PlotContext;
        const values = ctx.plots.p.data.map((d) => d.value);
        // Barre 0 : L=1 amorce 10, L=2 (enchaîné) amorce sur 2 appels → 10.
        // Barre 1 : L=1 → 40 (alpha 1), L=2 part de 40 → 40.
        // Barre 2 : L=1 → 10, L=2 part de 10 → 10.
        expect(values[0]).toBeCloseTo(10, 9);
        expect(values[1]).toBeCloseTo(40, 9);
        expect(values[2]).toBeCloseTo(10, 9);
    });
});
