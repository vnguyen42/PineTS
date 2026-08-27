// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { Indicator } from '../../../src/Indicator';
import { PineTS } from '../../../src/PineTS.class';

// Famille : CONSTANTE PINE DE commission_type (forme plate TV) — script révélateur 2575
// (campagne symboles-manquants-lot2, run-20260827T181047Z-2575, NASDAQ:APLD tf 60).
//
// Le script réel déclare `commission_type='strategy.commission_percent'` (source DB
// TradeSearcher id 2575). TradingView l'accepte et l'exécute — 237 trades capturés —
// et le 09-settings-effective.json du run restitue la valeur TELLE QUELLE
// ("strategy.commission_percent") : c'est la représentation interne TV de la famille
// strategy.commission.* (forma plate dans metaInfo.inputs, forme doc Pine pointée
// strategy.commission.percent dans la référence v5/v6).
//
// Le moteur rejetait la valeur à la validation Indicator.prop (ENGINE_ERROR avant
// exécution) :
//   RangeError: [Indicator.prop] "commission_type" value "strategy.commission_percent"
//   is not one of: "percent", "cash_per_contract", "cash_per_order"
//
// Le fix normalise les formes plate/pointée de la famille vers la valeur moteur
// (la même option que la constante documentée) à l'écriture du proxy ET au point de
// fusion de la config strategy (initializeStrategy / re-merge any) ; toute valeur
// hors famille reste refusée — pas de repli silencieux.

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

const SOURCE = `
//@version=5
strategy('C2575', overlay=true, default_qty_type=strategy.fixed, default_qty_value=10,
     commission_type='strategy.commission_percent', commission_value=0.01, initial_capital=3000)
if bar_index == 0
    strategy.entry('long', strategy.long)
if strategy.position_size > 0
    strategy.exit('stop', 'long', stop=90)
plot(close)`;

// La vue `.prop` est construite par defineProperty dans le constructeur de
// Indicator — absente du type de la classe ; sa forme est une Record à clés
// de schéma (valeurs unknown).
type PropView = Record<string, unknown>;
const propView = (ind: Indicator): PropView => ind.prop as unknown as PropView;

describe('commission_type constante Pine plate (family strategy.commission.*) — révélateur 2575', () => {
    it('accepte la forme plate TV via Indicator.prop et la normalise (chemin applySettings du rejeu)', () => {
        const ind = new Indicator(`//@version=5\nstrategy('X')\nplot(close)`);
        const view = propView(ind);
        view['commission_type'] = 'strategy.commission_percent';
        expect(view['commission_type']).toBe('percent');
        view['commission_type'] = 'strategy.commission.cash_per_order';
        expect(view['commission_type']).toBe('cash_per_order');
        view['commission_type'] = 'strategy.commission_cash_per_contract';
        expect(view['commission_type']).toBe('cash_per_contract');
    });

    it('refuse toujours une valeur hors famille (inconnue reste une erreur, pas de repli)', () => {
        const ind = new Indicator(`//@version=5\nstrategy('X')\nplot(close)`);
        const view = propView(ind);
        for (const bad of [
            'strategy.commission_fees',
            'strategy.commission.other',
            'strategy.commission',
            'junk',
        ]) {
            expect(() => { view['commission_type'] = bad; }).toThrow(/not one of/);
        }
    });

    it("exécute une stratégie déclarant la constante plate et booke la commission en % sur le ledger", async () => {
        const ind = new Indicator(SOURCE);
        const ctx = await new PineTS(candles()).run(ind);

        // S'exécute sans ENGINE_ERROR et la config reçoit la valeur canonique.
        expect(ctx.strategy.config.commission_type).toBe('percent');
        expect(ctx.strategy.config.commission_value).toBe(0.01);

        // Ledger : un round-trip long 10 lots, entré à l'open 100, stop 90.
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