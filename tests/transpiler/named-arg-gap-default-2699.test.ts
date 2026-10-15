// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille « named-arg-gap-default » — script révélateur 2699 (FX:EURCHF 240,
// `aprox.smooth(aprox.FFT(volume), src = volume[1], maxEmaLength = maxEmaLength)`).
// Un paramètre de fonction utilisateur SAUTÉ par des arguments nommés doit
// prendre sa valeur par défaut. pineToJS place un `undefined` dans le trou
// (`f(1, c = 5)` → `f(1, undefined, 5)`), mais le transpileur l'enveloppait
// en `$.param(undefined)` : une Series, donc le défaut JS ne s'appliquait
// jamais et le paramètre valait `undefined` (→ NaN). Sur 2699, `_devided`
// (défaut 10) et `minEmaLength` (défaut 1) sautés rendaient le filtre NaN et
// la longueur d'EMA dynamique fausse : 226/858 trades justes contre TV 884.
//
// RED-PROOF : sur le parent 22bd364, les trois plots valent NaN (attendus
// 8, 16 et close + 2).

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

function run(source: string) {
    const candles = [1, 2, 3, 4, 5].map((close, bar) => ({
        openTime: bar * 86_400_000,
        closeTime: bar * 86_400_000 + 86_399_999,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1000,
    }));
    return new PineTS(candles, 'TEST', 'D').run(source) as Promise<{ plots: Record<string, { data: Array<{ value: number }> }> }>;
}

describe('named-arg-gap-default (2699)', () => {
    it('un paramètre sauté par un argument nommé prend sa valeur par défaut', async () => {
        const ctx = await run(`
//@version=5
indicator("t")
f(a, b = 2, c = 3) => a + b + c
plot(f(1, c = 5), "p")
`);
        expect(ctx.plots.p.data.map((d) => d.value)).toEqual([8, 8, 8, 8, 8]);
    });

    it('surcharge par arité + trou nommé (forme de aprox.smooth)', async () => {
        const ctx = await run(`
//@version=5
indicator("t")
g(x, y = 10) => x + y
g(x, y = 10, z = 100) => x + y + z
plot(g(1, z = 5), "p")
`);
        expect(ctx.plots.p.data.map((d) => d.value)).toEqual([16, 16, 16, 16, 16]);
    });

    it('défaut série (src = close) conservé quand un paramètre suivant est nommé', async () => {
        const ctx = await run(`
//@version=5
indicator("t")
h(int len = 2, series float src = close, int k = 0) => src + len + k
plot(h(k = 0), "p")
`);
        expect(ctx.plots.p.data.map((d) => d.value)).toEqual([3, 4, 5, 6, 7]);
    });
});
