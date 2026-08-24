// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// VIN-117 — couverture de contrats déjà implémentés mais jamais testés.
// Les trois tests sont end-to-end (moteur complet, entrées/sorties observables)
// et ont été prouvés ROUGES par casse volontaire du mécanisme sous test :
//   1. close_all→cancel_all même exécution      (casse : cancel_all no-op)
//   2. singletons × security HTF réel           (casse : fuite chart→security)
//   3. invariant COF 1 cellule singleton/barre  (casse : drain de plots COF retiré)

import { describe, expect, it } from 'vitest';
import { PineTS, aggregateCandles } from 'index';
import type { Context, IProvider, ISymbolInfo } from 'index';

type Candle = {
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

const HOUR_MS = 3_600_000;

const SYMBOL_INFO: ISymbolInfo = {
    current_contract: '',
    description: 'BTC / USDT',
    isin: '',
    main_tickerid: 'TEST:BTCUSDT',
    prefix: 'TEST',
    root: 'BTC',
    ticker: 'BTCUSDT',
    tickerid: 'TEST:BTCUSDT',
    type: 'crypto',
    basecurrency: 'BTC',
    country: '',
    currency: 'USDT',
    timezone: 'Etc/UTC',
    employees: 0,
    industry: '',
    sector: '',
    shareholders: 0,
    shares_outstanding_float: 0,
    shares_outstanding_total: 0,
    expiration_date: 0,
    session: '24x7',
    volumetype: 'base',
    mincontract: 0.00001,
    minmove: 1,
    mintick: 0.01,
    pointvalue: 1,
    pricescale: 100,
    recommendations_buy: 0,
    recommendations_buy_strong: 0,
    recommendations_date: 0,
    recommendations_hold: 0,
    recommendations_sell: 0,
    recommendations_sell_strong: 0,
    recommendations_total: 0,
    target_price_average: 0,
    target_price_date: 0,
    target_price_estimates: 0,
    target_price_high: 0,
    target_price_low: 0,
    target_price_median: 0,
};

function plotValues(ctx: Context, key: string): number[] {
    return (ctx.plots[key]?.data ?? []).map((point: { value: number }) => point.value);
}

function strategyOf(ctx: Context) {
    if (!ctx.strategy) throw new Error('expected a strategy context');
    return ctx.strategy;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. close_all → cancel_all dans la MÊME exécution (et l'inverse)
//    Contrats VIN-96/VIN-104 : cancel_all retire TOUS les ordres pending
//    (entrées ET sorties) ; close_all ferme la position au marché suivant ;
//    aucun ordre annulé ne doit produire de fill posthume.
// ─────────────────────────────────────────────────────────────────────────

const BARS: Candle[] = [
    { openTime: 0, closeTime: 60_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 60_000, closeTime: 120_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 120_000, closeTime: 180_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 180_000, closeTime: 240_000, open: 100, high: 120, low: 99, close: 100, volume: 1 },
    { openTime: 240_000, closeTime: 300_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 300_000, closeTime: 360_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
];

// Barre 3 (openTime 180_000) monte à high 120 : un exit limit à 110 encore
// pending y serait rempli — le test prouve qu'il est bien annulé.
// L'entrée L2 est un limit d'achat à 90 (sous le marché, jamais croisé) :
// elle reste pending jusqu'à l'annulation — un market entry serait rempli au
// start de la barre suivante AVANT que le corps de barre ne puisse l'annuler.
const CLOSE_THEN_CANCEL = `
//@version=5
strategy('close then cancel', pyramiding=2, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.exit('X', from_entry='L', qty=1, limit=110)
    strategy.entry('L2', strategy.long, qty=1, limit=90)
if bar_index == 2
    strategy.close_all()
    strategy.cancel_all()
if bar_index == 4
    strategy.close_all('final')
`;

const CANCEL_THEN_CLOSE = `
//@version=5
strategy('cancel then close', pyramiding=2, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.exit('X', from_entry='L', qty=1, limit=110)
    strategy.entry('L2', strategy.long, qty=1, limit=90)
if bar_index == 2
    strategy.cancel_all()
    strategy.close_all('cleanup')
`;

describe('VIN-117 — close_all et cancel_all dans la même exécution', () => {
    it('① close_all() PUIS cancel_all() : close annulée, position ouverte jusqu’au close final, pending vides, aucun fill posthume', async () => {
        const engine = new PineTS(BARS, 'TEST', '1');
        const ctx = await engine.run(CLOSE_THEN_CANCEL);
        const strategy = strategyOf(ctx);

        // La close_all de la barre 2 a été annulée par la cancel_all de la même
        // barre : la position survit à la barre 3 (dont le high 120 aurait
        // déclenché l'exit limit X s'il était resté pending).
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0]).toMatchObject({
            entry_id: 'L',
            size: 1,
            exit_comment: 'final',
            exit_price: 100,
            exit_time: 300_000, // fermée par le close_all('final') de la barre 4, pas avant
        });
        expect(strategy.pending_orders).toHaveLength(0);
        expect(strategy.position_size).toBe(0);
    });

    it('② cancel_all() PUIS close_all() : pending (entrée+exit) annulés, close remplie au marché suivant', async () => {
        const engine = new PineTS(BARS, 'TEST', '1');
        const ctx = await engine.run(CANCEL_THEN_CLOSE);
        const strategy = strategyOf(ctx);

        // L'exit X (limit 110) et l'entrée L2 (limit 90) sont annulés par la
        // cancel_all ; seule la close_all('cleanup') reste → remplie à l'open
        // de la barre 3. Le high 120 de la barre 3 ne produit AUCUN fill X.
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0]).toMatchObject({
            entry_id: 'L',
            size: 1,
            exit_comment: 'cleanup',
            exit_price: 100,
            exit_time: 180_000,
        });
        expect(strategy.pending_orders).toHaveLength(0);
        expect(strategy.position_size).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Singletons historisés × security HTF réel
//    Contrat 741400d : l'historique du singleton dans le contexte SECONDAIRE
//    référence les barres 1D agrégées du provider, PAS les barres chart —
//    aucune fuite chart→security.
// ─────────────────────────────────────────────────────────────────────────

function build4hFeed(days: number[]): Candle[] {
    const candles: Candle[] = [];
    for (const day of days) {
        const dayStart = Date.UTC(2021, 0, day);
        for (let i = 0; i < 6; i++) {
            const t = dayStart + i * 4 * HOUR_MS;
            candles.push({
                openTime: t,
                closeTime: t + 4 * HOUR_MS,
                open: 100 + day,
                high: 101 + day,
                low: 99 + day,
                close: 100 + day,
                volume: 1,
            });
        }
    }
    return candles;
}

/**
 * Provider qui sert la même série en 4h et l'agrège réellement (4h → 1D via
 * aggregateCandles, le même chemin que BaseProvider) quand la timeframe
 * demandée est quotidienne. Le contexte secondaire de request.security reçoit
 * donc de VRAIES barres 1D agrégées, pas les barres chart.
 */
class DailyAggregatingProvider implements IProvider {
    constructor(private candles: Candle[]) {}

    configure(_config: Record<string, never>): void {}

    async getMarketData(_tickerId: string, timeframe: string) {
        const tf = String(timeframe).toUpperCase();
        if (tf === 'D' || tf === '1D') {
            return aggregateCandles(this.candles, 'D', '240');
        }
        return this.candles;
    }

    async getSymbolInfo() {
        return SYMBOL_INFO;
    }
}

const SECURITY_SINGLETON_SOURCE = `
//@version=5
indicator('sec singleton')
d = request.security(syminfo.tickerid, '1D', dayofmonth[1])
plot(d, 'd')
`;

describe('VIN-117 — singletons historisés × security HTF réel', () => {
    it('dayofmonth[1] du contexte secondaire référence les barres 1D agrégées, pas les barres chart 4h', async () => {
        // 4 jours (10..13 janvier 2021) × 6 barres 4h.
        const feed = build4hFeed([10, 11, 12, 13]);
        const engine = new PineTS(new DailyAggregatingProvider(feed), 'BTCUSDT', '240');
        const ctx = await engine.run(SECURITY_SINGLETON_SOURCE);

        const values = plotValues(ctx, 'd');
        expect(values).toHaveLength(24); // 1 cellule par barre chart

        // lookahead=false (défaut) : les 6 premières barres de chaque jour
        // lisent le singleton du dernier barreau 1D COMPLÉTÉ (jour D-2), la
        // dernière barre du jour (closeTime == closeTime de la barre 1D)
        // lit le jour D-1 :
        //   jour 10 → na, na  |  jour 11 → na, 10  |  jour 12 → 10, 11  |  jour 13 → 11, 12
        // Une fuite chart→security donnerait 11/12 là où la série 1D donne
        // 10/11 (dayofmonth de la barre chart précédente, jour-1).
        const expected = [
            NaN, NaN, NaN, NaN, NaN, NaN, // 10 jan
            NaN, NaN, NaN, NaN, NaN, 10,  // 11 jan
            10, 10, 10, 10, 10, 11,       // 12 jan
            11, 11, 11, 11, 11, 12,       // 13 jan
        ];
        for (let i = 0; i < values.length; i++) {
            if (Number.isNaN(expected[i])) expect(Number.isNaN(values[i])).toBe(true);
            else expect(values[i]).toBe(expected[i]);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Invariant COF : 1 cellule singleton par barre sous re-exécutions multiples
//    Contrat 741400d : calc_on_order_fills=true avec plusieurs fills same-bar
//    → barstate.isconfirmed[1]/dayofmonth[1] restent des séries PAR BARRE
//    (valeurs de la barre précédente), jamais une cellule par pass COF.
// ─────────────────────────────────────────────────────────────────────────

function build1hFeed(): Candle[] {
    const candles: Candle[] = [];
    for (let d = 10; d <= 12; d++) {
        const dayStart = Date.UTC(2021, 0, d);
        for (let i = 0; i < 6; i++) {
            const t = dayStart + i * HOUR_MS;
            const isFillBar = d === 11 && i === 0; // première barre du jour 11 : open 100, high 110, low 95
            candles.push({
                openTime: t,
                closeTime: t + HOUR_MS,
                open: 100,
                high: isFillBar ? 110 : 101,
                low: isFillBar ? 95 : 99,
                close: isFillBar ? 105 : 100,
                volume: 1,
            });
        }
    }
    return candles;
}

// Barre 6 (première barre du jour 11) : l'entrée L (market, posée barre 5)
// se remplit à l'open 100, l'exit X (limit 100.98) se remplit au high 110 →
// plusieurs re-exécutions COF sur la MÊME barre. La garde
// `dayofmonth[1] == 11` doit rester FAUSSE sur cette barre : la barre
// précédente est le jour 10 (dayofmonth 10). Une fuite "1 cellule par pass"
// ferait lire la valeur de la barre courante (11) → close same-tick à 100 au
// lieu du fill limit 100.98.
const COF_SINGLETON_SOURCE = `
//@version=5
strategy('cof singleton invariant', calc_on_order_fills=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 5
    strategy.entry('L', strategy.long)
    strategy.exit('X', 'L', limit=100.98)
if bar_index == 6 and dayofmonth[1] == 11 and strategy.position_size > 0
    strategy.close('L')
d = dayofmonth[1]
c = barstate.isconfirmed[1]
plot(d, 'd')
plot(c, 'c')
`;

describe('VIN-117 — invariant COF 1 cellule singleton par barre', () => {
    it('dayofmonth[1]/barstate.isconfirmed[1] restent par-barre sous re-exécutions COF (plusieurs fills same-bar)', async () => {
        const feed = build1hFeed();
        const engine = new PineTS(feed, 'BTCUSDT', '60');
        const ctx = await engine.run(COF_SINGLETON_SOURCE);

        // 1 cellule par barre : la longueur des plots == nombre de barres
        // (les re-exécutions COF n'ajoutent AUCUNE cellule).
        const day = plotValues(ctx, 'd');
        const confirmed = plotValues(ctx, 'c');
        expect(day).toHaveLength(18);
        expect(confirmed).toHaveLength(18);

        // dayofmonth[1] = jour de la barre PRÉCÉDENTE à chaque barre, y
        // compris la barre de fill (barre 6, première du jour 11 → 10, pas 11).
        const expectedDay = [
            NaN, 10, 10, 10, 10, 10, // jour 10
            10, 11, 11, 11, 11, 11,  // jour 11 (barre 6 = 10 : pas de fuite)
            11, 12, 12, 12, 12, 12,  // jour 12
        ];
        for (let i = 0; i < day.length; i++) {
            if (Number.isNaN(expectedDay[i])) expect(Number.isNaN(day[i])).toBe(true);
            else expect(day[i]).toBe(expectedDay[i]);
        }

        // barstate.isconfirmed[1] : na à la barre 0, puis true partout
        // (toutes les barres sont historiques).
        expect(Number.isNaN(confirmed[0])).toBe(true);
        for (let i = 1; i < confirmed.length; i++) expect(confirmed[i]).toBe(true);

        // La garde `dayofmonth[1] == 11` de la barre 6 n'a pas tiré : le
        // round-trip se conclut par le fill LIMIT X (100.98), pas par un
        // close market same-tick (100).
        const strategy = strategyOf(ctx);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0]).toMatchObject({
            entry_id: 'L',
            entry_price: 100,
            exit_price: 100.98,
        });
    });
});
