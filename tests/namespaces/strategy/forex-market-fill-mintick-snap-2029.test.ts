// Famille « forex-market-fill-mintick-snap » — script révélateur 2029
// (FX:EURUSD 60). Les bougies TV forex portent quelques prix au demi-tick
// (42 valeurs sur 90 660 pour 2029). TradingView exécute un ordre marché à
// l'ouverture 1.087225 au tick 1.08723 (même règle que crypto/actions :
// Math.round du quotient binaire). 7/7 fills d'ouverture hors grille des
// captures forex le confirment (1763, 2029, 2733 FX:EURUSD ; 2550 FX:CADJPY
// 109.3055 → 109.305). Le moteur exécutait au prix brut, d'où des P&L
// décalés et des quantités percent_of_equity ±1 en cascade :
// 2029 853/855 · 848/853 → 855/855 · 855/855 ; 2733 797/799 → 799/799.
//
// RED-PROOF : sur le parent, l'entrée est enregistrée à 1.087225.

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { Series } from '../../../src/Series';

function setBar(context: Context, idx: number, open: number, high: number, low: number, close: number) {
    context.idx = idx;
    context.data.open = new Series([open]);
    context.data.high = new Series([high]);
    context.data.low = new Series([low]);
    context.data.close = new Series([close]);
    context.data.openTime = new Series([idx * 3_600_000]);
}

describe('forex-market-fill-mintick-snap (2029)', () => {
    it('une entrée marché à une ouverture demi-tick est exécutée au tick', () => {
        const context = new Context({ marketData: [], source: [], tickerId: 'FX:EURUSD', timeframe: '60' });
        context.pine = { syminfo: { mintick: 0.00001, pointvalue: 1, type: 'forex' } };
        initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
        // Barres réelles 3091/3092 de la capture 2029.
        setBar(context, 0, 1.08676, 1.087405, 1.08635, 1.087225);
        entry(context)('Long', 'long');
        setBar(context, 1, 1.087225, 1.08755, 1.08603, 1.08617);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy!.opentrades[0].entry_price).toBe(1.08723);
    });
});
