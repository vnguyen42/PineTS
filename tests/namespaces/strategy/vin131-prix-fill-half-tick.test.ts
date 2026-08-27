// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille : `PRIX_FILL_HALF_TICK` (VIN-131) — ids révélateurs 1640 1592,
// fix fork `2bad8f1` (fills stock : prix d'affichage TV sur triggers/clamp/
// sizing). JOURNAL.md:597-601,641.
//
// Contrat observable : sur un symbole stock de tick 0.00001, un prix
// d'exécution qui tombe exactement sur le demi-tick (0.005605) est jugé et
// rempli sur la grille d'affichage TradingView (le plus proche tick,
// 0.00561) — jamais au brut 0.005605. Concrètement, le trigger des
// stop-entry est évalué sur l'OHLC affiché : un high brut au voisinage du
// demi-tick déclenche le stop affiché 0.00561 et le fill est enregistré à
// 0.00561. Avant le fix, le trigger était évalué au brut → aucune entrée.
//
// Note flottante : 0.005605/0.00001 = 560.4999999999999 en binaire (le
// double le plus proche du littéral demi-tick tombe sous 560.5) — l'arrondi
// du moteur sur le littéral nu atterrirait à 0.00560. Le test utilise le
// raw 0.0056051 (560,51 ticks), qui s'affiche 0.00561 tout en restant
// STRICTEMENT sous le stop brut 0.00561 : seul l'OHLC affiché peut
// déclencher — le mécanisme défendu par la famille.
//
// Run : npx vitest run tests/namespaces/strategy/vin131-prix-fill-half-tick.test.ts

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { Series } from '../../../src/Series';

function makeContext(config: Record<string, unknown> = {}) {
    const context: any = new Context({
        marketData: [],
        source: [],
        tickerId: 'STOCK',
        timeframe: 'D',
    } as any);
    context.idx = 0;
    context.data.open = new Series([0.0056]);
    context.data.high = new Series([0.0056]);
    context.data.low = new Series([0.00559]);
    context.data.close = new Series([0.0056]);
    context.data.openTime = new Series([0]);
    context.pine = { syminfo: { mintick: 0.00001, pointvalue: 1, type: 'stock' } } as any;
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, ...config });
    return context;
}

function setBar(context: any, idx: number, open: number, high: number, low: number, close: number, openTime = idx * 86_400_000) {
    context.idx = idx;
    context.data.open = new Series([open, open]);
    context.data.high = new Series([high, high]);
    context.data.low = new Series([low, low]);
    context.data.close = new Series([close, close]);
    context.data.openTime = new Series([openTime, openTime]);
}

describe('PRIX_FILL_HALF_TICK (VIN-131, 1640 1592, fix 2bad8f1) — tick 0.00001, demi-tick 0.005605 → 0.00561', () => {
    it('stop-entry long : open/high bruts 0.0056051 = gap au stop affiché 0.00561 → fill 0.00561', () => {
        const context = makeContext();
        // Placement sur la barre 0 à un close 0.00560, stop 0.00561 (sur grille).
        entry(context)('L', 'long', { stop: 0.00561 });
        // Barre 1 : open et high bruts 0.0056051 (affichés 0.00561 par TV, gap
        // au-dessus du stop) — le brut reste SOUS le stop 0.00561.
        setBar(context, 1, 0.0056051, 0.0056051, 0.0056, 0.0056);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(0.00561);
    });

    it('stop-entry long : franchissement intrabar au demi-tick → fill au niveau affiché 0.00561', () => {
        const context = makeContext();
        entry(context)('L', 'long', { stop: 0.00561 });
        // Barre 1 : open 0.005604 (affiché 0.00560, pas de gap), high brut
        // 0.0056051 (affiché 0.00561) → le stop est franchi intrabar.
        setBar(context, 1, 0.005604, 0.0056051, 0.0056, 0.0056);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(0.00561);
    });
});