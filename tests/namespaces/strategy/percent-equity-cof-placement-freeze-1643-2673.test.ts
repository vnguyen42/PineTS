import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { initializeStrategy, markToMarket, processStrategyOrders } from '../../../src/namespaces/strategy/utils';
import { StrategyState } from '../../../src/namespaces/strategy/types';

/**
 * VIN-C — quantité `percent_of_equity` par défaut sous `calc_on_order_fills` :
 * FIGÉE AU PLACEMENT, dimensionnée sur l'equity marquée à l'INSTANT de création
 * de l'ordre (le tick intrabarre courant quand une ré-exécution COF la crée,
 * sinon la clôture de la barre de signal).
 *
 * Cibles prouvées : 1643 (BINANCE:ICPUSDT 120, 357 clôtures) et 2673
 * (BINANCE:ICPUSDT 60, 150 clôtures) — le moteur re-dérivait la quantité au
 * prix de FILL et à l'equity du fill, ce qui reproduisait son PROPRE ledger
 * (357/357) mais seulement 246/357 (resp. 99/150) du ledger TV. Deux
 * corrections indissociables :
 *
 *   1. gel au placement (plus de re-dérivation au fill) ;
 *   2. equity de sizing marquée au TICK courant sous COF — mesure
 *      discriminante 1643 barre 2599 : après le fill de renversement au tick
 *      open 8.04, la ré-exécution dimensionne sur 234040.54354 (position
 *      marquée À 8.04 → openprofit 0) → floor3(234040.54354/8.04) = 29109.520
 *      = TV, là où la marque de clôture de barre (8.01) donnait 29001.171.
 *
 * Résultat mesuré : 357/357 et 150/150 clés pleines.
 */

function strategyOf(context: Context): StrategyState {
    if (!context.strategy) throw new Error('strategy state was not initialized');
    return context.strategy;
}

function makeContext(config: Record<string, unknown> = {}): Context {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'BINANCE:ICPUSDT',
        timeframe: '120',
    });
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick: 0.01, pointvalue: 1 };
    initializeStrategy(context, {
        default_qty_type: 'percent_of_equity',
        default_qty_value: 100,
        initial_capital: 1000,
        ...config,
    });
    return context;
}

/** Position longue ouverte de `qty` @ `entryPrice`, equity marquée à `markPrice`. */
function openLongAt(context: Context, qty: number, entryPrice: number, markPrice: number): void {
    const strategy = strategyOf(context);
    strategy.opentrades = [
        { entry_id: 'L0', size: qty, entry_price: entryPrice, commission: 0, entry_time: 0, entry_bar_index: 0 },
    ];
    strategy.position_size = qty;
    strategy.position_avg_price = entryPrice;
    markToMarket(context, markPrice);
}

/** Barre de fill : ouverture 11, la barre de placement ayant clôturé à 10. */
function advanceToFillBar(context: Context): void {
    context.idx = 1;
    context.data.open = new Series([10, 11]);
    context.data.high = new Series([10, 11.5]);
    context.data.low = new Series([10, 10.5]);
    context.data.close = new Series([10, 11]);
    context.data.openTime = new Series([0, 86_400_000]);
}

describe('percent_of_equity sous calc_on_order_fills — gel au placement (1643 / 2673)', () => {
    it('garde la quantité du placement au lieu de la re-dériver au prix de fill', () => {
        const context = makeContext({ calc_on_order_fills: true });
        // Placement à la clôture 10 → qty = 1000 / 10 = 100.
        context.data.close = new Series([10]);
        entry(context)('L', 'long');
        expect(strategyOf(context).pending_orders[0].qty).toBe(100);

        // La barre de fill ouvre à 11 : l'ancienne re-dérivation au fill
        // donnait floor5(1000/11) = 90.90909. TV garde 100.
        advanceToFillBar(context);
        strategyOf(context)._cof = { pass: 0, ticks: [11, 11.5, 10.5, 11] };

        expect(processStrategyOrders(context)).toBe(1);
        expect(strategyOf(context).position_size).toBe(100);
    });

    it('dimensionne un ordre créé par une ré-exécution COF sur l\'equity marquée au TICK courant', () => {
        const context = makeContext({ calc_on_order_fills: true, pyramiding: 2 });
        // Position longue 50 @ 10 ; dernière marque de la barre : 9 →
        // openprofit −50, equity 950 (l'état porté au moment de la
        // ré-exécution, comme 1643 barre 2599).
        context.data.close = new Series([9]);
        openLongAt(context, 50, 10, 9);
        expect(strategyOf(context).equity).toBe(950);

        // Ré-exécution au 2e tick assumé (12) : réalisé 1000 + openProfit(12)
        // = 1000 + 100 → 1100, prix de sizing = ce même tick 12.
        strategyOf(context)._cof = { pass: 1, ticks: [11, 12, 10, 9] };
        entry(context)('L2', 'long');

        const placed = strategyOf(context).pending_orders.at(-1);
        expect(placed?.qty).toBe(Math.floor((1100 / 12) * 1e5) / 1e5);
        // Ancienne lecture (equity marquée à la clôture de barre) : 950/12.
        expect(placed?.qty).not.toBe(Math.floor((950 / 12) * 1e5) / 1e5);
    });

    it('hors COF, garde la marque courante de l\'equity (aucune re-marque au prix de sizing)', () => {
        const context = makeContext({ pyramiding: 2 });
        // Position longue 100 @ 10 marquée à 9 → equity 900, placement à la
        // clôture 8 : le sizing consomme l'equity portée (900 / 8 = 112.5),
        // pas une equity re-marquée à 8 (qui donnerait 800 / 8 = 100).
        openLongAt(context, 100, 10, 9);
        context.data.close = new Series([8]);
        entry(context)('L2', 'long');

        expect(strategyOf(context).pending_orders.at(-1)?.qty).toBe(112.5);
    });

    it('hors COF, remplit la quantité de placement telle quelle', () => {
        const context = makeContext();
        context.data.close = new Series([10]);
        entry(context)('L', 'long');
        expect(strategyOf(context).pending_orders[0].qty).toBe(100);

        advanceToFillBar(context);

        expect(processStrategyOrders(context)).toBe(1);
        expect(strategyOf(context).position_size).toBe(100);
    });
});
