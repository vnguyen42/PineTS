// Famille « futures-exit-stop-rounding » — script révélateur 2537
// (CBOT_MINI:YM1! 240, mintick 1). Un stop absolu de position ouverte est
// arrondi CONTRE la position (long → bas, short → haut) sur un future comme
// sur une action, même quand il se trouve de l'autre côté du close courant.
// Preuve TV (capture night-L2c-futures240-20261016) : sur 437 sorties stop
// de 2537, TV prend le tick inférieur ; le seul cas où le stop long dépasse
// le close de placement (2024-10-25 : stop 42733 × 0.99 = 42305.67, close
// 42305, barre suivante ouverte à 42306) sort à 42305. Le moteur arrondissait
// « loin du close » → 42306 et sortait à l'ouverture 42306.
// Même règle sur CL1! (2205) : structurel 845 → 972 appariés sur 1028.
//
// Le stop d'un bracket lié à une entrée en attente (reversal : entrée long en
// attente pendant une position short) ferme le côté de CETTE entrée : il
// s'arrondit vers le bas (même règle de direction liée que la limite, 2808).
//
// RED-PROOF : sur le parent, la sortie se fait à 42306 (stop arrondi à 42306,
// déclenché à l'ouverture) et le stop du bracket de reversal vaut 100.

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { initializeStrategy, openTrade, processExitOrders } from '../../../src/namespaces/strategy/utils';

function setBar(context: Context, idx: number, open: number, high: number, low: number, close: number) {
    context.idx = idx;
    context.data.open = new Series([open]);
    context.data.high = new Series([high]);
    context.data.low = new Series([low]);
    context.data.close = new Series([close]);
    context.data.openTime = new Series([idx * 14_400_000]);
}

describe('futures-exit-stop-rounding (2537)', () => {
    it('un stop long au-dessus du close de placement est arrondi vers le bas', () => {
        const context = new Context({ marketData: [], source: [], tickerId: 'CBOT_MINI:YM1!', timeframe: '240' });
        context.pine = { syminfo: { type: 'futures', mintick: 1, pointvalue: 5 } };
        context.pineVersion = 5;
        initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
        // Barres réelles 18192/18193 de la capture 2537.
        setBar(context, 0, 42733, 42811, 42252, 42305);
        openTrade(context, 'Long', 1, 23, 42733, 0);
        exit(context)('TP/SL Long', { from_entry: 'Long', stop: 42733 * 0.99, limit: 42733 * 1.02 }, { __callsiteId: 'tpsl' });
        setBar(context, 1, 42306, 42415, 42245, 42285);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades[0].exit_price).toBe(42305);
    });

    it('le stop d\'un bracket de reversal suit la direction de l\'entrée liée', () => {
        const context = new Context({ marketData: [], source: [], tickerId: 'CBOT_MINI:YM1!', timeframe: '240' });
        context.pine = { syminfo: { type: 'futures', mintick: 1, pointvalue: 5 } };
        context.pineVersion = 5;
        initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
        // Close 99 sous le stop 99.67 : « loin du close » (parent) et « contre la
        // position short » (sans direction liée) donnent tous deux 100.
        setBar(context, 0, 101, 102, 98, 99);
        openTrade(context, 'Short', -1, 1, 101, 0);
        entry(context)('Long', 'long', { qty: 1 });
        exit(context)('SL Long', { from_entry: 'Long', stop: 99.67 }, { __callsiteId: 'sl' });
        const pendingExit = context.strategy!.pending_orders.find((order) => order.category === 'exit' && order.id === 'SL Long');
        expect(pendingExit?.stop).toBe(99);
    });
});
