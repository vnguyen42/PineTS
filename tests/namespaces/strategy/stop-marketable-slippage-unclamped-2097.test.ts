import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { Series } from '../../../src/Series';

// Famille : STOP_MARKETABLE_SLIPPAGE_UNCLAMPED — script révélateur 2097
// (BINANCE:ENAUSDT 60, slippage 2, entrées `strategy.entry(..., stop=red_ema)`
// déjà franchies à la soumission). Un stop marketable à la soumission
// s'exécute comme un ordre MARKET à l'ouverture suivante, et comme un fill
// market son slippage n'est pas borné à la barre : le long du 2024-09-26
// 12:00 sur une barre open = high = 0.3729 est rempli à 0.3731 chez TV
// (21/21 entrées de ce type à open ± 2 ticks au-delà du high/low). Le moteur
// bornait au high (0.3729) — 21 clés structurelles fausses (442/463).
// ROUGE sur le parent 87f4286 (0.3729 / 0.1746), VERT après.
function makeContext() {
    const context = new Context({ marketData: [], source: [], tickerId: 'ENAUSDT', timeframe: '60' });
    context.idx = 0;
    context.data.open = new Series([0.35]);
    context.data.high = new Series([0.36]);
    context.data.low = new Series([0.34]);
    context.data.close = new Series([0.35]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick: 0.0001, pointvalue: 1, type: 'spot' };
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, slippage: 2 });
    return context;
}

function setBar(context: Context, open: number, high: number, low: number, close: number) {
    context.idx = 1;
    context.data.open = new Series([0.35, open]);
    context.data.high = new Series([0.36, high]);
    context.data.low = new Series([0.34, low]);
    context.data.close = new Series([0.35, close]);
    context.data.openTime = new Series([0, 3_600_000]);
}

describe('STOP_MARKETABLE_SLIPPAGE_UNCLAMPED (2097)', () => {
    it('a long stop marketable at submission fills at open + slippage above an open = high bar', () => {
        const context = makeContext();
        entry(context)('L', 'long', { stop: 0.3254 }); // below the submission close: marketable
        setBar(context, 0.3729, 0.3729, 0.3457, 0.3484);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(0.3731);
    });

    it('a short stop marketable at submission fills at open − slippage below the bar low', () => {
        const context = makeContext();
        entry(context)('S', 'short', { stop: 0.3814 }); // above the submission close: marketable
        setBar(context, 0.3747, 0.381, 0.3746, 0.3805);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(0.3745);
    });
});
