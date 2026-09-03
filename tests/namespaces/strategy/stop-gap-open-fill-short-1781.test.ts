// Famille STOP_GAP_OPEN_FILL_SHORT — id révélateur 1781 (FX:USDZAR, tf 120,
// « FS ATR & PS (MA) », ledger TV oracle-archives/tv-vin95/captures/1781/
// run-20260824T221148Z/08-tv-ledger-canonical.json).
//
// Attribution (session 2026-09-02, diagnostic croisé ; revérifiée 2026-09-03
// sur le ledger moteur vs TV, 12 lignes / 6 barres) : une entrée SHORT au
// marché posée sur la barre N (vendredi, crossunder EMA/WMA) se remplit au
// OPEN de la barre N+1 (lundi, gap de week-end). Le buy-stop — jambe SL du
// short, niveau close_N + 200×mintick — est DÉJÀ FRANCHI par cet open
// (open > stop) alors qu'aucun TP (close_N − c / close_N − d, sous l'entrée)
// ne l'est. TV exécute le stop AU PRIX D'OUVERTURE : entrée = sortie = open,
// profit 0 (12/12 lignes, 6 barres : 3830, 4370, 6050, 6349, 8329, 12146 —
// chaque open est au-dessus du stop, aucun TP franchi à l'open).
//
// Le moteur fermait AILLEURS, en deux familles de trajectoires :
//   - stop supprimé par buyStopSparesFreshEntry (jambe SL écartée pour toute
//     entrée short du même bar) puis TP remplis AU NIVEAU intrabar quand le
//     low traverse les limites (3830, 6349, 8329 : exits 14.9618/14.9598,
//     15.3479/15.3459, 17.2606/17.2586 = les niveaux TP1/TP2) ;
//   - sinon rien ne se remplit sur la barre du gap, et le stop se remplit au
//     OPEN DE LA BARRE SUIVANTE (4370, 6050, 12146 : fill au open suivant,
//     exitTime = barre suivante).
//
// La règle TV distillée (probe gap_precedence BTCUSDC 1D, «closes ONLY the
// prior stack») : le gap-stop épargne UNIQUEMENT l'AJOUT pyramiding au-dessus
// d'un stack déjà ouvert (234/234) ; une entrée short ouverte DEPUIS FLAT au
// même open EST rattrapée par le stop (profit 0, 1781 12/12 ; le reversal
// s'attache aussi et gap-exit à son propre fill, 2021-09-08). Le stop LONG
// (sell-stop, gap down) rattrape toujours (403/403) — verrouillé ici.
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

// Provider factice : mintick 0.01 / pointvalue 1 (grille de prix de la cible
// 1781 FX:USDZAR, tick 1e-5 — les niveaux du script 1781 sont
// close ± {200,400}×mintick ; ici close 100 → stop 102, TP1 98, TP2 96).
function candleProvider(candles: Kline[]): IProvider {
    const symbolInfo = {
        current_contract: '',
        description: 'stop-gap-open-fill-short 1781 test',
        isin: '',
        main_tickerid: 'FX:USDZAR',
        prefix: 'FX',
        root: 'USDZAR',
        ticker: 'USDZAR',
        tickerid: 'FX:USDZAR',
        type: 'forex',
        basecurrency: 'USD',
        country: '',
        currency: 'ZAR',
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
    const context = await new PineTS(candleProvider(candles), 'FX:USDZAR', '120').run(source);
    const strategy = context.strategy;
    if (!strategy) throw new Error('strategy state was not initialized');
    return strategy;
}

// Reproduction du schéma 1781 (géométrie barres 4370/6050/12146) : signal sur
// la barre 1 (vendredi), entrée SHORT market + bracket stop 102 / TP 98/96 ;
// barre 2 = open de lundi en gap AU-DESSUS du stop (103 > 102), low restant
// au-dessus des TP (aucun niveau TP traversé intrabar) ; barre 3 = open 102.5
// encore au-dessus du stop (le moteur fautif s'y ferme au open).
const SOURCE_GAP_SHORT = `
//@version=5
strategy('stop-gap-open-fill-short 1781', pyramiding=1, initial_capital=100000, default_qty_type=strategy.fixed, default_qty_value=1000, commission_type=strategy.commission.percent, commission_value=0)
if bar_index == 1
    strategy.entry('Sell', strategy.short)
    strategy.exit('Exit3', 'Sell', stop=102, limit=98, qty=500)
    strategy.exit('Exit4', 'Sell', stop=102, limit=96)
`;

// Variante barres 3830/6349/8329 : le low de la barre du gap traverse les TP
// (géométrie O→L) — le moteur fautif y remplissait les TP AU NIVEAU
// (14.9618/14.9598 etc.) ; TV remplit le stop au open quand même (le stop est
// déjà franchi à l'ouverture, l'OCO lui donne la priorité).
const SOURCE_GAP_SHORT_TP_CROSSED = SOURCE_GAP_SHORT;

// Verrou 403/403 : le sell-stop d'une entrée LONG du même bar au gap down
// (open sous le stop) remplit déjà au open — symétrie LONG déjà correcte.
const SOURCE_GAP_LONG = `
//@version=5
strategy('stop-gap-open-fill-short 1781 long-mirror', pyramiding=1, initial_capital=100000, default_qty_type=strategy.fixed, default_qty_value=1000, commission_type=strategy.commission.percent, commission_value=0)
if bar_index == 1
    strategy.entry('Buy', strategy.long)
    strategy.exit('Exit1', 'Buy', stop=98, limit=102, qty=500)
    strategy.exit('Exit2', 'Buy', stop=98, limit=104)
`;

// Verrou 234/234 (probe BTCUSDC 1D) : avec un stack short déjà ouvert, le
// gap-stop au open ferme SEULEMENT le stack antérieur — l'ajout pyramiding
// qui se remplit au même open SURVIT (bracket posé barre 1, entrée ajout
// barre 2 signal → fill au open de la barre 3).
const SOURCE_PYRAMID_ADD_SPARED = `
//@version=5
strategy('stop-gap-open-fill-short 1781 pyramid-add-spared', pyramiding=2, initial_capital=100000, default_qty_type=strategy.fixed, default_qty_value=1000, commission_type=strategy.commission.percent, commission_value=0)
if bar_index == 1
    strategy.entry('Sell1', strategy.short)
    strategy.exit('Exit3', stop=102, limit=98)
if bar_index == 2
    strategy.entry('Sell2', strategy.short)
`;

describe('stop-gap-open-fill-short (1781) — un buy-stop déjà franchi à l\'open rattrape une entrée short depuis flat', () => {
    it('ferme au open de la barre du gap (entrée = sortie = open, profit 0), jamais au open de la barre suivante', async () => {
        // Géométrie 4370/6050/12146 : l'open du lundi est au-dessus du stop,
        // le low ne traverse AUCUN TP (rien ne se remplit intrabar).
        const candles = [
            candle(0, 100, 100, 100, 100),
            candle(DAY, 100, 101, 99, 100), // signal : entrée + bracket stop 102 / TP 98 / TP 96
            candle(2 * DAY, 103, 105, 101.5, 104), // gap up : open 103 > stop 102, low 101.5 > TP
            candle(3 * DAY, 102.5, 103.5, 101.5, 102.5), // open encore au-dessus du stop
            candle(4 * DAY, 100, 101, 99, 100),
        ];
        const strategy = await runStrategy(candles, SOURCE_GAP_SHORT);

        const closed = strategy.closedtrades;
        expect(closed).toHaveLength(2);
        for (const trade of closed) {
            expect(trade.entry_price).toBe(103);
            expect(trade.exit_price).toBe(103); // open déjà au-dessus du stop → fill au open, pas au niveau
            expect(trade.profit).toBeCloseTo(0, 9);
        }
        expect(strategy.opentrades).toHaveLength(0);
    });

    it('le stop au open prime sur les TP même quand le low de la barre traverse les niveaux (géométrie 3830)', async () => {
        // Géométrie 3830/6349/8329 : le moteur fautif remplissait les TP AU
        // NIVEAU (98 puis 96) quand low < TP2 ; TV paie le stop au open (103),
        // profit 0 — l'OCO donne la priorité au stop déjà franchi à l'open.
        const candles = [
            candle(0, 100, 100, 100, 100),
            candle(DAY, 100, 101, 99, 100),
            candle(2 * DAY, 103, 104, 95.5, 103.5), // gap up + low 95.5 sous TP2 96
            candle(3 * DAY, 102.5, 103.5, 101.5, 102.5),
            candle(4 * DAY, 100, 101, 99, 100),
        ];
        const strategy = await runStrategy(candles, SOURCE_GAP_SHORT_TP_CROSSED);

        const closed = strategy.closedtrades;
        expect(closed).toHaveLength(2);
        for (const trade of closed) {
            expect(trade.entry_price).toBe(103);
            expect(trade.exit_price).toBe(103); // profit 0, JAMAIS les TP au niveau
            expect(trade.profit).toBeCloseTo(0, 9);
        }
        expect(strategy.opentrades).toHaveLength(0);
    });

    it('verrou 403/403 — sell-stop d\'une entrée LONG du même bar au gap down : fill au open, profit 0', async () => {
        const candles = [
            candle(0, 100, 100, 100, 100),
            candle(DAY, 100, 101, 99, 100),
            candle(2 * DAY, 97, 99, 96.5, 98), // gap down : open 97 < stop 98, high 99 < TP
            candle(3 * DAY, 98.5, 99.5, 97.5, 98.5),
            candle(4 * DAY, 100, 101, 99, 100),
        ];
        const strategy = await runStrategy(candles, SOURCE_GAP_LONG);

        const closed = strategy.closedtrades;
        expect(closed).toHaveLength(2);
        for (const trade of closed) {
            expect(trade.entry_price).toBe(97);
            expect(trade.exit_price).toBe(97);
            expect(trade.profit).toBeCloseTo(0, 9);
        }
        expect(strategy.opentrades).toHaveLength(0);
    });

    it('verrou 234/234 — l\'AJOUT pyramiding du même open SURVIT au gap-stop ; seul le stack antérieur ferme au open', async () => {
        const candles = [
            candle(0, 100, 100, 100, 100),
            candle(DAY, 100, 101, 99, 100), // signal Sell1 + bracket (stop 102 / TP 98)
            candle(2 * DAY, 100, 101, 99, 100), // Sell1 se remplit au open 100 ; signal Sell2 posé
            candle(3 * DAY, 103, 105, 101, 104), // gap : open 103 > stop 102 ; Sell2 se remplit au open
            candle(4 * DAY, 102.5, 103.5, 101.5, 102.5),
            candle(5 * DAY, 100, 101, 99, 100),
        ];
        const strategy = await runStrategy(candles, SOURCE_PYRAMID_ADD_SPARED);

        // le stack antérieur (Sell1, entré barre 2 à 100) ferme au open 103
        expect(strategy.closedtrades).toHaveLength(1);
        const prior = strategy.closedtrades[0];
        expect(prior.entry_price).toBe(100);
        expect(prior.exit_price).toBe(103);
        expect(prior.profit).toBeCloseTo((100 - 103) * 1000, 6);
        // l'ajout (Sell2, entré barre 3 au open 103) SURVIT au gap-stop
        expect(strategy.opentrades).toHaveLength(1);
        expect(Math.abs(strategy.opentrades[0].size)).toBe(1000);
        expect(strategy.opentrades[0].entry_price).toBe(103);
    });
});