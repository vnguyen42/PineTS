// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { Indicator } from '../../../src/Indicator';
import { PineTS } from '../../../src/PineTS.class';

// Host extension ISymbolInfo.backadjust_offset: on a back-adjusted continuous future the bars are
// the real prices plus the later rolls' gaps, so a percent commission is charged on the real
// notional (bar price − offset). CL1! January 2021: adjusted 2.00 for a real 50.36 (offset −48.36).

const HOUR = 3_600_000;
const t0 = Date.UTC(2021, 0, 5, 0);
const bars = [0, 1, 2, 3].map((i) => ({
    openTime: t0 + i * HOUR,
    closeTime: t0 + (i + 1) * HOUR,
    open: 2, high: 2, low: 2, close: 2, volume: 1,
}));

function provider(offset: number) {
    return {
        configure() {},
        async getMarketData() {
            return bars.map((bar) => ({ ...bar }));
        },
        async getSymbolInfo(ticker: string) {
            const info = {
                ticker: 'CL1!', tickerid: ticker, prefix: 'NYMEX', type: 'futures', currency: 'USD',
                timezone: 'America/New_York', session: '1800-1700', mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1000,
            };
            // A getter, as hosts set it (read at each fill).
            Object.defineProperty(info, 'backadjust_offset', { get: () => offset, enumerable: true });
            return info;
        },
    };
}

const roundTrip = `
//@version=6
strategy('legs', overlay=true, default_qty_type=strategy.fixed, default_qty_value=1, initial_capital=100000, margin_long=0)
if bar_index == 0
    strategy.entry('long', strategy.long)
if bar_index == 1
    strategy.close('long')
plot(close)`;

async function roundTripTrade(offset: number, maxPct = 0) {
    const ind = new Indicator(roundTrip);
    ind.prop.commission_type = 'percent';
    ind.prop.commission_value = 0.1;
    ind.prop.commission_max_pct = maxPct;
    const ctx = await new PineTS(provider(offset) as never, 'NYMEX:CL1!', '60').run(ind);
    expect(ctx.strategy.closedtrades).toHaveLength(1);
    return ctx.strategy.closedtrades[0];
}

describe('percent commission on a back-adjusted future (backadjust_offset)', () => {
    it('charges the bar notional without an offset', async () => {
        // 0.1 % of 2.00 × 1000 per leg.
        expect((await roundTripTrade(0)).commission).toBeCloseTo(4, 10);
    });

    it('charges the real notional, bar price minus the offset', async () => {
        // 0.1 % of (2.00 + 48.36) × 1000 = 50.36 per leg; flat bars, so the P&L is the fees.
        const trade = await roundTripTrade(-48.36);
        expect(trade.commission).toBeCloseTo(100.72, 10);
        expect(trade.profit).toBeCloseTo(-100.72, 10);
    });

    it('bounds the maximum on the real notional too', async () => {
        // 0.1 % capped at 0.05 % of the real 50,360 = 25.18 per leg.
        expect((await roundTripTrade(-48.36, 0.05)).commission).toBeCloseTo(50.36, 10);
    });
});
