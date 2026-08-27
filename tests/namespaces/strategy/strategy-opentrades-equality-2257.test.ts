// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille « égalité `strategy.opentrades` » (FAMILLES.md) — id révélateur
// 2257, fixée par le commit fork dd77bc7 (JOURNAL.md:28, 39-41). Le getter
// `strategy.opentrades` (accès nu) retourne un objet hybride dont le compte
// est exposé via valueOf() ; `__eq`/`__neq` retombaient sur `===`/`!==`
// stricts qui n'invoquent jamais valueOf → `strategy.opentrades == 0` était
// TOUJOURS faux (2257 : 73 déclenchements de la condition d'entrée, 0
// passage, 0 trade). Fix : normalisation valueOf() des opérandes objet
// avant la branche numérique ; identité préservée pour les objets ordinaires.
//
// RED-PROOF : ce test échoue sur le worktree parent `dd77bc7^` — l'entrée
// gatée par `== 0` ne se déclenche jamais → 0 trade fermé.
//
// Contrat observable : le ledger d'un strategy() dont les ordres sont gatés
// par des égalités sur le compte de trades ouverts (résultat, pas texte).

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

interface Candle {
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

const SOURCE = `
//@version=5
strategy("opentrades eq 2257", overlay=true, default_qty_type=strategy.fixed, default_qty_value=1)
if strategy.opentrades == 0 and bar_index == 0
    strategy.entry("L", strategy.long)
if strategy.opentrades != 0
    strategy.close("L")`;

describe('égalité `strategy.opentrades` (commit dd77bc7)', () => {
    it('`strategy.opentrades == 0` déclenche l\'entrée à plat et `!= 0` la sortie en position', async () => {
        const candles: Candle[] = [100, 101, 102, 103, 104].map((close, bar) => ({
            openTime: bar * 86_400_000,
            closeTime: bar * 86_400_000 + 86_399_999,
            open: close,
            high: close + 1,
            low: close - 1,
            close,
            volume: 1000,
        }));
        const engine = new PineTS(candles, 'TEST', 'D');
        const context = await engine.run(SOURCE);
        const strategy = context.strategy as { closedtrades: unknown[]; opentrades: unknown[]; position_size: number };

        // Avant dd77bc7 : `== 0` toujours faux → aucune entrée (0 trade,
        // condition d'entrée jamais vraie, cf. instrumentations 2257).
        // Après : entrée barre 0 (unique, `and bar_index == 0`), sortie dès
        // la première barre en position (`!= 0`) → exactement un round-trip
        // fermé, plus rien d'ouvert.
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.opentrades).toHaveLength(0);
        expect(strategy.position_size).toBe(0);
    });
});