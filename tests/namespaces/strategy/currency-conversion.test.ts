// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * VIN-113 — account ↔ symbol currency conversion for `strategy.cash` sizing
 * and the convert_to_* builtins.
 *
 * TV converts at the "previous daily value": the last daily FX close
 * STRICTLY BEFORE the UTC day of the sizing bar (research: 1918/1999
 * CAKEUSDT cash sizing reproduced 524/524 and 520/520 with
 * qty = floor3((50000/R(t))/close_signal), R(t) = USDT-USD close of the
 * previous UTC day, Coinbase daily candles). The rate series is host-provided
 * (`context.pine.currencyRates`), so the corpus (scanner/witness/diff-engine,
 * which provide none) keeps its exact pre-fix behavior.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import {
    calculateOrderQty,
    initializeStrategy,
} from '../../../src/namespaces/strategy/utils';
import { convertAccountToSymbol, convertSymbolToAccount } from '../../../src/namespaces/strategy/currency';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { default_entry_qty } from '../../../src/namespaces/strategy/methods/default_entry_qty';

const DAY = 24 * 60 * 60 * 1000;

function dayStartMs(iso: string): number {
    return Math.floor(Date.parse(iso) / DAY) * DAY;
}

function fxContext(rates?: Record<string, Array<[number, number]>>, opts: Record<string, unknown> = {}) {
    const context = {
        pine: { syminfo: { currency: 'USDT' }, currencyRates: rates },
        strategy: { account_currency: 'USD' },
    };
    return { context, ...opts };
}

describe('convertAccountToSymbol / convertSymbolToAccount (VIN-113)', () => {
    const d31 = dayStartMs('2023-12-31T00:00:00Z'); // 2023-12-31 00:00 UTC
    const d1 = dayStartMs('2024-01-01T00:00:00Z'); // 2024-01-01 00:00 UTC
    const d2 = dayStartMs('2024-01-02T00:00:00Z');
    const d3 = dayStartMs('2024-01-03T00:00:00Z');

    it('returns the value unchanged when currencies are equal', () => {
        const { context } = fxContext();
        context.pine.syminfo.currency = 'USD';
        expect(convertAccountToSymbol(context, 50000, d1)).toBe(50000);
        expect(convertSymbolToAccount(context, 123.45, d1)).toBe(123.45);
    });

    it('returns the value unchanged when the symbol currency is unknown', () => {
        const { context } = fxContext();
        context.pine.syminfo.currency = undefined;
        expect(convertAccountToSymbol(context, 50000, d1)).toBe(50000);
        expect(convertSymbolToAccount(context, 50000, d1)).toBe(50000);
    });

    it('converts account→symbol at F = 1/close and symbol→account at close', () => {
        const rates = { USDTUSD: [[d31, 1.0], [d2, 0.9995]] };
        const { context } = fxContext(rates);
        // Sizing bar on 2024-01-01 → previous daily close = 2023-12-31 (1.0).
        expect(convertAccountToSymbol(context, 50000, d1)).toBe(50000);
        // Sizing bar on 2024-01-03 → previous daily close = 2024-01-02 (0.9995).
        expect(convertAccountToSymbol(context, 50000, d3)).toBeCloseTo(50000 / 0.9995, 10);
        expect(convertSymbolToAccount(context, 1000, d3)).toBeCloseTo(1000 * 0.9995, 10);
    });

    it('uses the last close STRICTLY BEFORE the sizing day (previous daily value)', () => {
        const rates = { USDTUSD: [[d31, 1.0], [d1, 1.25]] }; // day D itself has an entry
        const { context } = fxContext(rates);
        // Bar on day D=2024-01-01 must use 2023-12-31 (1.0), NOT day D (1.25).
        expect(convertAccountToSymbol(context, 50000, d1)).toBe(50000);
    });

    it('crosses missing days with the last close before the gap', () => {
        const rates = { USDTUSD: [[d31, 1.5], [d3, 1.2]] }; // no entry for 01-01/01-02
        const { context } = fxContext(rates);
        expect(convertAccountToSymbol(context, 50000, d1)).toBeCloseTo(50000 / 1.5, 10);
    });

    it('falls back to the identity (cash) when the rate series is absent', () => {
        const { context } = fxContext(undefined);
        expect(convertAccountToSymbol(context, 50000, d1)).toBe(50000);
        expect(convertSymbolToAccount(context, 50000, d1)).toBe(50000);
    });

    it('falls back to NaN (convert_to_*) when the rate series is absent', () => {
        const { context } = fxContext(undefined);
        expect(Number.isNaN(convertAccountToSymbol(context, 50000, d1, 'na'))).toBe(true);
        expect(Number.isNaN(convertSymbolToAccount(context, 50000, d1, 'na'))).toBe(true);
    });

    it('keeps the identity for equal currencies even with the na fallback', () => {
        const { context } = fxContext(undefined);
        context.pine.syminfo.currency = 'USD';
        expect(convertAccountToSymbol(context, 50000, d1, 'na')).toBe(50000);
        expect(convertSymbolToAccount(context, 50000, d1, 'na')).toBe(50000);
    });
});

describe('strategy.cash sizing with currency conversion and qty step (VIN-113)', () => {
    const D = dayStartMs('2024-01-01T00:00:00Z');

    function makeCashContext(overrides: Record<string, unknown> = {}) {
        const context = new Context({
            marketData: [],
            source: [],
            tickerId: 'CAKEUSDT',
            timeframe: '60',
        });
        context.idx = 0;
        context.data.open = new Series([100]);
        context.data.high = new Series([101]);
        context.data.low = new Series([99]);
        context.data.close = new Series([100]);
        context.data.openTime = new Series([D]);
        context.pine.syminfo = { mintick: 0.001, pointvalue: 1, currency: 'USDT' };
        initializeStrategy(context, {
            default_qty_type: 'cash',
            default_qty_value: 50000,
            currency: 'USD',
            ...overrides,
        });
        return context;
    }

    it('converts the cash amount at the previous daily FX close and truncates at qtyStep', () => {
        const rates = { USDTUSD: [[D - DAY, 1.0], [D, 1.25]] };
        const context = makeCashContext({});
        context.pine.currencyRates = rates;
        context.pine.qtyStep = 0.001;
        // 2024-01-01 sizing day → strictly-before close = 2023-12-31 (1.0)
        // → converted = 50000; qty = 50000/100 = 500 → step 0.001 → 500.
        // (If the same-day close 1.25 were used, qty would be 400.)
        expect(calculateOrderQty(context, undefined, 1, 100)).toBe(500);
    });

    it('truncates the converted quantity at the qty step (floor3 on CAKEUSDT)', () => {
        const rates = { USDTUSD: [[D - DAY, 1.0005]] };
        const context = makeCashContext({});
        context.pine.currencyRates = rates;
        context.pine.qtyStep = 0.001;
        // converted = 50000 / 1.0005 = 49975.012… ; / 100 = 499.75012… → 499.75.
        const qty = calculateOrderQty(context, undefined, 1, 100);
        expect(qty).toBe(499.75);
    });

    it('keeps the six-decimal truncation when no qtyStep is provided (corpus behavior)', () => {
        const rates = { USDTUSD: [[D - DAY, 1.0005]] };
        const context = makeCashContext({});
        context.pine.currencyRates = rates;
        // No qtyStep → generic precision (floor6), still converted.
        const qty = calculateOrderQty(context, undefined, 1, 100);
        expect(qty).toBeCloseTo(Math.floor((50000 / 1.0005 / 100) * 1e6) / 1e6, 12);
    });

    it('behaves exactly as before when no rate series is provided (identity, no NaN)', () => {
        const context = makeCashContext({});
        expect(calculateOrderQty(context, undefined, 1, 100)).toBe(500);
    });

    it('sizes a real entry with cash + conversion + qtyStep end-to-end', () => {
        const rates = { USDTUSD: [[D - DAY, 1.0]] };
        const context = makeCashContext({});
        context.pine.currencyRates = rates;
        context.pine.qtyStep = 0.001;
        entry(context)('market', 'long');
        expect(context.strategy.pending_orders[0].qty).toBe(500);
    });
});

describe('strategy.percent_of_equity sizing with currency conversion (VIN-134)', () => {
    const D = dayStartMs('2024-01-01T00:00:00Z');

    function makePercentContext(overrides: Record<string, unknown> = {}) {
        const context = new Context({
            marketData: [],
            source: ['strategy("p", overlay=false, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_type=strategy.commission.percent, commission_value=0.018, currency="USD")', 'plot(close)'],
            tickerId: 'ALO',
            timeframe: '120',
        });
        context.idx = 0;
        context.data.open = new Series([31]);
        context.data.high = new Series([32]);
        context.data.low = new Series([30]);
        context.data.close = new Series([31.0277]);
        context.data.openTime = new Series([D]);
        context.pine.syminfo = { mintick: 0.005, pointvalue: 1, currency: 'EUR' };
        initializeStrategy(context, {
            default_qty_type: 'percent_of_equity',
            default_qty_value: 100,
            currency: 'USD',
            initial_capital: 100000,
            commission_type: 'percent',
            commission_value: 0.018,
            ...overrides,
        });
        return context;
    }

    it('converts the equity notional to the symbol currency before dividing by the sizing price (2577 anchor)', () => {
        // VIN-134 first TV key: 100000 USD equity, EUR symbol (ALO), sizing
        // close 31.0277, commission 0.018% → without conversion 3222 shares;
        // TradingView with the previous daily EURUSD ≈ 1.2435 → 2591 shares
        // (qty step 1 on integer-share stocks).
        const rates = { EURUSD: [[D - DAY, 1.2435]] };
        const context = makePercentContext({});
        context.pine.currencyRates = rates;
        context.pine.qtyStep = 1;
        // Not converted: floor(100000 / (31.0277 × 1.00018)) = 3222.
        expect(calculateOrderQty(context, undefined, 1, 31.0277)).toBe(2591);
    });

    it('uses the last close STRICTLY BEFORE the sizing day, not the same-day close', () => {
        // same-day 1.25 would give floor(100000/1.25/(31.0277×1.00018)) = 2577;
        // previous day 1.20 gives 2591+…: the strict-before rule picks 1.20.
        const rates = { EURUSD: [[D - DAY, 1.2], [D, 1.25]] };
        const context = makePercentContext({});
        context.pine.currencyRates = rates;
        context.pine.qtyStep = 1;
        expect(calculateOrderQty(context, undefined, 1, 31.0277)).toBe(Math.floor(100000 / (31.0277 * 1.00018 * 1.2)));
    });

    it('behaves EXACTLY as pre-VIN-134 when no rate series is provided (identity)', () => {
        const context = makePercentContext({});
        // rawQty = 100000 / (31.0277 × 1.00018) = 3222.346588… → 3222 (floor qtyStep)
        context.pine.qtyStep = 1;
        expect(calculateOrderQty(context, undefined, 1, 31.0277)).toBe(3222);
        // And the five-decimal generic truncation when no step is supplied:
        const context2 = makePercentContext({});
        expect(calculateOrderQty(context2, undefined, 1, 31.0277)).toBeCloseTo(Math.floor((100000 / (31.0277 * 1.00018)) * 1e5) / 1e5, 10);
    });

    it('propagates the conversion to strategy.default_entry_qty (single sizing point)', () => {
        const rates = { EURUSD: [[D - DAY, 1.2435]] };
        const context = makePercentContext({});
        context.pine.currencyRates = rates;
        context.pine.qtyStep = 1;
        const qty = default_entry_qty(context)(31.0277);
        expect(qty).toBe(2591);
    });
});
