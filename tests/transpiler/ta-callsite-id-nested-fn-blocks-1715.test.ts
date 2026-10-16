// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille « ta-callsite-id-nested-fn-blocks » — script révélateur 1715
// (BINANCE:ENAUSDT 60 : `f_ma(type, src, len)` avec `ta.ema(src, len)` dans un
// bloc `if type == 'EMA'`, appelée deux fois par barre : BBMC et Keltma).
// Un appel ta.* dans un bloc if/for/while/switch imbriqué dans une fonction
// recevait un identifiant d'état statique (`"_taN"`) au lieu de
// `$$.id + "_taN"` : tous les appels de la fonction partageaient le même état.
// Sans effet visible sur 1715 tant que les deux appels avaient les mêmes
// arguments et que ta.ema repartait de la barre précédente à chaque appel ;
// faux dès que les arguments diffèrent.
//
// RED-PROOF : sur le parent, le second appel (source 2×close) lit l'état du
// premier : g ≠ 2 × f.

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

type PlotContext = { plots: Record<string, { data: Array<{ value: number }> }> };

describe('ta-callsite-id-nested-fn-blocks (1715)', () => {
    it('deux appels d\'une fonction avec ta.ema dans un bloc if gardent des états séparés', async () => {
        const candles = [10, 20, 15, 30, 25, 40].map((close, bar) => ({
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
f_ma(string type, float src, int len) =>
    float result = 0
    if type == 'EMA'
        result := ta.ema(src, len)
    result
f = f_ma('EMA', close, 2)
g = f_ma('EMA', close * 2, 2)
plot(f, "f")
plot(g, "g")
`;
        // PineTS.run is typed loosely; the plots shape is fixed by the engine.
        const ctx = (await new PineTS(candles, 'TEST', 'D').run(source)) as unknown as PlotContext;
        const f = ctx.plots.f.data.map((d) => d.value);
        const g = ctx.plots.g.data.map((d) => d.value);
        for (let i = 1; i < f.length; i++) expect(g[i]).toBeCloseTo(2 * f[i], 9);
        // ema(close, 2) : amorce 15 (barre 1), puis 15, 25, 25, 35.
        expect(f[5]).toBeCloseTo(35, 9);
    });
});
