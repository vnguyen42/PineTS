// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille « sources sans header //@version » (FAMILLES.md) — ids révélateurs
// 1742/1647/1753/1758, fixée par le commit fork eb1d303 (JOURNAL.md:58,
// 147-152). Les sources dont l'annotation de version a été perdue (headers
// probablement perdus au scraping — la première ligne peut être un
// commentaire de licence) étaient envoyées TELLES QUELLES à acorn comme
// syntaxe PineTS/JS → « SyntaxError: Unexpected token » sur le Pine brut
// (`f(x) =>`, `and`). TV compile une annotation omise en version 1, que le
// moteur refuse (< 5). Fix : retry `pineToJS(source, {forceVersion:5})` dans
// le catch du parse — le retry ne se déclenche QUE là où le parent jetait.
//
// RED-PROOF : ce test échoue sur le worktree parent `eb1d303^`
// (SyntaxError levée par run()).
//
// Contrat observable : une source Pine v5 valide SANS header //@version
// transpile et plot la valeur attendue (motif construit, pas un script réel).

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

const SOURCE = `indicator("sans header", overlay=true)
f(x) => x * 2.0
plot(f(close), "p")`;

describe('sources sans header //@version — retry forceVersion:5 (commit eb1d303)', () => {
    it('transpile et exécute une source v5 sans annotation (échec du parse JS → retry Pine v5)', async () => {
        const candles: Candle[] = [100, 101, 102].map((close, bar) => ({
            openTime: bar * 86_400_000,
            closeTime: bar * 86_400_000 + 86_399_999,
            open: close,
            high: close,
            low: close,
            close,
            volume: 1000,
        }));
        const engine = new PineTS(candles, 'TEST', 'D');
        const context = await engine.run(SOURCE);
        const data = context.plots['p']?.data ?? [];
        const v = data[data.length - 1]?.value;
        expect(v).toBe(204); // f(close) = close × 2 sur la dernière barre (close 102)
    });
});