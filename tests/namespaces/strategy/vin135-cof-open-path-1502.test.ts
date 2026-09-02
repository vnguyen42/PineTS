// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

interface V135TradeLike {
    entry_id: string;
    entry_time: number;
    exit_time: number;
    entry_price: number;
    exit_price: number;
}

interface V135StrategyLike {
    closedtrades: V135TradeLike[];
    opentrades: V135TradeLike[];
}

/**
 * VIN-135 — chemin intrabarre COF démarrant à l'open (oracle 1502).
 *
 * Preuve TV (oracle-archives/tv-captures-20260902/1502, ledger 451 lignes,
 * sha 45e19184) : sur 5 barres où 3 lots s'empilent dans la même bougie
 * après qu'un exit préexistant (close_all 'sl') a pris l'open, TV remplit
 * aux prix {open, low, high} alors que le moteur remplissait {low, high,
 * close}. Barre 9348 (2021-11-24T20:00Z) OHLC 4212/4282.19/4200.09/
 * 4269.36 : TV [4200.09, 4212, 4282.19] ; moteur [4200.09, 4269.36,
 * 4282.19] — décalage d'un cran, le close remplaçant l'open.
 *
 * Mécanique mesurée (sonde de la lane + traces) : le close_all prend
 * l'open ; la ré-exécution COF ré-évalue le signal d'entrée (condition
 * calculée sur close → vrai au prix de l'open) et ré-émet `strategy.entry`
 * depuis FLAT — TV la remplit au tick courant (l'open). Le moteur
 * différait cette entrée au premier extrême, décalant toute la pile.
 * Deux correctifs :
 *   1. `_cof_fresh_same_tick` : une entrée MARKET créée par la recalcul
 *      COF qui part de flat est drainée same-tick (comme les reversals
 *      VIN-110) — lot 1 à l'OPEN.
 *   2. Le CLOSE est le point TERMINAL du chemin : une entrée market
 *      same-barre encore pendante au dernier tick reste pendante (aucun
 *      fill au close) — l'ordre pending émis par l'évaluation de clôture
 *      (pas un remplacement same-ID) remplit à l'open de la barre suivante,
 *      comme TV (barre 9349 = 1 lot à l'open). La recalcul de la passe
 *      terminale s'exécute toujours ; seuls les ordres non marqués sont
 *      exclus du fill au point terminal. Les ordres marqués
 *      reversal/fresh (drain same-tick VIN-110/VIN-135) sont drainés même
 *      à la passe terminale (re-revue L1 2026-09-02, MEDIUM-1).
 *
 * Contrat observable (défendu ici) : sous COF, les lots empilés d'une
 * même barre se remplissent aux points {open, low, high} — jamais
 * {low, high, close} — et aucun ordre pending same-ID ne survit de la
 * passe terminale vers l'évaluation de clôture (pas de remplacement).
 *
 * Rouge prouvé sur le worktree du HEAD parent (3ee6649 + fix volet 1) pour
 * les sous-tests ①② (la mécanique VIN-135 elle-même) ; les sous-tests ③④⑤
 * verrouillent le drain same-tick VIN-107/VIN-110 préexistant (ils restent
 * verts sur le parent — le HIGH b2 avait été attrapé par la revue, pas par
 * un test) et la correction MEDIUM-1 de la re-revue (⑤, drain au pass
 * terminal). Ce test ne dépend pas de la marge.
 */

function candle(open: number, high: number, low: number, close: number, bar: number) {
    return {
        openTime: bar * 86_400_000, open, high, low, close, volume: 1000,
        closeTime: bar * 86_400_000 + 86_399_999,
    };
}

class FixedProvider {
    constructor(private readonly candles: any[]) {}
    configure() {}
    async getMarketData() {
        return this.candles;
    }
    async getSymbolInfo() {
        return {
            ticker: 'ETHUSDT', tickerid: 'TEST:ETHUSDT', main_tickerid: 'TEST:ETHUSDT',
            prefix: 'TEST', root: 'ETH', description: 'ETH / USDT', type: 'crypto',
            basecurrency: 'ETH', currency: 'USDT', timezone: 'Etc/UTC',
            mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1, mincontract: 0.00001,
            session: '24x7', volumetype: 'base',
        };
    }
}

// Barre 9348 rejouée : bar 0 ouvre le lot L ; bar 2 évalue le TSL et
// queue close_all ; bar 3 = la barre cible (OHLC 100/110/97/105, open plus
// proche du low → ticks [100, 97, 110, 105]) : close_all prend l'open 100,
// la recalcul ré-émet 'buy' depuis flat (drain same-tick à l'open), puis
// les lots suivants se remplissent au LOW 97 puis au HIGH 110. L'ordre
// pending émis par l'évaluation de clôture de la barre 3 (PUSH, pas un
// remplacement) remplit à l'open de la barre 4 (102) — jamais au close 105.
const CANDLES = [
    candle(98, 99, 97, 99, 0),     // bar 0 : entrée L
    candle(100, 101, 99, 100, 1),  // bar 1 : L remplit à l'open 100
    candle(99, 101, 98, 100, 2),   // bar 2 : évaluation TSL → close_all pendu
    candle(100, 110, 97, 105, 3),  // bar 3 : cible — {open, low, high}
    candle(102, 103, 101, 102, 4), // bar 4 : le 4e ordre remplit à l'open
];

const SOURCE = `
//@version=5
strategy('VIN135 COF open path', calc_on_order_fills=true, pyramiding=10, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
if bar_index == 2
    strategy.close_all('sl')
if bar_index >= 3
    strategy.entry('buy', strategy.long)`;

// ③/④ — drain same-tick VIN-107/VIN-110/VIN-135 : un fill au 3e point du
// chemin (pass 2, index `ticks.length - 2`, le high 110 de la bougie
// [100, 97, 110, 105]) doit déclencher le drain des ordres émis par la
// recalcul DANS LA MÊME BARRE. La re-revue L1 a prouvé qu'un garde
// `pass < ticks.length - 2` (b2, reverté) repoussait la sortie à la barre
// suivante au mauvais prix — ce scénario le verrouille (VIN-107 : sortie
// 110 même barre ; VIN-110 : reversal 110 même barre).
const CANDLES_DRAIN = [
    candle(98, 99, 97, 99, 0),
    candle(100, 101, 99, 100, 1),
    candle(101, 102, 100, 101, 2),
    candle(100, 110, 97, 105, 3), // barre 3 : ticks [100, 97, 110, 105]
    candle(102, 103, 101, 102, 4),
];

const SOURCE_DRAIN_EXIT = `
//@version=5
strategy('VIN135 COF drain exit', calc_on_order_fills=true, pyramiding=0, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 2
    strategy.entry('L', strategy.long, stop=108)
if bar_index == 3 and strategy.position_size > 0
    strategy.close_all('x')
if bar_index > 3
    strategy.close_all('y')`;

const SOURCE_DRAIN_REVERSAL = `
//@version=5
strategy('VIN135 COF drain reversal', calc_on_order_fills=true, pyramiding=0, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 2
    strategy.entry('L', strategy.long, stop=108)
if bar_index == 3 and strategy.position_size > 0
    strategy.entry('S', strategy.short)
if bar_index > 3
    strategy.close_all('y')`;

// ⑤ — drain au POINT TERMINAL (pass 3, le close 105 de [100, 97, 110,
// 105]) : la garde b1 (close = point terminal) ne doit PAS s'appliquer aux
// ordres marqués same-tick. Scénario fourni par la re-revue (MEDIUM-1) :
// stop long 108 rempli au pass 2 → la recalcul pose un stop short 107 →
// rempli au pass 3 → l'entrée 'R' (reversal) émise par la recalcul suivante
// doit être drainée À 105 sur la barre 3 (pas reportée à l'open 102 de la
// barre 4). Contrôle négatif : un add même sens NON marqué ('A') garde le
// point suivant (102, barre 4).
const SOURCE_DRAIN_TERMINAL = `
//@version=5
strategy('VIN135 COF drain terminal', calc_on_order_fills=true, pyramiding=10, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 2
    strategy.entry('L', strategy.long, stop=108)
if bar_index == 3 and strategy.position_size > 0
    strategy.entry('S', strategy.short, stop=107)
if bar_index == 3 and strategy.position_size < 0
    strategy.entry('R', strategy.long)
if bar_index > 3
    strategy.close_all('y')`;

const SOURCE_ADD_NON_MARQUE = `
//@version=5
strategy('VIN135 COF add non marque', calc_on_order_fills=true, pyramiding=10, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 2
    strategy.entry('L', strategy.long, stop=108)
if bar_index == 3 and strategy.position_size > 0
    strategy.entry('S', strategy.short, stop=107)
if bar_index == 3 and strategy.position_size < 0
    strategy.entry('A', strategy.short)
if bar_index > 3
    strategy.close_all('y')`;

describe('strategy calc_on_order_fills — chemin intrabarre démarrant à l\'open (VIN-135, oracle 1502)', () => {
    it('① empile 3 lots à la barre avec les prix {open, low, high} — jamais {low, high, close}', async () => {
        const engine = new PineTS(new FixedProvider(CANDLES) as any, 'ETHUSDT', 'D');
        const context = await engine.run(SOURCE);
        const strategy = context.strategy as any;

        // Le close_all évalué à la barre 2 pendait déjà AVANT la barre 3 :
        // il prend l'open 100 et ferme L (round-trip 100/100).
        const closed = strategy.closedtrades.filter((t: any) => t.entry_id === 'L');
        expect(closed).toHaveLength(1);
        expect(closed[0].entry_price).toBe(100);
        expect(closed[0].exit_price).toBe(100);

        // Trois lots 'buy' entrés sur la barre 3, aux prix {open, low, high}.
        const stacked = strategy.opentrades.filter((t: any) => t.entry_time === 3 * 86_400_000);
        expect(stacked).toHaveLength(3);
        const prices = stacked.map((t: any) => t.entry_price).sort((a: number, b: number) => a - b);
        expect(prices).toEqual([97, 100, 110]);
        // JAMAIS le close 105 à la place de l'open (ancien moteur : {97, 110, 105}).
        expect(prices).not.toContain(105);
    });

    it('② aucun ordre pending same-ID ne survit de la passe terminale — le 4e ordre remplit à l\'open suivant, pas au close', async () => {
        const engine = new PineTS(new FixedProvider(CANDLES) as any, 'ETHUSDT', 'D');
        const context = await engine.run(SOURCE);
        const strategy = context.strategy as any;

        // Barre 3 : exactement 3 lots (pas un 4e au close 105).
        expect(strategy.opentrades.filter((t: any) => t.entry_time === 3 * 86_400_000)).toHaveLength(3);

        // Le pending émis par l'évaluation de clôture de la barre 3 remplit
        // à l'open de la barre 4 (102) — jamais au close 105 de la barre 3
        // (TV barre 9349 : le 4e ordre apparaît à l'open suivant).
        const nextBar = strategy.opentrades.filter((t: any) => t.entry_time === 4 * 86_400_000);
        expect(nextBar.length).toBeGreaterThan(0);
        expect(nextBar[0].entry_price).toBe(102);

        // Position finale : L fermé + 3 lots barre 3 + 3 lots barre 4
        // (le signal persiste — même mécanique de la barre 9349 de 1502).
        expect(strategy.opentrades.length).toBe(6);
        expect(strategy.closedtrades.length).toBe(1);
    });

    it('③ drain VIN-107 : un close_all émis par la recalcul après un fill au 3e point du chemin se remplit DANS LA MÊME BARRE (110, pas 102 à la suivante)', async () => {
        const engine = new PineTS(new FixedProvider(CANDLES_DRAIN) as unknown as ConstructorParameters<typeof PineTS>[0], 'ETHUSDT', 'D');
        const context = await engine.run(SOURCE_DRAIN_EXIT);
        const strategy = context.strategy as unknown as V135StrategyLike;

        // L'entrée stop 108 est posée à la barre 2 (un ordre créé à la barre
        // courante n'est pas évalué contre le chemin intrabar — limite
        // VIN-72 documentée) et croise à la barre 3 au pass 2 (le high 110).
        // La recalcul ré-exécute le script : position > 0 → close_all('x')
        // émis DANS la recalcul → drain same-tick VIN-107 : la sortie se
        // fait à 110 SUR LA MÊME BARRE.
        const closed = strategy.closedtrades.filter((t) => t.entry_id === 'L');
        expect(closed).toHaveLength(1);
        expect(closed[0].exit_time).toBe(3 * 86_400_000);
        expect(closed[0].exit_price).toBe(110);
    });

    it('④ drain VIN-110/135 : une entrée reversal émise par la recalcul après un fill au 3e point du chemin est drainée same-tick (110, même barre)', async () => {
        const engine = new PineTS(new FixedProvider(CANDLES_DRAIN) as unknown as ConstructorParameters<typeof PineTS>[0], 'ETHUSDT', 'D');
        const context = await engine.run(SOURCE_DRAIN_REVERSAL);
        const strategy = context.strategy as unknown as V135StrategyLike;

        // Le stop long remplit au pass 2 (110) ; la recalcul émet
        // strategy.entry('S', short) contre la position longue → marqué
        // _cof_reversal_same_tick → drainé au prix du tick courant (110),
        // même barre : clôture du long + ouverture du short À 110.
        const closed = strategy.closedtrades.filter((t) => t.entry_id === 'L');
        expect(closed).toHaveLength(1);
        expect(closed[0].exit_time).toBe(3 * 86_400_000);
        expect(closed[0].exit_price).toBe(110);

        const opened = strategy.opentrades.filter((t) => t.entry_time === 3 * 86_400_000);
        expect(opened).toHaveLength(1);
        expect(opened[0].entry_price).toBe(110);
        expect(opened[0].entry_id).toBe('S');
    });

    it('⑤ drain au POINT TERMINAL : un reversal marqué émis après un fill au dernier point (pass 3) est drainé au tick terminal (105)', async () => {
        const engine = new PineTS(new FixedProvider(CANDLES_DRAIN) as unknown as ConstructorParameters<typeof PineTS>[0], 'ETHUSDT', 'D');
        const context = await engine.run(SOURCE_DRAIN_TERMINAL);
        const strategy = context.strategy as unknown as V135StrategyLike;

        // Le stop long 108 remplit au pass 2 ; la recalcul pose le stop short
        // 107 qui referme L au niveau 107 (fill de stop pur), puis le stop
        // short se remplit au pass 3 (105) ; la recalcul suivante émet 'R'
        // (reversal, marqué) → drainé au tick terminal 105, MÊME barre.
        const closedL = strategy.closedtrades.filter((t) => t.entry_id === 'L');
        expect(closedL).toHaveLength(1);
        expect(closedL[0].exit_price).toBe(107);
        const closedS = strategy.closedtrades.filter((t) => t.entry_id === 'S' && t.exit_time === 3 * 86_400_000);
        expect(closedS).toHaveLength(1);
        expect(closedS[0].exit_price).toBe(105);
        // 'R' entre à 105 barre 3 ; le close_all persistant la referme à la
        // barre 4 — l'observable de la barre 3 est la clôture de R à 105.
        const closedR = strategy.closedtrades.filter((t) => t.entry_id === 'R');
        expect(closedR).toHaveLength(1);
        expect(closedR[0].entry_time).toBe(3 * 86_400_000);
        expect(closedR[0].entry_price).toBe(105);
    });

    it('⑥ contrôle négatif : un add même sens NON marqué émis au même point terminal reste au point suivant (102)', async () => {
        const engine = new PineTS(new FixedProvider(CANDLES_DRAIN) as unknown as ConstructorParameters<typeof PineTS>[0], 'ETHUSDT', 'D');
        const context = await engine.run(SOURCE_ADD_NON_MARQUE);
        const strategy = context.strategy as unknown as V135StrategyLike;

        // 'A' (add même sens short, non marqué) ne se remplit PAS au point
        // terminal : il entre à l'open de la barre 4 (102), puis le close_all
        // persistant le referme — observable = sa clôture à 102 barre 4.
        const closedA = strategy.closedtrades.filter((t) => t.entry_id === 'A');
        expect(closedA).toHaveLength(1);
        expect(closedA[0].entry_time).toBe(4 * 86_400_000);
        expect(closedA[0].entry_price).toBe(102);
    });
});
