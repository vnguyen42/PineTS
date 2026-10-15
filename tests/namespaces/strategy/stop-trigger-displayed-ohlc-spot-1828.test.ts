import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processExitOrders, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { Series } from '../../../src/Series';

// Famille : STOP_TRIGGER_DISPLAYED_OHLC_SPOT — script révélateur 1828
// (BINANCE:XLMUSDT D, mintick 0.0001, barres brutes à 5 décimales). TV
// évalue le déclenchement d'un stop sur l'OHLC AFFICHÉ (arrondi au mintick)
// aussi pour le spot crypto, comme pour les actions (VIN-136) : le buy-stop
// 0.0792 du 2020-10-16 se remplit à 0.0792 sur un high brut 0.07919
// (affiché 0.0792) ; le moteur attendait la barre suivante, ce qui décalait
// une entrée et toute la cascade d'équité (pleine clé 154/410).
// ROUGE sur le parent (aucun fill), VERT après.
function makeContext(type: string, config: Record<string, unknown> = {}, mintick = 0.0001) {
    const context = new Context({ marketData: [], source: [], tickerId: 'XLMUSDT', timeframe: 'D' });
    context.idx = 0;
    context.data.open = new Series([0.07398]);
    context.data.high = new Series([0.07441]);
    context.data.low = new Series([0.07182]);
    context.data.close = new Series([0.07408]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick, pointvalue: 1, type };
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, ...config });
    return context;
}

function setBar(context: Context, open: number, high: number, low: number, close: number) {
    context.idx = 1;
    context.data.open = new Series([0.07398, open]);
    context.data.high = new Series([0.07441, high]);
    context.data.low = new Series([0.07182, low]);
    context.data.close = new Series([0.07408, close]);
    context.data.openTime = new Series([0, 86_400_000]);
}

describe('STOP_TRIGGER_DISPLAYED_OHLC_SPOT (1828)', () => {
    it('fills a buy stop whose level equals the DISPLAYED high, at the level', () => {
        const context = makeContext('spot');
        entry(context)('Long', 'long', { stop: 0.0792 });
        setBar(context, 0.07408, 0.07919, 0.07191, 0.07909);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(0.0792);
    });

    it('fills a sell stop whose level equals the DISPLAYED low, at the level (crypto type too)', () => {
        const context = makeContext('crypto');
        entry(context)('Short', 'short', { stop: 0.0719 });
        setBar(context, 0.07408, 0.0745, 0.07194, 0.0731);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(0.0719);
    });

    it('does not fill when the displayed high stays one tick below the level', () => {
        const context = makeContext('spot');
        entry(context)('Long', 'long', { stop: 0.0792 });
        setBar(context, 0.07408, 0.07914, 0.07191, 0.07909);

        expect(processStrategyOrders(context)).toBe(0);
        expect(context.strategy.opentrades).toHaveLength(0);
    });

    it('keeps the same-bar exit of an entry reached only on the displayed high (review repro)', () => {
        // The intrabar path position of the displayed-only fill must come
        // from the DISPLAYED path: open → high (entry 0.0792) → low (exit
        // stop 0.075) on the same bar, as for a stock. A raw path position
        // never reaches 0.0792 and pushed the exit to the next bar.
        const context = makeContext('spot');
        entry(context)('Long', 'long', { stop: 0.0792 });
        exit(context)('X', 'Long', { stop: 0.075 });
        setBar(context, 0.0791, 0.07919, 0.0749, 0.0752);

        processStrategyOrders(context);
        processExitOrders(context, 'intrabar');
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0].entry_price).toBe(0.0792);
        expect(context.strategy.closedtrades[0].exit_price).toBe(0.075);
    });

    it('clamps a slipped fill on the RAW range when the level is on the raw high up to float noise (1665, review repro)', () => {
        // The level 2538 × 0.001 = 2.5380000000000003 sits 1 ulp above the
        // raw high 2.538: the pre-slippage level is inside the raw range, so
        // the slipped fill clamps to the raw 2.538 like the parent, never to
        // the noisy displayed high.
        const context = makeContext('crypto', { slippage: 1 }, 0.001);
        entry(context)('Long', 'long', { stop: 2.538 });
        setBar(context, 2.53, 2.538, 2.52, 2.535);

        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(2.538);
    });
});
