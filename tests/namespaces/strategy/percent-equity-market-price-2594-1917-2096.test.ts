import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { calculateOrderQty, initializeStrategy } from '../../../src/namespaces/strategy/utils';
import { StrategyState } from '../../../src/namespaces/strategy/types';

// Famille sizing percent_of_equity — révélateurs 2594 / 1917 / 2096:
// 2594 quantifie le close crypto au mintick affiché, 1917 réserve le slippage
// market dans le prix de sizing, 2096 réserve cash_per_contract par contrat.

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
        default_qty_type: 'percent_of_equity',
        default_qty_value: 100,
        ...config,
    });
    strategyOf(context).equity = 10_000;
    return context;
}

describe('percent_of_equity crypto sizing price (2594 / 1917 / 2096)', () => {
    it('2594 sizes on the displayed crypto mintick using the binary Math.round quotient', () => {
        const context = makeContext(15.5925, 0.001, 'crypto');

        entry(context)('L', 'long');

        // 15.5925 / 0.001 is 15592.499999999998 in JS, so TV sizes at 15.592.
        expect(strategyOf(context).pending_orders[0].qty).toBe(641.354);
    });

    it('1917 reserves directional slippage only for market sizing', () => {
        const market = makeContext(10, 0.01, 'spot', {
            default_qty_value: 10,
            slippage: 1,
        });
        entry(market)('market', 'long');
        expect(strategyOf(market).pending_orders[0].qty).toBe(99.9);

        const limit = makeContext(10, 0.01, 'spot', {
            default_qty_value: 10,
            slippage: 1,
        });
        entry(limit)('limit', 'long', { limit: 10 });
        expect(strategyOf(limit).pending_orders[0].qty).toBe(100);
    });

    it('2096 adds cash_per_contract to the account-currency unit cost', () => {
        const context = makeContext(0.1501, 0.0001, 'spot', {
            default_qty_value: 10,
            commission_type: 'cash_per_contract',
            commission_value: 0.1,
        });

        expect(calculateOrderQty(context, undefined, 1, 0.1501)).toBe(3998.4);
    });

    it('keeps stock market sizing unchanged instead of reserving slippage', () => {
        const context = makeContext(10, 0.01, 'stock', {
            default_qty_value: 10,
            slippage: 1,
        });

        entry(context)('L', 'long');

        expect(strategyOf(context).pending_orders[0].qty).toBe(100);
    });

    it('leaves a host-fabricated (FileProvider) crypto symbol on the raw sizing price', () => {
        const context = makeContext(15.5925, 0.001, 'crypto', { slippage: 1 }, 'FILE');

        entry(context)('L', 'long');

        // No displayed-tick snap and no slippage reserve: 10000 / 15.5925.
        expect(strategyOf(context).pending_orders[0].qty).toBe(641.333);
    });

    it('applies the rule to any exchange-resolved crypto symbol, not just Binance (2701 OKX)', () => {
        const long = makeContext(15.5925, 0.001, 'spot', {}, 'OKX');
        entry(long)('L', 'long');
        expect(strategyOf(long).pending_orders[0].qty).toBe(641.354);

        // Short sizing moves the reference DOWN by one tick (2701: 225/226
        // shorts fit the directional sign, 177/405 an always-positive one):
        // 15.590 − 0.001 = 15.589, where +0.001 would give 641.395.
        const short = makeContext(15.59, 0.001, 'spot', { slippage: 1 }, 'OKX');
        entry(short)('S', 'short');
        expect(strategyOf(short).pending_orders[0].qty).toBe(641.477);
    });

    it('sizes a declared crypto limit level at the rounded effective level (VIN-137)', () => {
        const context = makeContext(20, 0.001, 'spot');

        entry(context)('L', 'long', { limit: 15.5925 });

        // VIN-137 (proved on 1565 NYSE:BE trade 1, extended by the same
        // broker rule): TradingView sizes a price-based order against the
        // order's EFFECTIVE execution level — the level rounded to the
        // displayed mintick as recorded on the order — not the raw user
        // expression. 15.5925/0.001 is 15592.499999999998 in JS, so the
        // rounded level is 15.592 and qty = 10000/15.592 = 641.354. The raw
        // level (15.5925 → 641.333) was the pre-VIN-137 VIN-89 acted choice;
        // no discriminating TV capture exists for a crypto price-based
        // percent order (flag: L1 review may want to capture one).
        expect(strategyOf(context).pending_orders[0].qty).toBe(641.354);
    });

    it('exercises the four canonical rounding cases through the modified sizing path', () => {
        const sizedAt = (close: number, mintick: number) => {
            const context = makeContext(close, mintick, 'spot');
            entry(context)('L', 'long');
            return strategyOf(context).pending_orders[0].qty;
        };

        // 1. exactly on the grid, upstream 1-ulp noise absorbed → unchanged.
        expect(sizedAt(0.07000000000000001, 0.01)).toBe(sizedAt(0.07, 0.01));
        expect(sizedAt(0.07, 0.01)).toBe(142857.142);
        // 2. a genuine fraction rounds to the NEAREST displayed tick (0.073 →
        //    0.07: the displayed-price contract, not roundToMintick's away-
        //    from-reference contract).
        expect(sizedAt(0.073, 0.01)).toBe(142857.142);
        // 3. subtraction dust from upstream arithmetic is absorbed.
        expect(sizedAt(0.1 - 9 * 0.01, 0.01)).toBe(sizedAt(0.01, 0.01));
        expect(sizedAt(0.01, 0.01)).toBe(1_000_000);
        // 4. a sub-noise deficit still displays as the tick level (1 - 5e-10
        //    of a 1-tick grid is the tick, so the notional divides by 1).
        expect(sizedAt(1 + 5e-10, 1)).toBe(10_000);
    });
});
