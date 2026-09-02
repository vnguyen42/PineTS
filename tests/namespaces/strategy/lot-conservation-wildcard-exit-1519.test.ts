// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

/**
 * Famille : conservation des lots physiques sous exit wildcard — 1519
 * (FX:EURGBP, oracle-archives/rescore-20260901-reentry). TV booke un ajout
 * pyramiding CASH (process_orders_on_close, default_qty_type=cash, qty
 * dérivée de 10000/close) qui dépasse le plus ancien lot ouvert comme DEUX
 * lignes FERMÉES au même entryTime/prix : [E, qty − E] où E = excès du
 * run, chaque groupe fermé au même exitTime/exitPrice (83/83 groupes
 * capturés, ex. b164 → 149 + 11664).
 *
 * Règle TV (prouvée sur les 83 groupes, dont 2 runs multi-ajouts
 * b3641+b3650 et b5375+b5380) : dans un RUN de pyramiding cash, CHAQUE
 * ajout ferme en [E, qty_i − E] avec E = qty du DERNIER ajout du run −
 * taille du lot fondateur (le plus ancien lot ouvert au début du run) ;
 * le lot fondateur ferme entier. Le découpage est un artefact de booking à
 * la FERMETURE : pendant qu'il est ouvert, TV montre UNE ligne logique par
 * entrée — strategy.opentrades compte les signaux (1 par entrée).
 *
 * Le moteur pré-fix fusionnait chaque fill en une ligne qty (83 lignes TV
 * manquantes, structurel 1555/1638). Le fix diffère le découpage à la
 * fermeture et ré-applique l'excès du run à chaque ajout encore ouvert.
 * Montants conservés (Σ lignes == qty ordonnée, Σ opentrades.size(i) ==
 * position_size), commission de sortie facturée UNE fois par ordre puis
 * répartie pro-rata entre les deux lignes.
 *
 * Motif construit :
 *   barre 0 : entrée 1 (cash 10000/100 = 100)  → lot fondateur
 *   barre 1 : entrée 2 (cash 10000/50 = 200)
 *   barre 2 : entrée 3 (cash 10000/40 = 250)   → dernier ajout, E = 150
 *   barre 3 : strategy.exit('Close', limit=close) sauvage ferme tout au close
 * Rouge sur le parent (a5a3e4b) ; vert sur le fix.
 */

const mintick = 0.01;

class CashPyramidProvider {
    constructor(private readonly candles: any[]) {}
    configure() {}
    async getMarketData() {
        return this.candles;
    }
    async getSymbolInfo() {
        return {
            ticker: 'EURGBP', tickerid: 'TEST:EURGBP', main_tickerid: 'TEST:EURGBP',
            prefix: 'TEST', root: 'EURGBP', description: 'EUR / GBP', type: 'forex',
            basecurrency: 'EUR', currency: 'GBP', timezone: 'Etc/UTC',
            mintick, pricescale: 100, minmove: 1, pointvalue: 1, mincontract: 0.00001,
            session: '24x7', volumetype: 'base',
        };
    }
}

function candle(open: number, high: number, low: number, close: number, bar: number) {
    return {
        openTime: bar * 86_400_000, open, high, low, close, volume: 1000,
        closeTime: bar * 86_400_000 + 86_399_999,
    };
}

const CANDLES = [
    candle(100, 101, 99, 100, 0),    // entrée 1 (cash 10000/100 = 100) — fondateur
    candle(55, 56, 49, 50, 1),       // entrée 2 (cash 10000/50 = 200)
    candle(45, 46, 39, 40, 2),       // entrée 3 (cash 10000/40 = 250) — dernier, E = 150
    candle(62, 65, 61, 65, 3),       // strategy.exit('Close', limit=65) → close phase
];

const SOURCE = `
//@version=5
strategy('1519 lot conservation shape', pyramiding=3, process_orders_on_close=true,
     default_qty_type=strategy.cash, default_qty_value=10000)
if bar_index >= 0 and bar_index <= 2
    strategy.entry('Buy' + str.tostring(bar_index + 1), strategy.long,
         comment = '#' + str.tostring(bar_index + 1))
if bar_index == 3
    strategy.exit('Close', limit = close)`;

const SOURCE_WITHOUT_EXIT = SOURCE.replace(
    "if bar_index == 3\n    strategy.exit('Close', limit = close)",
    '',
);

// Même shape mais sizing FIXE (qty=200) : le split n'est prouvé TV que pour
// le sizing CASH par défaut. Avec fixed, TOUTES les entrées valent 200.
const SOURCE_FIXED = SOURCE.replace(
    "     default_qty_type=strategy.cash, default_qty_value=10000)",
    "     default_qty_type=strategy.fixed, default_qty_value=200)",
);

// Troisième ajout ne dépassant PAS l'ancre : 10000/125 = 80 ≤ 100 → PAS de split.
const CANDLES_NO_EXCESS = [
    candle(100, 101, 99, 100, 0),     // entrée 1 : 100 (fondateur)
    candle(55, 56, 49, 50, 1),        // entrée 2 : 200 → E = 200 − 100 = 100
    candle(130, 131, 124, 125, 2),    // entrée 3 : 10000/125 = 80 ≤ 100 → ligne unique
    candle(132, 135, 131, 135, 3),    // exit au close
];

const SOURCE_NO_EXCESS = `//@version=5
strategy('1519 no excess shape', pyramiding=3, process_orders_on_close=true,
     default_qty_type=strategy.cash, default_qty_value=10000)
if bar_index >= 0 and bar_index <= 2
    strategy.entry('Buy' + str.tostring(bar_index + 1), strategy.long,
         comment = '#' + str.tostring(bar_index + 1))
if bar_index == 3
    strategy.exit('Close', limit = close)`;

type ClosedRow = { size: number; entryPrice: number; entryBar: number; exitPrice: number };

function closedRows(strategy: any): ClosedRow[] {
    return strategy.closedtrades.map((t: any) => ({
        size: Math.abs(t.size),
        entryPrice: t.entry_price,
        entryBar: t.entry_bar_index,
        exitPrice: t.exit_price,
    }));
}

describe('strategy wildcard exit preserves pyramiding physical lots (1519 family)', () => {
    it('keeps ONE logical open row per cash pyramid add: signal count and size sum == position', async () => {
        const engine = new PineTS(new CashPyramidProvider(CANDLES) as any, 'EURGBP', 'D');
        const context = await engine.run(SOURCE_WITHOUT_EXIT);
        const strategy = context.strategy as any;

        expect(strategy.opentrades).toHaveLength(3);
        const sizes = strategy.opentrades.map((t: any) => Math.abs(t.size));
        expect(sizes).toEqual([100, 200, 250]);
        expect(sizes.reduce((a: number, b: number) => a + b, 0)).toBe(strategy.position_size);
        expect(strategy.position_size).toBe(550);
    });

    it('emits TWO closed rows per split add — run excess E first, then qty − E — on a full wildcard close', async () => {
        const engine = new PineTS(new CashPyramidProvider(CANDLES) as any, 'EURGBP', 'D');
        const context = await engine.run(SOURCE);
        const strategy = context.strategy as any;

        // 5 lôtages physiques : 100@100 (fondateur) + [150, qty−150] pour
        // chacune des entrées 2 et 3 (E = 250 − 100 = 150, excess du run).
        expect(closedRows(strategy)).toEqual([
            { size: 100, entryPrice: 100, entryBar: 0, exitPrice: 65 },
            { size: 150, entryPrice: 50, entryBar: 1, exitPrice: 65 },
            { size: 50, entryPrice: 50, entryBar: 1, exitPrice: 65 },
            { size: 150, entryPrice: 40, entryBar: 2, exitPrice: 65 },
            { size: 100, entryPrice: 40, entryBar: 2, exitPrice: 65 },
        ]);
        expect(strategy.closedtrades.reduce((sum: number, t: any) => sum + Math.abs(t.size), 0)).toBe(550);
        expect(strategy.position_size).toBe(0);
        expect(strategy.opentrades).toHaveLength(0);
    });

    it('keeps a SINGLE closed row when the cash add does NOT exceed the oldest open lot', async () => {
        const engine = new PineTS(new CashPyramidProvider(CANDLES_NO_EXCESS) as any, 'EURGBP', 'D');
        const context = await engine.run(SOURCE_NO_EXCESS);
        const strategy = context.strategy as any;

        expect(closedRows(strategy)).toEqual([
            { size: 100, entryPrice: 100, entryBar: 0, exitPrice: 135 },
            { size: 100, entryPrice: 50, entryBar: 1, exitPrice: 135 },
            { size: 100, entryPrice: 50, entryBar: 1, exitPrice: 135 },
            { size: 80, entryPrice: 125, entryBar: 2, exitPrice: 135 },
        ]);
        expect(strategy.closedtrades.reduce((sum: number, t: any) => sum + Math.abs(t.size), 0)).toBe(380);
        expect(strategy.position_size).toBe(0);
    });

    it('keeps SINGLE closed rows under FIXED sizing (no cash-derived split) even when the add exceeds the position', async () => {
        // default_qty_type=fixed, qty=200 → toutes les entrées valent 200.
        // Le split n'est prouvé TV que pour le sizing CASH par défaut.
        const engine = new PineTS(new CashPyramidProvider(CANDLES) as any, 'EURGBP', 'D');
        const context = await engine.run(SOURCE_FIXED);
        const strategy = context.strategy as any;

        expect(closedRows(strategy)).toEqual([
            { size: 200, entryPrice: 100, entryBar: 0, exitPrice: 65 },
            { size: 200, entryPrice: 50, entryBar: 1, exitPrice: 65 },
            { size: 200, entryPrice: 40, entryBar: 2, exitPrice: 65 },
        ]);
        expect(strategy.position_size).toBe(0);
    });

    it('splits the exit commission ONCE per closed lot across the two rows', async () => {
        // commission_type=cash_per_order value=7 : le forfait de sortie d'un
        // ordre est payé UNE fois par lot clos et réparti pro-rata entre les
        // deux lignes fermées — jamais facturé deux fois pour le même ordre.
        const source = SOURCE.replace(
            "strategy('1519 lot conservation shape', pyramiding=3, process_orders_on_close=true,",
            "strategy('1519 lot conservation shape', pyramiding=3, process_orders_on_close=true, commission_type=strategy.commission.cash_per_order, commission_value=7,",
        );
        const engine = new PineTS(new CashPyramidProvider(CANDLES) as any, 'EURGBP', 'D');
        const context = await engine.run(source);
        const strategy = context.strategy as any;

        expect(strategy.closedtrades).toHaveLength(5);
        // Chaque ligne porte la commission d'entrée ET la commission de
        // sortie de son lot pro-rata (cash_per_order 7 par ordre, réparti
        // par la fraction de lot de la ligne). Le couple de lignes d'un
        // lot splitté somme exactement 7 + 7 = 14 : la jambe de sortie de
        // l'ordre n'est JAMAIS facturée deux fois.
        const commissions = strategy.closedtrades.map((t: any) => t.commission);
        expect(commissions[0]).toBeCloseTo(7 + 7, 6);                          // lot 1 (fondateur) : 7 entrée + 7 sortie
        expect(commissions[1]).toBeCloseTo(7 * 150 / 200 + 7 * 150 / 200, 6);  // lot 2, part excès (150/200)
        expect(commissions[2]).toBeCloseTo(7 * 50 / 200 + 7 * 50 / 200, 6);    // lot 2, part ancre (50/200)
        expect(commissions[3]).toBeCloseTo(7 * 150 / 250 + 7 * 150 / 250, 6);  // lot 3, part excès (150/250)
        expect(commissions[4]).toBeCloseTo(7 * 100 / 250 + 7 * 100 / 250, 6);  // lot 3, part ancre (100/250)
        // Σ = 3 ordres entrée ×7 + 3 lots sortie ×7 = 42.
        expect(commissions.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(42, 6);
    });
});