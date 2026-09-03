// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille EXPLICIT_QTY_QUANTIZATION — id révélateur 2485 (FX:USDCHF, tf 240,
// « Bollinger Bands + EMA 9 »).
//
// Attribution (session 2026-09-02, diagnostic croisé des montants ; re-fit
// 2026-09-03 sur le ledger canonique
// oracle-archives/symboles-manquants-lot2-20260827/runs/run-20260827T174412Z-2485/
// 08-tv-ledger-canonical.json) :
//   - qty TV = floor(100·stop/(entry·|entry−stop|)) reproduite 807/807 en
//     PLEINE précision (entry = close de la barre de signal, stop = low[1] /
//     high[1]) — aucun arrondi intermédiaire ;
//   - le moteur arrondissait les retours des fonctions utilisateur à 10
//     décimales ($.precision, round au 1e-10) : la chaîne
//     calcPositionSize → percent2money de CE script bruitait la quantité
//     (erreur relative jusqu'à ~1e-4) → 137 lignes déviantes (moteur
//     670/807, |Δprofit − Δqty·Δprix| ≤ 7.3e-4, 100 % du faux montant =
//     quantité) ;
//   - preuve par sondes moteur (barre par barre) : specifiedQty =
//     |round10(1/round10((entry·((entry−stop)/stop))/100))| bit-à-bit sur
//     767/807 (le reste à 1 ulp), floor == ledger moteur 807/807.
//
// Fix : les fonctions dont le retour alimente un argument qty EXPLICITE
// (strategy.entry/strategy.order/strategy.exit, transitivement à travers
// les variables locales) sont transpilées SANS le wrap precision — règle TV,
// chemin des quantités explicites uniquement (sizing percent_of_equity/cash/
// fixed et toutes les autres fonctions inchangés). Résultat mesuré : 2485
// pleineCle 711/807 → 807/807, deltas de quantité max 0 ; 1781 (2960/2972,
// 518/2960) et 1519 (1638/1638) bit-identiques ligne à ligne.
//
// Les cas ci-dessous reproduisent la CHAÎNE complète (fonctions utilisateur
// + variable locale + math.abs + qtyStep 1) sur des barres synthétiques dont
// les valeurs font franchir la frontière d'entier à l'arrondi 1e-10 :
//   entry 0.89000 / stop 0.88900 → plein 99887.64 → 99887 | pollué 99888.13 → 99888
//   entry 0.89206 / stop 0.89107 → plein 100898.0009 → 100898 | pollué 100897.992 → 100897
//   entry 0.93656 / stop 0.93738 (SHORT) → plein 122057.993 → 122057 | pollué 122058.39 → 122058
//     (paire RÉELLE du ledger 2485, bar 251)
//   entry 1.08869 / stop 1.08801 → plein 146966.97 → 146966 | pollué 146968.05 → 146968
//   entry 0.89975 / stop 0.89905 → plein 142746.0009 → 142746 | pollué 142744.986 → 142744
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Kline } from '../../../src/marketData/types';
import { IProvider, ISymbolInfo } from '../../../src/marketData/IProvider';

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

// Provider factice : grille de prix forex (mintick 1e-5, pointvalue 1) et pas
// de quantité ENTIER (getQtyStep → 1) — la configuration résolue de la cible
// 2485 (FX:USDCHF, fractional=false → qtyStep 1).
function forexProvider(candles: Kline[]): IProvider {
    const symbolInfo = {
        current_contract: '',
        description: 'explicit-qty-quantization 2485 test',
        isin: '',
        main_tickerid: 'FX:USDCHF',
        prefix: 'FX',
        root: 'USDCHF',
        ticker: 'USDCHF',
        tickerid: 'FX:USDCHF',
        type: 'forex',
        basecurrency: 'USD',
        country: '',
        currency: 'CHF',
        timezone: 'Etc/UTC',
        employees: 0,
        industry: '',
        sector: '',
        shareholders: 0,
        shares_outstanding_float: 0,
        shares_outstanding_total: 0,
        expiration_date: 0,
        session: '24x7',
        volumetype: '',
        mincontract: 0,
        minmove: 1,
        mintick: 0.00001,
        pointvalue: 1,
        pricescale: 100000,
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
    } satisfies ISymbolInfo;
    return {
        getMarketData: async () => candles,
        getSymbolInfo: async () => symbolInfo,
        getQtyStep: () => 1,
        configure: () => {},
    };
}

// Schéma réduit de 2485 (mêmes fonctions utilisateur percent2money /
// calcPositionSize, même branche LONG ou SHORT, même transmission par la
// variable locale order_size + math.abs) : une entrée unique à la barre
// SIGNAL_BAR. Le stop est low[1] (LONG) / high[1] (SHORT) de la barre de
// signal, l'entrée au close courant — exactement les références du script
// d'origine.
function buildSource(direction: 'LONG' | 'SHORT', signalBar: number): string {
    const stopRef = direction === 'LONG' ? 'low[1]' : 'high[1]';
    const stopSizeExpr = direction === 'LONG'
        ? '(entry - stop) / stop'
        : '(stop - entry) / stop';
    return `
//@version=5
strategy('explicit-qty-quantization 2485', overlay=true, initial_capital=1000, process_orders_on_close=true, default_qty_type=strategy.fixed)
max_risk_percentage = input.float(1, 'Max Risk (%)', 0.01, 99, 0.01, group='Risk Management')
riskType = input.string('%', title='Risk Type', options=['%', '$'], group='Risk Management')
percent2money(price, percent) =>
    price * percent / 100 * syminfo.pointvalue
calcPositionSize(entry, stop_size) =>
    risk = if riskType == '% from equity'
        strategy.equity * max_risk_percentage / 100
    else
        max_risk_percentage
    risk / percent2money(entry, stop_size)
stop = 0.0
entry = 0.0
if bar_index == ${signalBar}
    stop := ${stopRef}
    entry := close
    stop_size = ${stopSizeExpr}
    order_size = calcPositionSize(close, stop_size)
    strategy.entry('${direction}', strategy.${direction === 'LONG' ? 'long' : 'short'}, math.abs(order_size))
`;
}

async function entrySizeAt(candles: Kline[], signalBar: number, direction: 'LONG' | 'SHORT'): Promise<number> {
    const source = buildSource(direction, signalBar);
    const context = await new PineTS(forexProvider(candles), 'FX:USDCHF', '240').run(source);
    const strategy = context.strategy;
    if (!strategy) throw new Error('strategy state was not initialized');
    if (strategy.closedtrades.length === 0 && strategy.opentrades.length === 0) {
        throw new Error(`no trade recorded at signal bar ${signalBar}`);
    }
    const trade = strategy.closedtrades[0] ?? strategy.opentrades[0];
    return Math.abs(trade.size);
}

const BARS = Array.from({ length: 8 }, (_, i) =>
    candle(i * DAY, 0.95, 0.96, 0.94, 0.955),
);

describe('explicit-qty-quantization (2485) — qty explicite via fonctions utilisateur en pleine précision', () => {
    it('LONG : floor de la valeur pleine précision (99887), pas du round 1e-10 (99888) — entry 0.89000 stop 0.88900', async () => {
        // close[6] = 0.89000, low[5] = 0.88900 → 100·stop/(entry·(entry−stop)) = 99887.640…
        const candles = [...BARS];
        candles[5] = candle(5 * DAY, 0.891, 0.892, 0.889, 0.891);
        candles[6] = candle(6 * DAY, 0.891, 0.892, 0.8895, 0.89);
        const size = await entrySizeAt(candles, 6, 'LONG');
        expect(size).toBe(99887);
    });

    it('LONG : la frontière est franchie dans l’AUTRE sens (plein 100898 vs pollué 100897) — entry 0.89206 stop 0.89107', async () => {
        const candles = [...BARS];
        candles[5] = candle(5 * DAY, 0.892, 0.893, 0.89107, 0.892);
        candles[6] = candle(6 * DAY, 0.8925, 0.893, 0.8915, 0.89206);
        const size = await entrySizeAt(candles, 6, 'LONG');
        expect(size).toBe(100898);
    });

    it('SHORT : paire RÉELLE du ledger 2485 (bar 251 : entry 0.93656, high[1] 0.93738 → 122057) — le round 1e-10 donnerait 122058', async () => {
        const candles = [...BARS];
        candles[5] = candle(5 * DAY, 0.9366, 0.93738, 0.9361, 0.9362);
        candles[6] = candle(6 * DAY, 0.9366, 0.937, 0.93613, 0.93656);
        const size = await entrySizeAt(candles, 6, 'SHORT');
        expect(size).toBe(122057);
    });

    it('LONG : écart de DEUX unités (plein 146966 vs pollué 146968) — entry 1.08869 stop 1.08801', async () => {
        const candles = [...BARS];
        candles[5] = candle(5 * DAY, 1.088, 1.089, 1.08801, 1.0881);
        candles[6] = candle(6 * DAY, 1.0885, 1.089, 1.0881, 1.08869);
        const size = await entrySizeAt(candles, 6, 'LONG');
        expect(size).toBe(146966);
    });

    it('LONG : écart de −DEUX unités (plein 142746 vs pollué 142744) — entry 0.89975 stop 0.89905', async () => {
        const candles = [...BARS];
        candles[5] = candle(5 * DAY, 0.899, 0.9005, 0.89905, 0.8992);
        candles[6] = candle(6 * DAY, 0.8995, 0.9005, 0.8991, 0.89975);
        const size = await entrySizeAt(candles, 6, 'LONG');
        expect(size).toBe(142746);
    });
});