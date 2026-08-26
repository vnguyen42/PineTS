import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import {
    initializeStrategy,
    processStrategyOrders,
    processExitOrders,
} from '../../../src/namespaces/strategy/utils';
import { Order } from '../../../src/namespaces/strategy/types';

// VIN-120 — drain COF same-tick du bracket strategy.exit NOUVEAU, pas du
// bracket rafraîchi. Discriminateur TV mesuré (2205, 10 cibles) : une entrée
// market COF remplit à l'open ; la recalcul qui suit crée un bracket dont la
// jambe est DÉJÀ marketable au prix du fill (TP sous l'open / SL au-dessus
// pour un long). TV remplit ce bracket au même tick — open→open, zéro PnL.
// Le moteur (avant fix) supprimait la jambe ephemeral wrong-sided puis
// avançait le chemin : sorties retardées. Le fix marque uniquement la NOUVELLE
// instance (jamais un bracket rafraîchi, jamais une pile pyramidée) avec le
// pass COF courant ; le drain same-tick l'admet, garde sa jambe wrong-sided
// (précisément marketable, pas stale) et remplit au cofTickPrice si le niveau
// est déjà franchi. Un pass suivant invalide le marqueur (next-path). Preuves
// moteur : 2205 519→520 (10 round-trips zéro-PnL récupérés en temps et prix) ;
// 1502 byte-identique — les brackets inconditionnels préexistants (pyramiding)
// ne sont jamais marqués ni réémis.
function makeContext(config: Record<string, unknown> = {}) {
    const context: any = new Context({
        marketData: [],
        source: [],
        tickerId: 'BTCUSDT',
        timeframe: 'D',
    } as any);
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } } as any;
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, ...config });
    return context;
}

/** Bar 1 : open 100, high 110, low 95, close 105 → ticks assumés [100, 95, 110, 105]. */
function setBar1Cof(context: any) {
    context.idx = 1;
    context.data.open = new Series([100, 100]);
    context.data.high = new Series([101, 110]);
    context.data.low = new Series([99, 95]);
    context.data.close = new Series([100, 105]);
    context.data.openTime = new Series([0, 86_400_000]);
    context.strategy._cof = { pass: 0, ticks: [100, 95, 110, 105] };
}

function exitOrders(context: Context): Order[] {
    return context.strategy!.pending_orders.filter((order) => order.category === 'exit');
}

describe('VIN-120 drain COF same-tick du bracket exit nouvellement créé', () => {
    it('1. fresh single trade à l\'open, bracket TP marketable soumis au re-run → open→open zéro PnL', () => {
        const context = makeContext({ calc_on_order_fills: true });
        // L'entrée est soumise à la barre 0 ; elle remplit à l'open de la barre 1.
        entry(context)('L', 'long');
        setBar1Cof(context);

        // Pass 0 : l'entrée market remplit à l'open 100 — trade frais, seul,
        // entré au tick courant (segment -1).
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.opentrades.length).toBe(1);

        // La recalcul au prix du fill soumet le bracket : TP 99 sous l'open
        // pour un long entré à 100 → jambe wrong-sided MAIS marketable au
        // tick courant (100 ≥ 99). Le drain same-tick doit la remplir à 100.
        exit(context)('X', 'L', { limit: 99 });
        expect(exitOrders(context)[0]._cof_fresh_single_trade_exit_pass).toBe(0);

        const fills = processExitOrders(context, 'intrabar', true);
        expect(fills).toBe(1);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.opentrades.length).toBe(0);
        expect(context.strategy.closedtrades.length).toBe(1);
        const trade = context.strategy.closedtrades[0];
        expect(trade.entry_price).toBe(100);  // entrée à l'open
        expect(trade.exit_price).toBe(100);   // sortie au même open (cofTickPrice)
        expect(trade.entry_time).toBe(86_400_000);
        expect(trade.exit_time).toBe(86_400_000);
        expect(trade.profit).toBe(0);
    });

    it('1b. miroir SL : fresh single trade à l\'open, stop marketable soumis au re-run → open→open zéro PnL', () => {
        const context = makeContext({ calc_on_order_fills: true });
        entry(context)('L', 'long');
        setBar1Cof(context);
        expect(processStrategyOrders(context)).toBe(1);

        // SL 105 au-dessus de l'open 100 : wrong-sided pour un long mais
        // marketable (prix déjà sous le stop → sell-stop déclenché au tick).
        exit(context)('XS', 'L', { stop: 105 });
        expect(exitOrders(context)[0]._cof_fresh_single_trade_exit_pass).toBe(0);

        const fills = processExitOrders(context, 'intrabar', true);
        expect(fills).toBe(1);
        expect(context.strategy.position_size).toBe(0);
        const trade = context.strategy.closedtrades[0];
        expect(trade.entry_price).toBe(100);
        expect(trade.exit_price).toBe(100);
        expect(trade.exit_time).toBe(trade.entry_time);
        expect(trade.profit).toBe(0);
    });

    it('2. bracket inconditionnel déjà pending (refreshé au fill) → next-path conservé, jamais marqué', () => {
        const context = makeContext({ calc_on_order_fills: true });
        // Le script appelle exit() chaque bar : à la barre 0 (à plat) le
        // bracket est déjà créé et rattaché aux entrées pendantes.
        entry(context)('L', 'long');
        exit(context)('X', 'L', { limit: 102 });
        expect(exitOrders(context)).toHaveLength(1);

        setBar1Cof(context);
        expect(processStrategyOrders(context)).toBe(1);

        // La recalcul réémet exit() → refresh in-place (même id/from_entry
        // pending) : jamais une nouvelle instance, donc jamais marquée. Le
        // bracket n'est PAS marketable au tick : drain silencieux au pass 0.
        exit(context)('X', 'L', { limit: 102 });
        expect(exitOrders(context)[0]._exit_refreshed).toBe(true);
        expect(exitOrders(context)[0]._cof_fresh_single_trade_exit_pass).toBeUndefined();
        expect(processExitOrders(context, 'intrabar', true)).toBe(0);
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.closedtrades.length).toBe(0);

        // Next-path : le croisement se produit au pass 2 (tick 110 ≥ 102),
        // pas au tick d'entrée. Le bracket remplit à son niveau normal.
        context.strategy._cof.pass = 2;
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.closedtrades[0].exit_price).toBe(102);
    });

    it('3. pyramiding : aucun drain fantôme au tick, le bracket refreshé reste next-path (ledger byte-identique)', () => {
        const context = makeContext({ calc_on_order_fills: true, pyramiding: 2 });
        // Deux entrées pendantes + bracket wildcard inconditionnel (le motif
        // 1502 : pyra=10, exit() appelé chaque bar). Les deux entrées
        // remplissent au même open → pile pyramidée de 2 lots. Stop 98 :
        // valide pour un long (sous l'entrée), croisé au tick 95 (pass 1).
        entry(context)('L1', 'long');
        entry(context)('L2', 'long');
        exit(context)('X', '', { stop: 98 });
        setBar1Cof(context);
        expect(processStrategyOrders(context)).toBe(2);
        expect(context.strategy.opentrades.length).toBe(2);

        const ledgerBefore = JSON.stringify(context.strategy.closedtrades.map((t: any) => ({
            entryTime: t.entry_time, exitTime: t.exit_time, entryBar: t.entry_bar_index, exitBar: t.exit_bar_index,
            size: t.size, entryPrice: t.entry_price, exitPrice: t.exit_price, profit: t.profit, commission: t.commission,
        })));

        // Recalcul : exit() réémis → refresh. Bracket préexistant + pile
        // pyramidée → jamais marqué, jamais drainé au tick (et s'il l'était,
        // le pas en avant serait un round-trip fantôme).
        exit(context)('X', '', { stop: 98 });
        expect(exitOrders(context)[0]._exit_refreshed).toBe(true);
        expect(exitOrders(context)[0]._cof_fresh_single_trade_exit_pass).toBeUndefined();
        expect(processExitOrders(context, 'intrabar', true)).toBe(0);

        // Ledger byte-identique : aucun round-trip fantôme n'a été créé.
        const ledgerAfter = JSON.stringify(context.strategy.closedtrades.map((t: any) => ({
            entryTime: t.entry_time, exitTime: t.exit_time, entryBar: t.entry_bar_index, exitBar: t.exit_bar_index,
            size: t.size, entryPrice: t.entry_price, exitPrice: t.exit_price, profit: t.profit, commission: t.commission,
        })));
        expect(ledgerAfter).toBe(ledgerBefore);
        expect(ledgerAfter).toBe('[]');
        expect(context.strategy.position_size).toBe(2);

        // Next-path : le stop croise au pass 1 (tick 95) et clôture la pile via
// les brackets per-trade (un événement par lot — aucune réémission d'un
// round-trip entier au tick du drain).
        context.strategy._cof.pass = 1;
        expect(processExitOrders(context, 'intrabar')).toBe(2);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.closedtrades.length).toBe(2);
        const totalSize = context.strategy.closedtrades.reduce((sum: number, t: any) => sum + Math.abs(t.size), 0);
        expect(totalSize).toBe(2);
        for (const trade of context.strategy.closedtrades) {
            expect(trade.exit_price).toBe(98);
        }
    });

    it('4. bracket neuf NON marketable → reste pending et le marqueur n\'est pas réutilisé au pass suivant', () => {
        const context = makeContext({ calc_on_order_fills: true });
        entry(context)('L', 'long');
        setBar1Cof(context);
        expect(processStrategyOrders(context)).toBe(1);

        // Bracket neuf (re-run) avec TP 110 : marketable seulement au tick 110
        // (pass 2) — pas au tick d'entrée 100.
        exit(context)('X', 'L', { limit: 110 });
        expect(exitOrders(context)[0]._cof_fresh_single_trade_exit_pass).toBe(0);

        // Pass marqué, non marketable → pas de drain, l'ordre reste pending.
        expect(processExitOrders(context, 'intrabar', true)).toBe(0);
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.closedtrades.length).toBe(0);
        expect(exitOrders(context).length).toBe(1);

        // Pass 1 (tick 95) : toujours non marketable → rien.
        context.strategy._cof.pass = 1;
        expect(processExitOrders(context, 'intrabar', true)).toBe(0);

        // Pass 2 (tick 110) : le niveau est DEVENU marketable, mais le drain
        // same-tick ne réutilise pas le marqueur du pass 0 — c'est le chemin
        // OHLC normal (next-path) qui remplit au niveau.
        context.strategy._cof.pass = 2;
        expect(processExitOrders(context, 'intrabar', true)).toBe(0);
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.closedtrades[0].exit_price).toBe(110);
    });

    it('5. sonde reviewer : bracket marqué barre 1 (TP 120 jamais marketable) refreshé barre 2 à pass coïncident après un reversal short fill → jamais drainé same-tick, chemin OHLC suivant conservé', () => {
        const context = makeContext({ calc_on_order_fills: true });
        // Barre 1 : long frais à l'open 100 ; la recalcul crée le bracket
        // wildcard TP 120 (marqué pass 0). Jamais marketable sur la barre
        // (high 110 < 120) → reste pending, marqueur posé.
        entry(context)('L', 'long');
        setBar1Cof(context);
        expect(processStrategyOrders(context)).toBe(1);
        exit(context)('X', '', { limit: 120 });
        expect(exitOrders(context)[0]._cof_fresh_single_trade_exit_pass).toBe(0);
        expect(processExitOrders(context, 'intrabar', true)).toBe(0);
        for (const pass of [1, 2, 3]) {
            context.strategy._cof.pass = pass;
            expect(processExitOrders(context, 'intrabar')).toBe(0);
        }
        expect(exitOrders(context).length).toBe(1);
        expect(context.strategy.position_size).toBe(1);

        // Barre 2 : gap down (open 119, plus proche du high 122 → ticks
        // [119, 122, 110, 121]). Le court market pendu remplit à l'open —
        // reversal : clôture le long, ouvre le short 1 lot à 119.
        entry(context)('S', 'short');
        context.idx = 2;
        context.data.open = new Series([100, 100, 119]);
        context.data.high = new Series([101, 110, 122]);
        context.data.low = new Series([99, 95, 110]);
        context.data.close = new Series([100, 105, 121]);
        context.data.openTime = new Series([0, 86_400_000, 172_800_000]);
        context.strategy._cof = { pass: 0, ticks: [119, 122, 110, 121] };
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.position_size).toBe(-1);
        expect(context.strategy.opentrades.length).toBe(1);

        // La recalcul qui suit le fill réémet exit() → refresh in-place du
        // bracket (même id/from_entry pending). Le marqueur pass 0 de la
        // barre 1 COÏNCIDE avec le pass 0 de la barre 2 : sans le delete du
        // chemin refresh, le bracket rafraîchi est drainé same-tick (le buy-
        // limit 120 est marketable au tick courant 119 ≤ 120 → fill au
        // cofTickPrice, position fermée au prix d'entrée). Fix : marqueur
        // supprimé → 0 fill, bracket pending, position intacte.
        exit(context)('X', '', { limit: 120 });
        const refreshed = exitOrders(context)[0];
        expect(refreshed._exit_refreshed).toBe(true);
        expect(refreshed._cof_fresh_single_trade_exit_pass).toBeUndefined();
        expect(processExitOrders(context, 'intrabar', true)).toBe(0);
        expect(context.strategy.position_size).toBe(-1);
        expect(context.strategy.closedtrades.length).toBe(1);

        // Chemin OHLC suivant : le buy-limit 120 croise au tick 110 (pass 2,
        // précédent 122 > 120) → le bracket remplit à SON niveau 120, pas au
        // tick du drain.
        context.strategy._cof.pass = 2;
        expect(processExitOrders(context, 'intrabar')).toBe(1);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.closedtrades).toHaveLength(2);
        expect(context.strategy.closedtrades[1].exit_price).toBe(120);
    });
});