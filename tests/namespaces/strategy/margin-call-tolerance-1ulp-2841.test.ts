// Famille : gate de marge — tolérance magnitude-relative à l'admission du
// margin call au point adverse (id révélateur 2841).
//
// MEDIUM consigné par la revue L1 du commit 6280977 (JOURNAL.md 2026-09-02) :
// le gate d'admission pre-trade de processStrategyOrders admet désormais une
// entrée dont le requiredMargin flottant dépasse l'equity d'UN ulp
// (tolérance 1e-12×max(1,|equity|), margin-gate-tolerance-1ulp-2841),
// mais processMarginCall — la contrepartie du GATE au point ADVERS du chemin
// intrabar — compare encore STRICTEMENT `equityAtAdverse < requiredMarginAtAdverse`.
// L'entrée admise à 1 ulp est donc liquidée à la barre même par un margin call
// FANTÔME : sur le scénario E2E de la revue (4 bougies plates @4882.8125,
// percent_of_equity 100 % + margin 100 %, capital 100), la quantité
// qty = trunc6(100/4882.8125) = 0.02048 a un notional EXACT de 100, mais la
// chaîne flottante de computeRequiredMargin vaut nextUp(100)
// (100.00000000000001) — strictement supérieur à l'equity au point adverse —
// et closePartialPosition rabote une fraction 4×(1 ulp)/(price) =
// 1.1641532182693481e-17 de la position : un « Margin call » fabriqué, qui
// n'existe pas chez TV (position non rabotée, trade unique 0.02048).
//
// Fix : MÊME tolérance magnitude-relative que le gate d'admission —
// déclencher le margin call seulement si
//   equityAtAdverse < requiredMarginAtAdverse − tolerance,
// tolerance = 1e-12 × max(1, |requiredMarginAtAdverse|)
// (jamais d'EPS fixe). La tolérance absorbe le bruit d'un ulp ; un DÉFICIT
// RÉEL (requiredMargin au-dessus de la tolérance) déclenche toujours la
// liquidation 4× exactement comme avant (sémantique TV conservée — ni la
// séquence de liquidation closePartialPosition / 4× cover / _mc_exit_lock,
// ni le gate d'admission ne sont touchés).
//
// La mécanique du cas 2 (déficit réel) est vérifiée numériquement par la
// sonde de la revue : short 0.02048 @4882.8125, barre adverse high 4900 →
// equity@high = 99.648, requiredMargin@high = 100.352, déficit 0.704 >> la
// tolérance 1e-10 → liquidation 4× cover = 4×0.704/4900 = 0.0005747, reste
// −0.0199053 ouvert. La tolérance ne doit RIEN changer à ce chemin.

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Kline } from '../../../src/marketData/types';
import { StrategyState } from '../../../src/namespaces/strategy/types';

const PRICE = 4882.8125;
const DAY = 86_400_000;

function candle(i: number, price = PRICE, high = price, low = price, close = price): Kline {
    return {
        openTime: i * DAY,
        open: price,
        high,
        low,
        close,
        volume: 1000,
        closeTime: i * DAY + 86_399_999,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

// Scénario exact de la revue : 4 bougies plates @4882.8125, percent_of_equity
// 100 % + margin 100 %, capital 100, entrée market à la barre 0. Le sizing
// du moteur passe par la même chaîne trunc6(equity/close) que la famille
// 2841 : qty = 0.02048, notional exact 100, requiredMargin flottant =
// nextUp(100). SANS le fix, la barre 1 liquide un margin call fantôme.
const SOURCE = `
//@version=5
strategy('MC-2841', initial_capital=100, default_qty_type=strategy.percent_of_equity, default_qty_value=100, margin_long=100, margin_short=100)
if bar_index == 0
    strategy.entry('L', strategy.long)
`;

function strategyOf(context: Awaited<ReturnType<PineTS['run']>>): StrategyState {
    if (!context.strategy) throw new Error('strategy state was not initialized');
    return context.strategy;
}

describe('margin-call-tolerance-1ulp (2841)', () => {
    it('n\'admet AUCUN margin call fantôme sur l\'entrée admise à 1 ulp (scénario E2E de la revue)', async () => {
        const candles = [0, 1, 2, 3].map((i) => candle(i));
        const strategy = strategyOf(await new PineTS(candles, 'TEST:2841', '1D').run(SOURCE));

        // La position admise par le gate (tolérance 1 ulp) ne doit PAS être
        // liquidée par le gate adverse strict : aucun trade « Margin call »,
        // trade unique 0.02048, position non rabotée.
        const marginCalls = strategy.closedtrades.filter((t) => t.exit_id === 'Margin call');
        expect(marginCalls).toHaveLength(0);
        expect(strategy.closedtrades).toHaveLength(0);
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].size).toBe(0.02048);
        expect(strategy.position_size).toBe(0.02048);
    });

    it('déclenche TOUJOURS la liquidation sur un déficit réel (> tolérance)', async () => {
        // Short 0.02048 @4882.8125, barre 1 adverse high 4900 : equity@high
        // 99.648 vs requiredMargin@high 100.352, déficit 0.704 — ordres de
        // grandeur 10⁰, très au-dessus de la tolérance 1e-10. TV liquide
        // 4×déficit/(high·1·1) = 0.0005747 au high, le reste reste ouvert.
        const candles = [
            candle(0),
            candle(1, PRICE, 4900, 4000, 4000),
            candle(2),
            candle(3),
        ];
        const srcShort = SOURCE.replace("strategy.entry('L', strategy.long)", "strategy.entry('S', strategy.short)");
        const strategy = strategyOf(await new PineTS(candles, 'TEST:2841', '1D').run(srcShort));

        expect(strategy.closedtrades).toHaveLength(1);
        const mc = strategy.closedtrades[0];
        expect(mc.exit_id).toBe('Margin call');
        // Couverture exacte 4×déficit/(high×1×1) — la liquidation n'est ni
        // atténuée ni modifiée par la tolérance.
        expect(mc.size).toBeCloseTo(-(4 * 0.704) / 4900, 9);
        expect(mc.exit_price).toBe(4900);
        expect(strategy.opentrades).toHaveLength(1);
        expect(Math.abs(strategy.position_size)).toBeCloseTo(0.02048 - (4 * 0.704) / 4900, 9);
    });

    it('ne déclenche aucun margin call sur la frontière EXACTE equity == requiredMargin (inchangé)', async () => {
        // qty 1 @ prix 100 : arithmetic exactement dyadique, equity ==
        // requiredMargin == 100 au point adverse. Le gate strict ne
        // déclenchait déjà rien (<); la tolérance ne doit pas l'inverser.
        const candles = [0, 1, 2, 3].map((i) => candle(i, 100, 100, 100, 100));
        const srcFixed = `
//@version=5
strategy('MC-2841b', initial_capital=100, default_qty_type=strategy.fixed, default_qty_value=1, margin_long=100, margin_short=100)
if bar_index == 0
    strategy.entry('L', strategy.long)
`;
        const strategy = strategyOf(await new PineTS(candles, 'TEST:2841', '1D').run(srcFixed));

        expect(strategy.closedtrades).toHaveLength(0);
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].size).toBe(1);
        expect(strategy.position_size).toBe(1);
        expect(strategy.equity).toBe(100);
    });
});