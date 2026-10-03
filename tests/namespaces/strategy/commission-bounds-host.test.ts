// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { Indicator } from '../../../src/Indicator';
import { PineTS } from '../../../src/PineTS.class';

// Host commission bounds (commission_min / commission_max_pct, set through Indicator.prop):
// broker schedules such as IBKR Pro Fixed (USD 0.005 per share, minimum USD 1 per order,
// maximum 1 % of the trade value). Expected values are IBKR's own published examples
// (https://www.interactivebrokers.com/en/pricing/commissions-stocks.php, "Fixed Examples"
// and footnote 8): 100 sh @ 25 = 1.00, 1,000 sh @ 25 = 5.00, 1,000 sh @ 0.25 = 2.50,
// 10 sh @ 0.20 = 0.02 (the maximum wins when it is below the minimum).

/** Entry submitted on bar 0, filled at bar 1's open; exit submitted on bar 1, filled at bar 2's open. */
function candles(price: number) {
    const t0 = new Date('2024-01-01T00:00:00Z').getTime();
    const DAY = 86_400_000;
    return [0, 1, 2, 3].map((i) => ({
        openTime: t0 + i * DAY,
        open: price, high: price, low: price, close: price,
        volume: 1000, closeTime: t0 + (i + 1) * DAY - 1,
    }));
}

const fixedQty = (qty: number) => `
//@version=6
strategy('bounds', overlay=true, default_qty_type=strategy.fixed, default_qty_value=${qty}, initial_capital=100000)
if bar_index == 0
    strategy.entry('long', strategy.long)
if bar_index == 1
    strategy.close('long')
plot(close)`;

async function ibkrRoundTrip(qty: number, price: number) {
    const ind = new Indicator(fixedQty(qty));
    ind.prop.commission_type = 'cash_per_contract';
    ind.prop.commission_value = 0.005;
    ind.prop.commission_min = 1;
    ind.prop.commission_max_pct = 1;
    const ctx = await new PineTS(candles(price)).run(ind);
    expect(ctx.strategy.closedtrades).toHaveLength(1);
    return ctx.strategy.closedtrades[0];
}

describe('host commission bounds (IBKR Pro Fixed published examples)', () => {
    it('charges the minimum per order when the per-share fee is below it', async () => {
        // 100 sh @ 25: 0.50 per share-fee → USD 1.00 per leg.
        expect((await ibkrRoundTrip(100, 25)).commission).toBeCloseTo(2, 10);
    });

    it('charges the per-share fee above the minimum', async () => {
        // 1,000 sh @ 25 → USD 5.00 per leg.
        expect((await ibkrRoundTrip(1000, 25)).commission).toBeCloseTo(10, 10);
    });

    it('caps the fee at the maximum percent of the trade value', async () => {
        // 1,000 sh @ 0.25: 5.00 capped at 1 % of 250 → USD 2.50 per leg.
        expect((await ibkrRoundTrip(1000, 0.25)).commission).toBeCloseTo(5, 10);
    });

    it('assesses the maximum when it is below the minimum', async () => {
        // 10 sh @ 0.20: max 1 % of 2.00 = 0.02 < minimum 1.00 → USD 0.02 per leg.
        expect((await ibkrRoundTrip(10, 0.2)).commission).toBeCloseTo(0.04, 10);
    });

    it('bounds a percent commission the same way', async () => {
        const ind = new Indicator(fixedQty(10));
        ind.prop.commission_type = 'percent';
        ind.prop.commission_value = 0.01;
        ind.prop.commission_min = 1;
        const ctx = await new PineTS(candles(100)).run(ind);
        // 0.01 % of 1,000 = 0.10 per leg → minimum 1.00 per leg.
        expect(ctx.strategy.closedtrades[0].commission).toBeCloseTo(2, 10);
    });

    it('sizes percent_of_equity so the notional plus the bounded entry fee fits the equity', async () => {
        const source = `
//@version=6
strategy('size', overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=100, initial_capital=1000, margin_long=100)
if bar_index == 0
    strategy.entry('long', strategy.long)
plot(close)`;
        const ind = new Indicator(source);
        ind.prop.commission_type = 'cash_per_contract';
        ind.prop.commission_value = 0.005;
        ind.prop.commission_min = 1;
        ind.prop.commission_max_pct = 1;
        const ctx = await new PineTS(candles(100)).run(ind);
        const [trade] = ctx.strategy.opentrades;
        // fee = max(0.005 q, 1) = 1 at q ≈ 10 → q = (1000 − 1) / 100 = 9.99, and it is not margin-called.
        expect(trade.size).toBeCloseTo(9.99, 5);
        expect(trade.commission).toBeCloseTo(1, 10);
        expect(trade.size * 100 + trade.commission).toBeLessThanOrEqual(1000 + 1e-9);
        expect(ctx.strategy.closedtrades).toHaveLength(0);
    });

    it('leaves the commission unbounded without the host props', async () => {
        const ind = new Indicator(fixedQty(100));
        ind.prop.commission_type = 'cash_per_contract';
        ind.prop.commission_value = 0.005;
        const ctx = await new PineTS(candles(25)).run(ind);
        expect(ctx.strategy.closedtrades[0].commission).toBeCloseTo(1, 10);
    });

    it('scales a per-contract fee by syminfo.mintick / commission_tick_basis (split-adjusted shares)', async () => {
        // A host serving split-adjusted bars after a 2:1 split: the bar's tick is 0.005 for a
        // 0.01 real tick, and each adjusted contract is half a real share.
        const provider = {
            configure() {},
            async getMarketData() { return candles(25); },
            async getSymbolInfo() {
                return { prefix: 'NASDAQ', ticker: 'TEST', tickerid: 'NASDAQ:TEST', type: 'stock', currency: 'USD', mintick: 0.005, pointvalue: 1, timezone: 'America/New_York', session: '24x7' };
            },
        };
        const ind = new Indicator(fixedQty(100));
        ind.prop.commission_type = 'cash_per_contract';
        ind.prop.commission_value = 0.005;
        ind.prop.commission_tick_basis = 0.01;
        const ctx = await new PineTS(provider, 'TEST', 'D').run(ind);
        // 100 adjusted contracts = 50 real shares × 0.005 per leg, two legs.
        expect(ctx.strategy.closedtrades[0].commission).toBeCloseTo(0.5, 10);
    });

    it('bounds a reversal once: the exit and entry legs of one order share one minimum', async () => {
        // Long 10 on bar 1, then a short entry of 10 reverses it on bar 2 (one order of 20 shares):
        // IBKR bills that order max(0.005 × 20, 1) = USD 1, shared 0.50 / 0.50.
        const source = `
//@version=6
strategy('rev', overlay=true, default_qty_type=strategy.fixed, default_qty_value=10, initial_capital=100000)
if bar_index == 0
    strategy.entry('L', strategy.long)
if bar_index == 1
    strategy.entry('S', strategy.short)
plot(close)`;
        const ind = new Indicator(source);
        ind.prop.commission_type = 'cash_per_contract';
        ind.prop.commission_value = 0.005;
        ind.prop.commission_min = 1;
        ind.prop.commission_max_pct = 1;
        const ctx = await new PineTS(candles(25)).run(ind);
        expect(ctx.strategy.closedtrades).toHaveLength(1);
        expect(ctx.strategy.opentrades).toHaveLength(1);
        // Long: its own entry order (USD 1) + half of the reversing order.
        expect(ctx.strategy.closedtrades[0].commission).toBeCloseTo(1.5, 10);
        expect(ctx.strategy.opentrades[0].commission).toBeCloseTo(0.5, 10);
    });

    it('bounds a close of several pyramided lots once', async () => {
        // Three entries of 5 shares (three orders, USD 1 each), one strategy.close of 15 shares (USD 1).
        const source = `
//@version=6
strategy('pyr', overlay=true, default_qty_type=strategy.fixed, default_qty_value=5, pyramiding=3, initial_capital=100000)
if bar_index <= 2
    strategy.entry('L', strategy.long)
if bar_index == 3
    strategy.close('L')
plot(close)`;
        const ind = new Indicator(source);
        ind.prop.commission_type = 'cash_per_contract';
        ind.prop.commission_value = 0.005;
        ind.prop.commission_min = 1;
        ind.prop.commission_max_pct = 1;
        const bars = [...candles(25), ...candles(25).map((bar, i) => ({ ...bar, openTime: bar.openTime + (4 + i) * 86_400_000, closeTime: bar.closeTime + (4 + i) * 86_400_000 }))];
        const ctx = await new PineTS(bars).run(ind);
        const rows = ctx.strategy.closedtrades;
        expect(rows).toHaveLength(3);
        const total = rows.reduce((sum: number, trade: { commission: number }) => sum + trade.commission, 0);
        expect(total).toBeCloseTo(4, 10);
        for (const row of rows) expect(row.commission).toBeCloseTo(1 + 1 / 3, 10);
    });

    it('charges the minimum as a flat fee per order when the rate is 0', async () => {
        const ind = new Indicator(fixedQty(100));
        ind.prop.commission_type = 'percent';
        ind.prop.commission_value = 0;
        ind.prop.commission_min = 5;
        const ctx = await new PineTS(candles(25)).run(ind);
        expect(ctx.strategy.closedtrades[0].commission).toBeCloseTo(10, 10);
    });
});
