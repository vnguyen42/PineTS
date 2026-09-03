// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille SIZING_CASH_PRIX_NON_QUANTIFIE_TICK — id révélateur 1622
// (BINANCE:SANDUSDT, tf D, script MTF ; capture TV : qty TV =
// floor3(10000 / round_mintick(close[entryBar-1])), mintick 1e-5).
//
// Mécanisme : pour une entrée MARCHÉ par défaut (sans argument qty) sur un
// symbole crypto/spot, TradingView dimensionne le montant cash
// (default_qty_type 'cash') sur le prix AFFICHÉ — le close de la barre de
// signal quantifié au mintick, round(close/mintick)·mintick — alors que le
// moteur dimensionnait sur le close BRUT. Écart relatif max 1.1365e-4, 27
// quantités + 36 profits faux sur les 37 lignes divergentes de la cible.
// Le fix étend le prix de sizing affiché (cryptoMarketSizingPrice, déjà
// VIN-B pour percent_of_equity) à tout type par défaut dont la quantité
// DIVISE par le prix (percent_of_equity, cash). Inchangés : percent_of_equity,
// niveaux limit/stop déclarés (niveau effectif arrondi, VIN-137), symboles
// non-crypto, quantités explicites et default_qty_type 'fixed' (compte de
// contrats, aucun prix au dénominateur).
import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { initializeStrategy } from '../../../src/namespaces/strategy/utils';
import { StrategyState } from '../../../src/namespaces/strategy/types';

function strategyOf(context: Context): StrategyState {
    if (!context.strategy) throw new Error('strategy state was not initialized');
    return context.strategy;
}

function makeContext(
    close: number,
    mintick: number,
    type: 'crypto' | 'spot' | 'stock' = 'spot',
    config: Record<string, unknown> = {},
    prefix = type === 'stock' ? 'NASDAQ' : 'BINANCE',
): Context {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: type === 'stock' ? 'NASDAQ:TEST' : 'BINANCE:TESTUSDT',
        timeframe: '240',
    });
    context.idx = 0;
    context.data.open = new Series([close]);
    context.data.high = new Series([close]);
    context.data.low = new Series([close]);
    context.data.close = new Series([close]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick, pointvalue: 1, type, prefix };
    context.pine.qtyStep = 0.001;
    initializeStrategy(context, {
        initial_capital: 10_000,
        default_qty_type: 'cash',
        default_qty_value: 10_000,
        ...config,
    });
    return context;
}

describe('cash crypto sizing price (1622 SANDUSDT)', () => {
    it('1622 sizes the default cash market entry on the DISPLAYED mintick price', () => {
        const context = makeContext(0.049368, 0.00001, 'crypto');

        entry(context)('L', 'long');

        // 0.049368 → affiché 0.04937 : floor3(10000/0.04937) = 202552.157.
        // Le close brut donnait floor3(10000/0.049368) = 202560.363 — le
        // montant pré-fix, reproduit ci-dessous pour rendre le contrat
        // explicite (la barre réelle du ledger 1622 sur laquelle les deux
        // lectures divergent).
        const rawDiv = Math.floor(10000 / 0.049368 / 0.001) * 0.001;
        expect(rawDiv).toBe(202560.362);
        expect(strategyOf(context).pending_orders[0].qty).toBe(202552.157);
    });

    it('reserves directional slippage in the displayed cash sizing price (1917-style)', () => {
        const long = makeContext(10, 0.01, 'spot', { slippage: 1 });
        entry(long)('L', 'long');
        // 10 + 1 tick = 10.01 : floor3(10000/10.01) = 999.000 ; le brut
        // donnait 1000.
        expect(strategyOf(long).pending_orders[0].qty).toBe(999);

        const short = makeContext(15.59, 0.001, 'spot', { slippage: 1 }, 'OKX');
        entry(short)('S', 'short');
        // 15.590 − 1 tick = 15.589 (signe directionnel, 2701) :
        // floor3(10000/15.589) = 641.477 ; +1 tick donnerait 641.395.
        expect(strategyOf(short).pending_orders[0].qty).toBe(641.477);
    });

    it('exercises the four canonical rounding cases through the cash sizing path', () => {
        const sizedAt = (close: number, mintick: number) => {
            const context = makeContext(close, mintick, 'spot');
            entry(context)('L', 'long');
            return strategyOf(context).pending_orders[0].qty;
        };

        // 1. exactement sur la grille, bruit 1 ulp amont absorbé → inchangé.
        expect(sizedAt(0.07000000000000001, 0.01)).toBe(sizedAt(0.07, 0.01));
        expect(sizedAt(0.07, 0.01)).toBe(142857.142);
        // 2. vraie fraction arrondie au tick affiché le plus proche (0.073 →
        //    0.07 : contrat du prix affiché, pas le away-from-reference).
        expect(sizedAt(0.073, 0.01)).toBe(142857.142);
        // 3. poussière de soustraction amont absorbée.
        expect(sizedAt(0.1 - 9 * 0.01, 0.01)).toBe(sizedAt(0.01, 0.01));
        expect(sizedAt(0.01, 0.01)).toBe(1_000_000);
        // 4. un déficit sub-bruit affiche quand même le tick (1 − 5e-10 d'une
        //    grille à 1 tick est le tick, donc le nominal divise par 1).
        expect(sizedAt(1 + 5e-10, 1)).toBe(10_000);
    });

    it('keeps a declared limit level on its rounded effective level', () => {
        // Avec slippage 1 tick, le marché dimensionnerait à 0.049368+1e-5 =
        // 0.049378 (floor3(10000/0.049378) = 202519.31) ; le niveau déclaré
        // garde le sizing VIN-89 sur son niveau effectif arrondi 0.05.
        const context = makeContext(0.049368, 0.00001, 'spot', { slippage: 1 });
        entry(context)('L', 'long', { limit: 0.05 });
        expect(strategyOf(context).pending_orders[0].qty).toBe(200000);
    });

    it('keeps stocks, fixed default qty and explicit qty untouched', () => {
        // Stock : le close brut reste le dénominateur (hors périmètre crypto).
        // 10.005 → brut floor3(10000/10.005) = 999.5 ; le snap affiché
        // (10.01 → 999) donnerait un montant différent.
        const stock = makeContext(10.005, 0.01, 'stock');
        entry(stock)('L', 'long');
        expect(strategyOf(stock).pending_orders[0].qty).toBe(999.5);

        // 'fixed' : un compte de contrats, aucun prix au dénominateur.
        const fixed = makeContext(0.049368, 0.00001, 'crypto', {
            default_qty_type: 'fixed',
            default_qty_value: 100,
        });
        entry(fixed)('L', 'long');
        expect(strategyOf(fixed).pending_orders[0].qty).toBe(100);

        // Quantité explicite : chemin fixed, valeur brute inchangée.
        const explicit = makeContext(0.049368, 0.00001, 'crypto');
        entry(explicit)('L', 'long', { qty: 55 });
        expect(strategyOf(explicit).pending_orders[0].qty).toBe(55);
    });
});