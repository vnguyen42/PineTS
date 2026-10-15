import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import type { Trade } from '../../../src/namespaces/strategy/types';
import { initializeStrategy, processExitOrders } from '../../../src/namespaces/strategy/utils';
import { exit } from '../../../src/namespaces/strategy/methods/exit';

// Famille : EXIT_SUBSTEP_QTY_UNCAPPED — script révélateur 2565 (MCX:NATURALGAS1! 60,
// contrats entiers). Forme du script : strategy.exit("Buy TP", qty = taille_initiale × 0.5,
// limit = TP) puis strategy.exit("Buy Stop", stop = SL) sur une position de 1 contrat.
// La quantité 0.5 tombe à 0 au pas entier. TV ne la traite pas comme un ordre inerte : sur
// 303 trades, les 182 sorties de bracket sont toutes « Buy TP »/« Sell TP » pour le contrat
// entier, et le stop frère ne se remplit jamais (une perte de 3,9 % passe sans stop à 2 %).
// Le moteur parent gardait le TP inerte et laissait tout le contrat au stop (32/303 → 303/303).
function makeContext(): Context {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'NATURALGAS1!',
        timeframe: '60',
    });
    context.pine = { syminfo: { mintick: 0.1, pointvalue: 1250 }, qtyStep: 1 };
    initializeStrategy(context, { pyramiding: 1 });
    context.idx = 4;
    context.data.open = new Series([660.0]);
    context.data.high = new Series([667.0]);
    context.data.low = new Series([649.6]);
    context.data.close = new Series([652.4]);
    context.data.openTime = new Series([4000]);
    const trade: Trade = {
        id: 'trade_1',
        entry_id: 'Buy',
        entry_comment: 'Buy',
        entry_price: 666,
        _bracket_entry: 666,
        entry_bar_index: 0,
        entry_time: 0,
        size: 1,
        commission: 0,
        max_drawdown: 0,
        max_runup: 0,
        status: 'open',
    };
    const strategy = context.strategy!;
    strategy.opentrades = [trade];
    strategy.position_size = 1;
    strategy.position_avg_price = 666;
    strategy.position_entry_name = 'Buy';
    return context;
}

describe('explicit exit qty that floors to zero at the qty step (2565)', () => {
    it('reserves the whole position, so the uncapped sibling stop has nothing left', () => {
        const context = makeContext();
        const strategy = context.strategy!;

        exit(context)('Buy TP', undefined, { qty: 0.5, limit: 679.3 });
        exit(context)('Buy Stop', undefined, { stop: 652.7 });

        expect(strategy.pending_orders[0]).toMatchObject({ id: 'Buy TP', _explicit_qty_cap: false });
        // The low crosses the stop, the high stays below the TP: nothing fills.
        expect(processExitOrders(context)).toBe(0);
        expect(strategy.closedtrades).toHaveLength(0);
        expect(strategy.position_size).toBe(1);
    });

    it('fills the whole position at the limit of the sub-step leg', () => {
        const context = makeContext();
        const strategy = context.strategy!;
        context.data.high = new Series([680.0]);
        context.data.low = new Series([659.0]);
        context.data.close = new Series([679.0]);

        exit(context)('Buy TP', undefined, { qty: 0.5, limit: 679.3 });
        exit(context)('Buy Stop', undefined, { stop: 652.7 });

        expect(processExitOrders(context)).toBe(1);
        expect(strategy.closedtrades.map((t) => [t.exit_id, t.size])).toEqual([['Buy TP', 1]]);
        expect(strategy.closedtrades[0].exit_price).toBeCloseTo(679.3, 9);
        expect(strategy.position_size).toBe(0);
    });
});
