import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { StrategyState } from '../../../src/namespaces/strategy/types';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { initializeStrategy, markToMarket, processStrategyOrders } from '../../../src/namespaces/strategy/utils';

// Famille : base d'equity du sizing percent_of_equity — VIN-137, révélateurs
// 2615 (NYSE:HD) et 1565 (NYSE:BE). TradingView dimensionne un ordre à prix
// déclaré (stop/limit) sur l'equity de PLACEMENT : initial_capital +
// netprofit (commissions d'entrée des trades ouverts déjà débitées) + le
// P&L LATENT de la position ouverte, marqué au CLOSE AFFICHÉ de la barre de
// signal — pas au niveau d'exécution de l'ordre. Deux mécanismes prouvés
// ledgers TV (VIN-137) :
//   1. le mark du latent : le moteur marquait la position ouverte au LEVEL
//      (stop 57.95 → equity 1 012 196,07 → qty 4362) ; TV la marque au close
//      affiché 56.44 (→ equity 1 018 378,01 → qty 4388, trade 1 de 2615) ;
//   2. le dénominateur : TV divise par le niveau EFFECTIF arrondi de l'ordre
//      (1565 trade 0 : stop brut 21.62 → arrondi 21.61 ; floor(50 k/21.62)
//      = 2312, floor(50 k/21.61) = 2313 = la quantité TV).
// Le test 2615 discrimine aussi close brut (56.4375 → 4389) vs close affiché
// (56.44 → 4388) : la quantité 4388 ne passe QUE par la marque affichée.

function strategyOf(context: Context): StrategyState {
    if (!context.strategy) throw new Error('strategy state was not initialized');
    return context.strategy;
}

function makeStockContext(config: Record<string, unknown> = {}) {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'NYSE:HD',
        timeframe: '240',
    });
    context.idx = 0;
    context.data.open = new Series([1]);
    context.data.high = new Series([1]);
    context.data.low = new Series([1]);
    context.data.close = new Series([1]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick: 0.01, pointvalue: 1, type: 'stock', prefix: 'NYSE' };
    // Integer-share stocks resolve qtyStep 1 (fractional=false) — the same
    // step the engine derives from symbol_resolved on the 2615/1565 targets.
    context.pine.qtyStep = 1;
    initializeStrategy(context, {
        default_qty_type: 'percent_of_equity',
        default_qty_value: 25,
        commission_type: 'percent',
        commission_value: 0.1,
        initial_capital: 1000000,
        ...config,
    });
    return context;
}

function setBar(context: Context, idx: number, open: number, high = open, low = open, close = open) {
    context.idx = idx;
    context.data.open = new Series([close, open]);
    context.data.high = new Series([close, high]);
    context.data.low = new Series([close, low]);
    context.data.close = new Series([close, close]);
    context.data.openTime = new Series([idx * 86_400_000, idx * 86_400_000]);
}

describe('open-profit-sizing-equity (2615 / 1565)', () => {
    it('2615 — sizes a stop reversal on the latent P&L marked at the DISPLAYED signal close, not at the stop level', () => {
        const context = makeStockContext();
        const strategy = strategyOf(context);

        // Trade 0 of 2615: market SHORT 4094 @ 60.99, entry commission
        // 4094 × 60.99 × 0.1 % = 249.69306 charged at fill.
        setBar(context, 0, 60.99, 60.99, 60.99, 60.99);
        entry(context)('PivRevSE', 'short');
        setBar(context, 1, 60.99, 61.5, 60.5, 61.0);
        expect(processStrategyOrders(context)).toBe(1);
        expect(strategy.position_size).toBe(-4094);
        expect(strategy.netprofit).toBeCloseTo(-249.69306, 9);

        // Signal bar closes at 56.4375 (displayed 56.44); the open SHORT is
        // still marked-to-market at that close. Reversal LONG stop at 57.95.
        setBar(context, 2, 57.0, 57.5, 56.0, 56.4375);
        markToMarket(context, 56.4375);
        entry(context)('PivRevLE', 'long', { stop: 57.95 });

        const pending = strategy.pending_orders[0];
        expect(pending).toBeDefined();
        expect(pending.stop).toBe(57.95);
        // TV 2615 trade 1: equity = 1e6 − 249.69306 + (60.99 − 56.44) × 4094
        //                    = 1 018 378,01 → floor ×0.25 / (57.95 × 1.001)
        //                    = 4388 (marque au LEVEL 57.95 → 4362 ; close
        //                    brut 56.4375 → 4389 — les deux faux).
        expect(pending._base_qty).toBe(4388);
        expect(pending.qty).toBe(4094 + 4388); // reversal total (close + open)
    });

    it('1565 — sizes a stop entry at the ROUNDED effective level, not the raw expression', () => {
        const context = makeStockContext({
            default_qty_value: 50,
            commission_value: 0,
            initial_capital: 100000,
        });
        const strategy = strategyOf(context);

        // Trade 0 of 1565: signal close 22.84, short stop raw 21.619 which
        // away-rounds (floor, below the reference) to the effective 21.61.
        // A raw 21.62 would snap as on-grid — use 21.619, off-grid by 1e-3.
        setBar(context, 0, 22.84, 23.0, 22.5, 22.84);
        entry(context)('short', 'short', { stop: 21.619 });

        const pending = strategy.pending_orders[0];
        expect(pending).toBeDefined();
        expect(pending.stop).toBe(21.61);
        // TV 1565 trade 0: floor(100 000 × 50 % / 21.61) = 2313 — the raw
        // level 21.62 would give floor(2312.67) = 2312.
        expect(pending.qty).toBe(2313);
    });
});