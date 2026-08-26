import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import {
    initializeStrategy,
    openTrade,
    processExitOrders,
} from '../../../src/namespaces/strategy/utils';
import { Order } from '../../../src/namespaces/strategy/types';

// VIN-132b — parcours broker séquentiel intra-barre : quand le haut et le bas
// de la bougie sont à DISTANCE ÉGALE de l'open (|H−O| == |O−L|), le chemin
// supposé part vers le LOW d'abord. Pour un LONG, le stop (sous l'open) est
// alors rencontré avant la limite (au-dessus) : les deux jambes d'un OCA
// clôturent au stop. Discriminateur TV mesuré : 1781 USDZAR barre 66
// (stop=14.2412, TP1=14.2452, TP2=14.2472, O=14.2432 H=14.2569 L=14.2295 —
// tout touché, TV clôture les DEUX legs au stop 14.2412 ; l'ancien tie→HIGH
// prenait les limites).
function makeContext() {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'FX:USDZAR',
        timeframe: '120',
    });
    context.pine.syminfo = { type: 'forex', mintick: 1e-5, pointvalue: 1 };
    context.pineVersion = 4;
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
    return context;
}

function setBar(context: Context, idx: number, open: number, high: number, low: number, close: number) {
    context.idx = idx;
    context.data.open = new Series([open]);
    context.data.high = new Series([high]);
    context.data.low = new Series([low]);
    context.data.close = new Series([close]);
    context.data.openTime = new Series([idx * 7_200_000]);
}

function bracketExit(context: Context, id: string, stop: number, limit: number, qty?: number) {
    exit(context)(id, '', qty === undefined ? { stop, limit } : { stop, limit, qty });
}

function exitOrders(context: Context): Order[] {
    return context.strategy!.pending_orders.filter((order) => order.category === 'exit');
}

describe('VIN-132b tie → LOW first (barre 66 USDZAR)', () => {
    it('long : |H−O| == |O−L| → les deux jambes clôturent au STOP (discriminateur TV)', () => {
        const context = makeContext();
        setBar(context, 66, 14.2432, 14.2569, 14.2295, 14.2501);
        // Entrée market au open de la barre 66 (segment −1), bracket posé à la
        // barre précédente (niveaux depuis la close de la jambe condition).
        openTrade(context, 'Buy', 1, 200, 14.2432, 66 * 7_200_000);
        const trade = context.strategy!.opentrades[0];
        trade._activation_entry_bar_index = 66;
        trade._activation_entry_path_segment = -1;
        trade._activation_entry_path_distance = 0;
        bracketExit(context, 'Exit1', 14.2412, 14.2452, 100);
        bracketExit(context, 'Exit2', 14.2412, 14.2472);
        expect(context.strategy!.opentrades[0].size).toBe(200);

        const fills = processExitOrders(context, 'intrabar');
        expect(fills).toBe(2);
        const closed = context.strategy!.closedtrades;
        expect(closed).toHaveLength(2);
        // Les deux legs ferment au STOP 14.2412, jamais aux limites.
        for (const tradeRow of closed) {
            expect(Math.abs(tradeRow.exit_price - 14.2412)).toBeLessThan(1e-9);
            expect(tradeRow.exit_price).not.toBeCloseTo(14.2452, 6);
            expect(tradeRow.exit_price).not.toBeCloseTo(14.2472, 6);
        }
        expect(context.strategy!.opentrades).toHaveLength(0);
    });

    it('long : H nettement plus proche de l\'open → TP conservés (pas de régression)', () => {
        const context = makeContext();
        // |H−O| = 0.0068 < |O−L| = 0.0137 → chemin haut d'abord → limites.
        setBar(context, 10, 14.2432, 14.25, 14.2295, 14.25);
        openTrade(context, 'Buy', 1, 200, 14.2432, 10 * 7_200_000);
        const trade = context.strategy!.opentrades[0];
        trade._activation_entry_bar_index = 10;
        trade._activation_entry_path_segment = -1;
        trade._activation_entry_path_distance = 0;
        bracketExit(context, 'Exit1', 14.2412, 14.2452, 100);
        bracketExit(context, 'Exit2', 14.2412, 14.2472);
        expect(processExitOrders(context, 'intrabar')).toBe(2);
        const closed = context.strategy!.closedtrades;
        // |H−O| = 0.0068 < |O−L| = 0.0137 → chemin haut d'abord → limites.
        expect(Math.abs(closed[0].exit_price - 14.2452)).toBeLessThan(1e-9);
        expect(Math.abs(closed[1].exit_price - 14.2472)).toBeLessThan(1e-9);
    });

    it('long : L nettement plus proche de l\'open → stops conservés (pas de régression)', () => {
        const context = makeContext();
        // |H−O| = 0.0137 > |O−L| = 0.0032 → chemin bas d'abord → stops.
        setBar(context, 11, 14.2432, 14.2569, 14.24, 14.25);
        openTrade(context, 'Buy', 1, 200, 14.2432, 11 * 7_200_000);
        const trade = context.strategy!.opentrades[0];
        trade._activation_entry_bar_index = 11;
        trade._activation_entry_path_segment = -1;
        trade._activation_entry_path_distance = 0;
        bracketExit(context, 'Exit1', 14.2412, 14.2452, 100);
        bracketExit(context, 'Exit2', 14.2412, 14.2472);
        expect(processExitOrders(context, 'intrabar')).toBe(2);
        const closed = context.strategy!.closedtrades;
        // |H−O| = 0.0137 > |O−L| = 0.0032 → chemin bas d'abord → stops.
        expect(Math.abs(closed[0].exit_price - 14.2412)).toBeLessThan(1e-9);
        expect(Math.abs(closed[1].exit_price - 14.2412)).toBeLessThan(1e-9);
    });

    it('short : |H−O| == |O−L| → les deux jambes clôturent à la LIMITE (règle LOW d\'abord, miroir)', () => {
        const context = makeContext();
        setBar(context, 70, 14.2432, 14.2569, 14.2295, 14.237);
        // Short : stop AU-DESSUS (14.2452), limites en-dessous (14.2412/14.2392).
        // Tie d'extrêmes exact → chemin [O, L, H] → la limite (bas) est
        // rencontrée avant le stop.
        openTrade(context, 'Sell', -1, 200, 14.2432, 70 * 7_200_000);
        const trade = context.strategy!.opentrades[0];
        trade._activation_entry_bar_index = 70;
        trade._activation_entry_path_segment = -1;
        trade._activation_entry_path_distance = 0;
        bracketExit(context, 'Exit3', 14.2452, 14.2412, 100);
        bracketExit(context, 'Exit4', 14.2452, 14.2392);
        expect(processExitOrders(context, 'intrabar')).toBe(2);
        const closed = context.strategy!.closedtrades;
        expect(Math.abs(closed[0].exit_price - 14.2412)).toBeLessThan(1e-9);
        expect(Math.abs(closed[1].exit_price - 14.2392)).toBeLessThan(1e-9);
        expect(exitOrders(context)).toHaveLength(0);
    });
});