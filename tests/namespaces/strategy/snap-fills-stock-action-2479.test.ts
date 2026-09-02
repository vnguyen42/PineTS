import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processStrategyOrders, processExitOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { order } from '../../../src/namespaces/strategy/methods/order';
import { close_all } from '../../../src/namespaces/strategy/methods/close_all';
import { Series } from '../../../src/Series';

/**
 * Famille : composition en ESPACE TICKS des fills market/GAP étendue aux
 * classes stock-like dont la règle TV est établie — ETF/funds (id
 * révélateur 2479, AMEX:SPY 60m, process_orders_on_close, slippage 1 tick,
 * pyramiding 25).
 *
 * Preuve TV établie par R3 (fit sur les ledgers TV archivés, 4525/4525
 * lignes) : fill = (Math.round(close/mintick) + slipTicks)×mintick — snap
 * AVANT slippage, en espace ticks ; DIVISION par mintick, jamais ×100.
 * Bords discriminants : close 211.605 + 1 tick → 211.62 (la composition
 * inversée rendait 211.61) ; close 203.89 + 1 tick → 203.9 exact, jamais
 * 203.89999999999998 ; close 225.515 + 1 tick → 225.52, pas 225.53.
 *
 * Avant cette itération le moteur rendait close ± 1 tick SANS snap sur
 * SPY : syminfo.type y vaut « fund » (TV symbol_resolved, repris par
 * engine-replay) ou « etf » (feed FMP du lab), et le prédicat
 * snapExecutionFills ne couvrait que stock/crypto/spot — 368 prix hors
 * grille 0.01 mesurés sur 2479 par le diagnostic R3.
 *
 * Règle étendue, identique au stock prouvé : fills MARKET et gap OHLC →
 * composition en espace ticks (base = prix pré-slippage, snap avant
 * slippage) ; stops intrabar ordinaires → niveau de déclencheur conservé ;
 * limits → prix de placement conservé.
 *
 * Re-revue (HIGH-1/HIGH-2/MEDIUM-1) :
 *  - Les SORTIES market (strategy.close / close_all / close leg) portent
 *    le prix PRÉ-slippage et composent slipTicks = −direction×slippage
 *    comme les sorties gap loss — 211.605 short close → 211.62, jamais
 *    211.61 ; 225.515 long close → 225.50, jamais 225.51.
 *  - Le prix snappé ne sort PAS du range de la barre : un buy-stop
 *    traversé au gap (open=high=102, slippage 1) remplit à 102, jamais
 *    102.01 au-dessus du high (comportement HEAD restauré).
 *  - crypto/spot conservent EXACTEMENT leur composition A héritée
 *    (81fcb5c, snap APRÈS slippage en espace prix, bruit ulp compris) :
 *    les cas connus A≡B ne l'établissent qu'à slippage 0 ; à slippage 1
 *    A/B divergent mesuré (211.605 → HEAD 211.61, B 211.62) et aucun
 *    oracle crypto à slippage ≠ 0 ne justifie de basculer.
 */
function makeContext(type: string, config: Record<string, unknown> = {}) {
    const context: any = new Context({
        marketData: [],
        source: [],
        tickerId: type.toUpperCase(),
        timeframe: '60',
    } as any);
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine = { syminfo: { mintick: 0.01, pointvalue: 1, type } } as any;
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1, ...config });
    return context;
}

function setBar(context: any, idx: number, open: number, high: number, low: number, close: number, openTime = idx * 86_400_000) {
    context.idx = idx;
    context.data.open = new Series([open, open]);
    context.data.high = new Series([high, high]);
    context.data.low = new Series([low, low]);
    context.data.close = new Series([close, close]);
    context.data.openTime = new Series([openTime, openTime]);
}

describe('stock-like (etf/fund) execution composition — market/gap fills snap in tick space before slippage (2479, R3)', () => {
    it.each(['etf', 'fund'])(
        '%s MARKET entry on the proved edge: close 225.515 + 1 tick snaps to 225.52, never 225.53',
        (type) => {
            // 2479 source: process_orders_on_close, slippage 1 tick. The
            // current-bar market entry fills at that bar's close:
            // 225.515 + 0.01 = 225.52499999999998 → round(22552.49…)=22552
            // ticks → 225.52 (division by mintick — TV rule, never ×100).
            const context = makeContext(type, { slippage: 1, process_orders_on_close: true });
            setBar(context, 1, 225.515, 225.515, 225.515, 225.515);
            entry(context)('M', 'long');
            expect(processStrategyOrders(context, 'close')).toBe(1);
            expect(context.strategy.opentrades[0].entry_price).toBe(225.52);
            expect(context.strategy.opentrades[0].entry_price).not.toBe(225.53);
        },
    );

    it.each(['etf', 'fund'])(
        '%s MARKET entry already on-grid with 1-tick slippage stays on-grid',
        (type) => {
            const context = makeContext(type, { slippage: 1, process_orders_on_close: true });
            setBar(context, 1, 225.52, 225.52, 225.52, 225.52);
            entry(context)('M', 'long');
            expect(processStrategyOrders(context, 'close')).toBe(1);
            expect(context.strategy.opentrades[0].entry_price).toBe(225.53);
        },
    );

    it.each(['etf', 'fund'])(
        '%s MARKET entry on a half-tick close: 211.605 + 1 tick snaps to 211.62, never 211.61',
        (type) => {
            // The DISCRIMINATING case of the 2479 ledger fit (R3): the
            // binary quotient 211.605/0.01 = 21160.5 rounds up to 21161,
            // then the 1 slippage tick lands on 21162 × 0.01 = 211.62 —
            // the TV record. The inverted composition
            // round((211.605 + 0.01)/0.01) returns 21161.5 → 21161 × 0.01
            // = 211.61, the pre-fix engine value. Snap BEFORE slippage is
            // what 4525/4525 ledger lines fit.
            const context = makeContext(type, { slippage: 1, process_orders_on_close: true });
            setBar(context, 1, 211.605, 211.605, 211.605, 211.605);
            entry(context)('M', 'long');
            expect(processStrategyOrders(context, 'close')).toBe(1);
            expect(context.strategy.opentrades[0].entry_price).toBe(211.62);
            expect(context.strategy.opentrades[0].entry_price).not.toBe(211.61);
        },
    );

    it.each(['etf', 'fund'])(
        '%s MARKET entry on the second half-tick close: 210.265 + 1 tick snaps to 210.28, never 210.27',
        (type) => {
            // Twin discriminant from the same 2479 fit (52 residual lines):
            // 210.265/0.01 = 21026.5 rounds up to 21027, +1 slippage tick
            // → 21028 × 0.01 = 210.28. The inverted composition returns
            // round(210.275/0.01) = round(21027.4999…) = 21027 → 210.27.
            const context = makeContext(type, { slippage: 1, process_orders_on_close: true });
            setBar(context, 1, 210.265, 210.265, 210.265, 210.265);
            entry(context)('M', 'long');
            expect(processStrategyOrders(context, 'close')).toBe(1);
            expect(context.strategy.opentrades[0].entry_price).toBe(210.28);
            expect(context.strategy.opentrades[0].entry_price).not.toBe(210.27);
        },
    );

    it.each(['etf', 'fund'])(
        '%s MARKET entry on an on-grid close stays EXACT: 203.89 + 1 tick is 203.9, never 203.89999999999998',
        (type) => {
            // Anti-noise case (R3 MEDIUM): 203.89 + 0.01 is
            // 203.89999999999998 in IEEE-754, so composing in price space
            // records a 1-ulp-noisy fill. Tick-space composition
            // (round(203.89/0.01) + 1 = 20390 ticks → 203.9) must record
            // exactly the 203.9 grid value.
            const context = makeContext(type, { slippage: 1, process_orders_on_close: true });
            setBar(context, 1, 203.89, 203.89, 203.89, 203.89);
            entry(context)('M', 'long');
            expect(processStrategyOrders(context, 'close')).toBe(1);
            expect(context.strategy.opentrades[0].entry_price).toBe(203.9);
        },
    );

    it.each(['etf', 'fund'])(
        '%s stop INTRABAR crossing keeps its trigger level (never snapped)',
        (type) => {
            // A raw off-grid stop (strategy.order does not away-round at
            // placement) crossing intrabar fills at the trigger: the snap
            // applies to MARKET and gap executions only.
            const context = makeContext(type);
            setBar(context, 0, 100, 101, 99, 100);
            order(context)({ id: 'L', direction: 'long', qty: 1, stop: 102.003 });
            setBar(context, 1, 101, 103, 100, 102);
            expect(processStrategyOrders(context)).toBe(1);
            expect(context.strategy.opentrades[0].entry_price).toBe(102.003);
        },
    );

    it.each(['etf', 'fund'])(
        '%s limit fill keeps its placement price (never snapped)',
        (type) => {
            const context = makeContext(type);
            setBar(context, 0, 100, 101, 99, 100);
            order(context)({ id: 'L', direction: 'long', qty: 1, limit: 96.005 });
            setBar(context, 1, 97, 98, 95, 96.5);
            expect(processStrategyOrders(context)).toBe(1);
            expect(context.strategy.opentrades[0].entry_price).toBe(96.005);
        },
    );

    it('crypto market entry keeps its active snap path (unchanged by the stock-like extension)', () => {
        const context = makeContext('crypto');
        setBar(context, 0, 100, 101, 99, 100);
        entry(context)('M', 'long');
        setBar(context, 1, 101.037, 102, 100.5, 101.5);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(101.04);
    });

    it('crypto market entry at slippage 1 keeps legacy composition A: 211.605 → 211.61, never 211.62', () => {
        // MEDIUM-1 invariance lock: crypto/spot must NOT move to rule B.
        // A/B HEAD vs working tree measured 9 deltas at slippage 1 (the
        // HEAD A composition gives 211.61 here, B would give 211.62) and
        // no oracle exists for crypto at slippage ≠ 0 — the test fails if
        // the crypto path changes.
        const context = makeContext('crypto', { slippage: 1, process_orders_on_close: true });
        setBar(context, 1, 211.605, 211.605, 211.605, 211.605);
        entry(context)('M', 'long');
        expect(processStrategyOrders(context, 'close')).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(211.61);
        expect(context.strategy.opentrades[0].entry_price).not.toBe(211.62);
    });

    it.each(['etf', 'fund'])(
        '%s MARKET exit (close_all) on a half-tick open: 211.605 short close → 211.62, never 211.61',
        (type) => {
            // HIGH-1: market exits must compose in tick space like the gap
            // loss exits — raw price + slipTicks = −direction×slippage. A
            // short close is a buy: +1 tick on 211.605 lands on 21162×0.01
            // = 211.62. The pre-fix composition (slipped price emitted, then
            // snap with slipTicks 0) returned round(211.615/0.01) = 21161
            // → 211.61.
            const context = makeContext(type, { slippage: 1, process_orders_on_close: true });
            setBar(context, 0, 211.605, 211.605, 211.605, 211.605);
            entry(context)('M', 'short');
            expect(processStrategyOrders(context, 'close')).toBe(1);
            expect(context.strategy.opentrades[0].entry_price).toBe(211.60);
            close_all(context)();
            setBar(context, 1, 211.605, 211.605, 211.605, 211.605);
            processExitOrders(context);
            expect(context.strategy.closedtrades[0].exit_price).toBe(211.62);
            expect(context.strategy.closedtrades[0].exit_price).not.toBe(211.61);
        },
    );

    it.each(['etf', 'fund'])(
        '%s GAP buy-stop stays clamped to the bar: open=high=102, slippage 1 → 102, never 102.01',
        (type) => {
            // HIGH-2: a buy-stop crossed at the gap fills at the open
            // (102); rule B then adds 1 slippage tick in tick space
            // (102.01) — the snapped price must NOT leave the bar range.
            // HEAD clamped the execution to [low, high] = [102, 102] before
            // snapping; the pre-fix iteration recomposed from the un-clamped
            // base and recorded 102.01 above the high.
            const context = makeContext(type, { slippage: 1 });
            setBar(context, 0, 100, 101, 99, 100);
            order(context)({ id: 'L', direction: 'long', qty: 1, stop: 102 });
            setBar(context, 1, 102, 102, 102, 102);
            expect(processStrategyOrders(context)).toBe(1);
            expect(context.strategy.opentrades[0].entry_price).toBe(102);
            expect(context.strategy.opentrades[0].entry_price).not.toBe(102.01);
        },
    );

    it('stock GAP buy-stop stays clamped to the DISPLAYED bar: open=high=102, slippage 1 → 102, never 102.01', () => {
        // HIGH-2 on the stock class: the snapped fill must stay within the
        // bar range TV evaluates triggers against (displayed OHLC). A raw
        // off-grid high (e.g. 1-5e-10 displayed as 1, vin136) must never
        // pull the snapped level below the grid.
        const context = makeContext('stock', { slippage: 1 });
        setBar(context, 0, 100, 101, 99, 100);
        order(context)({ id: 'L', direction: 'long', qty: 1, stop: 102 });
        setBar(context, 1, 102, 102, 102, 102);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.opentrades[0].entry_price).toBe(102);
        expect(context.strategy.opentrades[0].entry_price).not.toBe(102.01);
    });
});