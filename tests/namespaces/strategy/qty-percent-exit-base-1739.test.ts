// Famille qty-percent-exit-base — id révélateur 1739 (BINANCE:LDOUSDT, tf 240,
// « Take profit Multi timeframe »).
//
// Attribution (session 2026-09-02, diagnostic croisé des montants ; ledger
// canonique oracle-archives/rescore-20260901-series-secondaires/replay-caps/1739/
// 08-tv-ledger-canonical.json) : TradingView applique strategy.exit(qty_percent=)
// à la QUANTITÉ DE L'ORDRE D'ENTRÉE, pas à la position résiduelle.
//   - 137 entrées du ledger, taille d'entrée TOUJOURS 1.0 (pyramiding=0,
//     default_qty_type=fixed, default_qty_value=1) ;
//   - 351 lignes TV à 0.05 = 5 % × 1.0 émises alors que la position résiduelle
//     était 0.85/0.9/0.95 (ZÉRO ligne violant « 5 % de l'entrée », 351 violant
//     « 5 % du résiduel ») ;
//   - 266 lignes à 0.05 au ratio exit/entry 0.950 : le SL (ticks du prix)
//     partagé par les QUATRE exits sort QUATRE constantes 0.05 sur la même
//     barre — jamais 0.05 → 0.0475 → 0.0451 → 0.0428 (série fautive du moteur
//     qui prenait le % du résiduel) ;
//   - séquences de tailles par entrée : (0.05×4, 0.8) 109×, (0.05×2, 0.9) 16×,
//     (0.05, 0.95) 6×, (0.05×3, 0.85) 4×, (1) 2× — le solde restant part via
//     strategy.close_all (hors périmètre de cette famille).
//
// Le moteur lâche la taille INITIALE de l'ordre d'entrée sur chaque lot
// (Trade._entry_order_qty, posé à l'ouverture) ; la fraction calculée est
// constante par exit, bornée par la position disponible au fill.
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

// Provider factice : symbolInfo mintick 0.01 / pointvalue 1 (grille de prix de
// la cible 1739 BINANCE:LDOUSDT — percent() du script arrondit au tick).
function candleProvider(candles: Kline[]): IProvider {
    const symbolInfo = {
        current_contract: '',
        description: 'qty-percent-exit-base 1739 test',
        isin: '',
        main_tickerid: 'BINANCE:LDOUSDT',
        prefix: 'BINANCE',
        root: 'LDO',
        ticker: 'LDOUSDT',
        tickerid: 'BINANCE:LDOUSDT',
        type: 'crypto',
        basecurrency: 'LDO',
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
        volumetype: '',
        mincontract: 0,
        minmove: 0.01,
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
    } satisfies ISymbolInfo;
    return {
        getMarketData: async () => candles,
        getSymbolInfo: async () => symbolInfo,
        configure: () => {},
    };
}

async function runStrategy(candles: Kline[], source: string) {
    const context = await new PineTS(candleProvider(candles), 'BINANCE:LDOUSDT', '240').run(source);
    const strategy = context.strategy;
    if (!strategy) throw new Error('strategy state was not initialized');
    return strategy;
}

// Reproduit le schéma de 1739 : entrée "Long" fixed 1.0 à la barre 1, puis les
// quatre strategy.exit qty_percent=5 (profit/loss en ticks du prix via
// percent()). Barres : fill d'entrée au open de la barre 2 ; chaque barre 3..6
// ne traverse qu'UN niveau (TP1 103, TP2 105, TP3 108, TP4 110 — mintick 0.01,
// prix d'entrée 100).
const SOURCE_PERCENT_5 = `
//@version=5
strategy('qty-percent-exit-base 1739', pyramiding=0, initial_capital=10000, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0)
percent(pcnt) =>
    strategy.position_size != 0 ? math.round(pcnt / 100 * strategy.position_avg_price / syminfo.mintick) : float(na)
if bar_index == 1
    strategy.entry('Long', strategy.long)
if strategy.position_size > 0
    strategy.exit('TP1%', 'Long', qty_percent = 5, profit = percent(3), loss = percent(5))
    strategy.exit('TP2%', 'Long', qty_percent = 5, profit = percent(5), loss = percent(5))
    strategy.exit('TP3%', 'Long', qty_percent = 5, profit = percent(8), loss = percent(5))
    strategy.exit('TP4%', 'Long', qty_percent = 5, profit = percent(10), loss = percent(5))
`;

describe('qty-percent-exit-base (1739) — exits sized on the ENTRY order quantity', () => {
    it('keeps every successive TP close at 5% of the ENTRY quantity (0.05 constant, not 0.0475/0.0451/0.0428)', async () => {
        // barre 2 : open 100 fill, high 101 < TP1 103 → rien
        // barre 3 : high 104 ≥ TP1 103 → 0.05 ; barre 4 : high 106 ≥ TP2 105 → 0.05
        // barre 5 : high 109 ≥ TP3 108 → 0.05 ; barre 6 : high 111 ≥ TP4 110 → 0.05
        const candles = [
            candle(0, 100, 100, 100, 100),
            candle(DAY, 100, 101, 99, 100),
            candle(2 * DAY, 100, 101, 99, 100),
            candle(3 * DAY, 101, 104, 100, 102),
            candle(4 * DAY, 102, 106, 101, 103),
            candle(5 * DAY, 103, 109, 102, 104),
            candle(6 * DAY, 104, 111, 103, 105),
            candle(7 * DAY, 105, 106, 104, 105),
        ];
        const strategy = await runStrategy(candles, SOURCE_PERCENT_5);

        const sizes = strategy.closedtrades.map((t) => t.size);
        expect(sizes).toHaveLength(4);
        for (const size of sizes) {
            expect(size).toBeCloseTo(0.05, 10);
        }
        // le solde de l'entrée 1.0 reste ouvert (0.8 = 1 − 4 × 0.05)
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].size).toBeCloseTo(0.8, 10);
    });

    it('fires the shared SL of the remaining exits at the constant 5%-of-entry after a prior TP close', async () => {
        // barre 3 : high 104 ≥ TP1 103 → 0.05 (le bracket TP1% est épuisé) ;
        // barre 4 : low 94 < SL 95 → les TROIS autres exits déclenchent leur
        // leg loss commune : 3 × 0.05 CONSTANT — le bracket épuisé par son TP
        // ne re-frappe pas. Le ledger 1739 porte 266 lignes 0.05 au ratio
        // 0.950 (SL en ticks du prix), jamais la série décroissante
        // 0.05/0.0475/0.0451/0.0428 du moteur fautif.
        const candles = [
            candle(0, 100, 100, 100, 100),
            candle(DAY, 100, 101, 99, 100),
            candle(2 * DAY, 100, 101, 99, 100),
            candle(3 * DAY, 101, 104, 100, 102),
            candle(4 * DAY, 102, 103, 94, 95),
            candle(5 * DAY, 95, 96, 94, 95),
        ];
        const strategy = await runStrategy(candles, SOURCE_PERCENT_5);

        const sizes = strategy.closedtrades.map((t) => t.size);
        expect(sizes).toHaveLength(4);
        for (const size of sizes) {
            expect(size).toBeCloseTo(0.05, 10);
        }
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].size).toBeCloseTo(0.8, 10);
    });

    it('scales the constant fraction with the ENTRY order size (entry 2 → 0.1 per TP), not with the residual', async () => {
        const candles = [
            candle(0, 100, 100, 100, 100),
            candle(DAY, 100, 101, 99, 100),
            candle(2 * DAY, 100, 101, 99, 100),
            candle(3 * DAY, 101, 104, 100, 102),
            candle(4 * DAY, 102, 106, 101, 103),
            candle(5 * DAY, 103, 109, 102, 104),
            candle(6 * DAY, 104, 111, 103, 105),
        ];
        // même script avec default_qty_value=2
        const strategy = await runStrategy(
            candles,
            SOURCE_PERCENT_5.replace('default_qty_value=1', 'default_qty_value=2'),
        );

        const sizes = strategy.closedtrades.map((t) => t.size);
        expect(sizes).toHaveLength(4);
        for (const size of sizes) {
            expect(size).toBeCloseTo(0.1, 10);
        }
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].size).toBeCloseTo(1.6, 10);
    });

    it('never closes more than the available position when the constant fraction exceeds it', async () => {
        // exits à 90 % de l'entrée 1.0 : TP A (103) sort 0.9 ; TP B (105) :
        // fraction constante 0.9 > résiduel 0.1 → tout le disponible part
        // (min avec la position, jamais de surplus) ; TP C (108) : plus rien.
        const source = SOURCE_PERCENT_5.replaceAll('qty_percent = 5', 'qty_percent = 90');
        const candles = [
            candle(0, 100, 100, 100, 100),
            candle(DAY, 100, 101, 99, 100),
            candle(2 * DAY, 100, 101, 99, 100),
            candle(3 * DAY, 101, 104, 100, 102),
            candle(4 * DAY, 102, 106, 101, 103),
            candle(5 * DAY, 103, 109, 102, 104),
            candle(6 * DAY, 104, 111, 103, 105),
        ];
        const strategy = await runStrategy(candles, source);

        const sizes = strategy.closedtrades.map((t) => t.size);
        expect(sizes).toHaveLength(2);
        expect(sizes[0]).toBeCloseTo(0.9, 10);
        expect(sizes[1]).toBeCloseTo(0.1, 10);
        expect(strategy.opentrades).toHaveLength(0);
    });
});