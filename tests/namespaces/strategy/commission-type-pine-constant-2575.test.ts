// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { Indicator } from '../../../src/Indicator';
import { PineTS } from '../../../src/PineTS.class';

// Famille : CONSTANTE PINE DE commission_type — script révélateur 2575
// (campagne symboles-manquants-lot2, run-20260827T181047Z-2575, NASDAQ:APLD tf 60).
//
// Mesures capturées chez TradingView (artefacts du run 2575) :
//   - source : commission_type='strategy.commission_percent' (forme PLATE, chaîne
//     littérale). TV l'accepte et l'exécute (237 trades capturés).
//   - 09-settings-effective.json restitue la chaîne VERBATIM ("strategy.commission_percent"),
//     sans conversion ; commission_value = 0.01.
//   - 01-report-raw.json : commissionPaid = 0 (all/long/short) ; 08-tv-ledger-canonical.json
//     : aucune ligne de trade avec une commission non nulle. TV facture ZÉRO commission
//     pour une forme non reconnue — elle n'interprète pas la chaîne comme « percent ».
//   - les constantes DOC pointées (strategy.commission.percent / .cash_per_contract /
//     .cash_per_order — 259 + 7 + 15 occurrences réelles dans le corpus) produisent
//     des commissions non nulles chez TV (1719 : value 0.075 → commissionPaid
//     2823.125842500002 ; 1740 : 0.2 → 11380.077999999994).
//
// Le moteur rejetait la forme plate à la validation Indicator.prop (ENGINE_ERROR avant
// exécution) :
//   RangeError: [Indicator.prop] "commission_type" value "strategy.commission_percent"
//   is not one of: "percent", "cash_per_contract", "cash_per_order"
//
// Contrat mesuré verrouillé ici :
//   - forme PLATE (non reconnue) : acceptée sans erreur, exécution normale,
//     commission NULLE sur tous les trades. La valeur reste telle quelle dans la
//     config (aucune conversion, aucun repli sur une valeur facturante — c'est le
//     comportement mesuré de TV, pas le comportement supposé).
//   - forme POINTÉE (constante namespace, chemin sourcé par 1719/1740) : résolue
//     vers l'option runtime 'percent' et la commission % est réellement appliquée
//     au ledger.

/** Trois barres : entrée market soumise bar 0, fill à l'open 100 bar 1, stop 90 croisé bar 2. */
function candles() {
    const t0 = new Date('2024-01-01T00:00:00Z').getTime();
    const DAY = 86_400_000;
    const bars = [
        { open: 100, high: 101, low: 99, close: 100 },
        { open: 100, high: 101, low: 99, close: 100 },
        { open: 100, high: 101, low: 80, close: 95 },
    ];
    return bars.map((b, i) => ({
        openTime: t0 + i * DAY,
        open: b.open, high: b.high, low: b.low, close: b.close,
        volume: 1000, closeTime: t0 + (i + 1) * DAY - 1,
    }));
}

// Même stratégie que le révélateur 2575 : 10 lots fixes, commission_value=0.01,
// seule la forme de commission_type change entre les deux contrats.
const body = `
if bar_index == 0
    strategy.entry('long', strategy.long)
if strategy.position_size > 0
    strategy.exit('stop', 'long', stop=90)
plot(close)`;

const SOURCE_FLAT = `
//@version=5
strategy('C2575', overlay=true, default_qty_type=strategy.fixed, default_qty_value=10,
     commission_type='strategy.commission_percent', commission_value=0.01, initial_capital=3000)
${body}`;

const SOURCE_DOTTED = `
//@version=5
strategy('C2575', overlay=true, default_qty_type=strategy.fixed, default_qty_value=10,
     commission_type=strategy.commission.percent, commission_value=0.01, initial_capital=3000)
${body}`;

describe('commission_type famille strategy.commission.* — révélateur 2575', () => {
    it('forme plate non reconnue : exécution OK et commission NULLE sur tous les trades (mesure run 2575)', async () => {
        const ind = new Indicator(SOURCE_FLAT);
        const ctx = await new PineTS(candles()).run(ind);

        // S'exécute sans ENGINE_ERROR et la config garde la valeur TELLE QUELLE,
        // comme TV (09-settings-effective.json la restitue verbatim).
        expect(ctx.strategy.config.commission_type).toBe('strategy.commission_percent');
        expect(ctx.strategy.config.commission_value).toBe(0.01);

        // Ledger : un round-trip long 10 lots, entré à l'open 100, stop 90.
        expect(ctx.strategy.closedtrades).toHaveLength(1);
        const t = ctx.strategy.closedtrades[0];
        expect(t.size).toBe(10);
        expect(t.entry_price).toBe(100);
        expect(t.exit_price).toBe(90);

        // TV n'interprète pas la forme plate comme « percent » : commission
        // ZÉRO sur le trade (commissionPaid = 0, ledger TV sans commission).
        expect(t.commission).toBe(0);
    });

    it('forme pointée : la commission en % est réellement appliquée au ledger (chemin 259 sources)', async () => {
        const ind = new Indicator(SOURCE_DOTTED);
        const ctx = await new PineTS(candles()).run(ind);

        // La constante namespace strategy.commission.percent se résout vers
        // l'option runtime 'percent' (transpilateur + point de fusion config).
        expect(ctx.strategy.config.commission_type).toBe('percent');
        expect(ctx.strategy.config.commission_value).toBe(0.01);

        expect(ctx.strategy.closedtrades).toHaveLength(1);
        const t = ctx.strategy.closedtrades[0];
        expect(t.size).toBe(10);
        expect(t.entry_price).toBe(100);
        expect(t.exit_price).toBe(90);

        // Commission en POURCENTAGE du notional de chaque leg (formule moteur,
        // pointvalue du contexte réel) : 0.01 % × (qty × price × pointvalue).
        const pv = ctx.pine?.syminfo?.pointvalue ?? 1;
        const expected = 10 * 100 * pv * (0.01 / 100) + 10 * 90 * pv * (0.01 / 100);
        expect(t.commission).toBeCloseTo(expected, 10);
        expect(t.commission).toBeGreaterThan(0);
    });
});