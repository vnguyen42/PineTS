// Famille : ordre LIMIT de la barre courante DÉJÀ MARKETABLE au CLOSE sous
// process_orders_on_close (id révélateur 2640, BINANCE:UNIUSDT tf 60 — grille
// DCA pyramiding).
//
// Règle TV prouvée barre-à-barre sur le ledger canonique de 2640
// (oracle-archives/tv-vin95-b/2640/08-tv-ledger-canonical.json, 1141/1141
// remplissages d'ordres de sécurité reproduits par le simulateur de la règle,
// 921/1141 sans elle) :
//   - un ordre limit émis pendant l'évaluation de la barre B et dont la limite
//     est déjà franchie PAR LE CLOSE de B est rempli SUR B, au prix close(B) ;
//   - la condition d'armement est `close <= limit` (long) / `close >= limit`
//     (short) — PAS `low <= limit` : un niveau touché intrabar AVANT la pose ne
//     déclenche rien (l'ordre n'existait pas ; deal 17199 : low 5.066 pénètre
//     les 5 limites, TV remplit les 5 au close 5.082).
// Exemple canonique : deal sortie 2024-01-10T04:00Z, BO barre 217 close 6.086 ;
// barre 218 O=6.086 H=6.102 L=5.975 C=5.98 → close 5.98 sous SO1 6.061656,
// SO2 6.032687 et SO3 5.998213 → TV remplit les TROIS au close 5.98.
//
// Jumeau sortie : 2640 rappelle strategy.exit à CHAQUE barre, donc le bracket
// est en permanence « rafraîchi » ; il doit lui aussi être confronté au close
// de la barre où il a été (re)posé.
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Kline } from '../../../src/marketData/types';

function candle(openTime: number, open: number, high: number, low: number, close: number): Kline {
    return {
        openTime,
        open,
        high,
        low,
        close,
        volume: 1000,
        closeTime: openTime + 86_399_999,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

const DAY = 86_400_000;

async function runStrategy(candles: Kline[], source: string) {
    const context = await new PineTS(candles).run(source);
    const strategy = context.strategy;
    if (!strategy) throw new Error('strategy state was not initialized');
    return strategy;
}

describe('2640 — limit entry already marketable at the close it was placed on', () => {
    it('fills the current-bar limit entry ON that bar at its close', async () => {
        // barre 1 : la limite 96 est déjà franchie par le close 95 → fill sur
        // la barre 1 au close 95 (le moteur la reportait à la barre 2, au
        // niveau 96).
        const candles = [
            candle(0, 98, 101, 97, 100),
            candle(DAY, 100, 102, 94, 95),
            candle(2 * DAY, 99, 100, 90, 92),
        ];
        const strategy = await runStrategy(
            candles,
            `
//@version=5
strategy('2640 SO close-marketable', process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 1
    strategy.entry('SO', strategy.long, limit=96.0)`,
        );

        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_bar_index).toBe(1);
        expect(strategy.opentrades[0].entry_price).toBe(95);
    });

    it('keeps a limit entry NOT marketable at the close pending, then fills it at its level on the next bar', async () => {
        // close 99 au-dessus de la limite 96 et low 97 qui ne l'atteint pas :
        // rien ne peut se déclencher sur la barre de pose. Contrôle de
        // non-régression du chemin nominal.
        const candles = [
            candle(0, 98, 101, 97, 100),
            candle(DAY, 100, 102, 97, 99),
            candle(2 * DAY, 99, 100, 90, 92),
        ];
        const strategy = await runStrategy(
            candles,
            `
//@version=5
strategy('2640 SO non marketable', process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 1
    strategy.entry('SO', strategy.long, limit=96.0)`,
        );

        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_bar_index).toBe(2);
        expect(strategy.opentrades[0].entry_price).toBe(96);
    });

    it('does not trigger on a low that pierced the limit BEFORE the order was placed', async () => {
        // barre 1 : low 94 traverse la limite 96, mais le close 99 est
        // au-dessus → l'ordre n'existait pas au moment du low, aucun fill sur
        // la barre 1 (ni au close 99, ni au niveau 96). Il attend la barre 2 et
        // s'y remplit au niveau 96 (open 99 > 96).
        const candles = [
            candle(0, 98, 101, 97, 100),
            candle(DAY, 100, 102, 94, 99),
            candle(2 * DAY, 99, 100, 90, 92),
        ];
        const strategy = await runStrategy(
            candles,
            `
//@version=5
strategy('2640 low trap', process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 1
    strategy.entry('SO', strategy.long, limit=96.0)`,
        );

        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_bar_index).toBe(2);
        expect(strategy.opentrades[0].entry_price).toBe(96);
    });

    it('confronts an exit bracket REFRESHED on the current bar with that bar close (jumeau sortie)', async () => {
        // Le bracket est reposé à chaque barre. Barre 2 : la passe intrabar
        // évalue encore le TP 105 (high 104 → pas de touche), puis
        // l'évaluation le rafraîchit à 102 alors que le close 103 l'a déjà
        // franchi → TV sort sur la barre 2 au close 103. Le moteur ignorait
        // tout bracket rafraîchi en phase close et sortait barre 3 au niveau
        // 102.
        const candles = [
            candle(0, 98, 101, 97, 100),
            candle(DAY, 100, 102, 99, 101),
            candle(2 * DAY, 101, 104, 100, 103),
            candle(3 * DAY, 101, 106, 100, 104),
        ];
        const strategy = await runStrategy(
            candles,
            `
//@version=5
strategy('2640 exit twin', process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
tp = bar_index < 2 ? 105.0 : 102.0
if strategy.position_size > 0
    strategy.exit('X', 'L', limit=tp)`,
        );

        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].entry_price).toBe(100);
        expect(strategy.closedtrades[0].exit_bar_index).toBe(2);
        expect(strategy.closedtrades[0].exit_price).toBe(103);
    });
});
