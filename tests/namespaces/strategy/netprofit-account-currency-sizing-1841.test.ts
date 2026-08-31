// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * VIN-136 — percent_of_equity sizing equity is composed in the ACCOUNT
 * currency (revealing ids: 1841 BINANCE:FILUSDT 240, 1944 BINANCE:WIFUSDT 60,
 * 2645 BINANCE:ETCUSDT 120, 1648 BINANCE:ARUSDT 120 — all account USD /
 * instrument USDT).
 *
 * MECHANISM: TradingView accumulates each closed trade's realized P&L in the
 * ACCOUNT currency, converted at the previous-daily rate (VIN-113 convention)
 * of the day the leg is realized — the entry commission at its OWN entry day,
 * the gross minus the exit commission at the EXIT day. Proof (1841 idx104):
 * TV's ledger profit −9490.382 equals
 * gross×R_exit − entryComm×R_entry − exitComm×R_exit (residual 5.3e-4), and
 * NOT the unconverted −9485.103. The fork already converted the notional at
 * the entry rate, but accumulated the realized P&L in the SYMBOL currency, so
 * the sizing equity drifted by the cumulated conversion residual (1841
 * 106/1094 keys before, 1088/1094 predicted by the converted formula).
 *
 * The FX series here is SYNTHETIC (three distinct constant daily closes, no
 * TV measurement) — a constant rate ≠ 1 is enough to discriminate the
 * accumulator's currency, and three distinct rates additionally pin the
 * per-leg temporal convention.
 *
 * This test is RED on the parent commit (the sizing equity there is
 * 10000 + netprofit_symbol) and GREEN with the account-currency accumulator.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import {
    calculateOrderQty,
    closePartialPosition,
    initializeStrategy,
    markToMarket,
    openTrade,
} from '../../../src/namespaces/strategy/utils';

const DAY = 24 * 60 * 60 * 1000;

function dayStartMs(iso: string): number {
    return Math.floor(Date.parse(iso) / DAY) * DAY;
}

const ENTRY_DAY = dayStartMs('2024-01-01T00:00:00Z');
const EXIT_DAY = dayStartMs('2024-01-05T00:00:00Z');
const SIZING_DAY = dayStartMs('2024-01-09T00:00:00Z');

// Synthetic USDTUSD daily closes (NOT measurements): one strictly before each
// of the three days above, all distinct so every leg's rate is identifiable.
const R_ENTRY = 1.05;
const R_EXIT = 1.02;
const R_SIZING = 1.1;
const RATES = {
    USDTUSD: [
        [ENTRY_DAY - DAY, R_ENTRY],
        [EXIT_DAY - DAY, R_EXIT],
        [SIZING_DAY - DAY, R_SIZING],
    ] as Array<[number, number]>,
};

const INITIAL_CAPITAL = 10000;
const COMMISSION_PCT = 0.25;
const QTY_STEP = 0.001;

// Trade legs (symbol currency = USDT).
const TRADE_QTY = 100;
const ENTRY_PRICE = 100;
const EXIT_PRICE = 110;
const SIZING_PRICE = 200;

const ENTRY_COMMISSION = TRADE_QTY * ENTRY_PRICE * (COMMISSION_PCT / 100);
const EXIT_COMMISSION = TRADE_QTY * EXIT_PRICE * (COMMISSION_PCT / 100);
const GROSS = (EXIT_PRICE - ENTRY_PRICE) * TRADE_QTY;

/** netprofit as the fork reports it — SYMBOL currency (unchanged unit). */
const NETPROFIT_SYMBOL = -ENTRY_COMMISSION + (GROSS - EXIT_COMMISSION);
/** The same accumulation converted leg by leg at its own realization day. */
const NETPROFIT_ACCOUNT = -ENTRY_COMMISSION * R_ENTRY + (GROSS - EXIT_COMMISSION) * R_EXIT;

function steppedQty(equityAccount: number, rate: number): number {
    const notionalSymbol = equityAccount / rate;
    const rawQty = notionalSymbol / (SIZING_PRICE * (1 + COMMISSION_PCT / 100));
    return Math.floor(rawQty / QTY_STEP) * QTY_STEP;
}

function makeContext(rates?: typeof RATES) {
    const context = new Context({
        marketData: [],
        source: ['strategy("s")', 'plot(close)'],
        tickerId: 'FILUSDT',
        timeframe: '240',
    });
    context.idx = 0;
    context.data.open = new Series([ENTRY_PRICE]);
    context.data.high = new Series([ENTRY_PRICE]);
    context.data.low = new Series([ENTRY_PRICE]);
    context.data.close = new Series([ENTRY_PRICE]);
    context.data.openTime = new Series([ENTRY_DAY]);
    context.pine.syminfo = { mintick: 0.001, pointvalue: 1, currency: 'USDT', type: 'crypto' };
    context.pine.qtyStep = QTY_STEP;
    if (rates) context.pine.currencyRates = rates;
    initializeStrategy(context, {
        default_qty_type: 'percent_of_equity',
        default_qty_value: 100,
        currency: 'USD',
        initial_capital: INITIAL_CAPITAL,
        commission_type: 'percent',
        commission_value: COMMISSION_PCT,
    });
    return context;
}

/** One closed round-trip, then the bar clock moved to the sizing day. */
function runOneClosedTrade(context: Context) {
    openTrade(context, 'e1', 1, TRADE_QTY, ENTRY_PRICE, ENTRY_DAY);
    context.data.openTime = new Series([EXIT_DAY]);
    closePartialPosition(context, TRADE_QTY, EXIT_PRICE, EXIT_DAY, { exitId: 'x1' });
    markToMarket(context, EXIT_PRICE);
    context.data.openTime = new Series([SIZING_DAY]);
}

describe('percent_of_equity sizing equity in the ACCOUNT currency (VIN-136, 1841)', () => {
    it('accumulates the realized P&L at each leg\'s own previous-daily rate', () => {
        const context = makeContext(RATES);
        runOneClosedTrade(context);

        const qty = calculateOrderQty(context, undefined, 1, SIZING_PRICE);
        expect(qty).toBeCloseTo(steppedQty(INITIAL_CAPITAL + NETPROFIT_ACCOUNT, R_SIZING), 12);

        // RED on the parent: it sizes on the SYMBOL-currency accumulator.
        const buggy = steppedQty(INITIAL_CAPITAL + NETPROFIT_SYMBOL, R_SIZING);
        expect(Math.abs(qty - buggy)).toBeGreaterThan(QTY_STEP);

        // The reported unit is unchanged: rows and strategy.netprofit stay in
        // the SYMBOL currency (the harness comparator converts them itself).
        expect(context.strategy!.netprofit).toBeCloseTo(NETPROFIT_SYMBOL, 12);
        expect(context.strategy!.closedtrades[0].profit).toBeCloseTo(GROSS - ENTRY_COMMISSION - EXIT_COMMISSION, 12);
    });

    it('holds the OPEN mark-to-market in the account currency too', () => {
        const context = makeContext(RATES);
        openTrade(context, 'e1', 1, TRADE_QTY, ENTRY_PRICE, ENTRY_DAY);
        context.data.openTime = new Series([SIZING_DAY]);
        markToMarket(context, EXIT_PRICE);

        // Realized so far: only the entry commission (at its entry-day rate).
        // Unrealized: +1000 USDT, held at the sizing day's rate.
        const equityAccount = INITIAL_CAPITAL - ENTRY_COMMISSION * R_ENTRY + GROSS * R_SIZING;
        const qty = calculateOrderQty(context, undefined, 1, SIZING_PRICE);
        expect(qty).toBeCloseTo(steppedQty(equityAccount, R_SIZING), 12);
    });

    it('sizes on the equity and the residual of the SAME instant (frozen markToMarket)', () => {
        // A close that happens after the last markToMarket does not move
        // `strategy.equity`; its conversion residual must not move the sizing
        // equity either, otherwise the notional mixes two instants.
        const context = makeContext(RATES);
        openTrade(context, 'e1', 1, TRADE_QTY, ENTRY_PRICE, ENTRY_DAY);
        context.data.openTime = new Series([SIZING_DAY]);
        markToMarket(context, EXIT_PRICE);
        closePartialPosition(context, TRADE_QTY, EXIT_PRICE, EXIT_DAY, { exitId: 'x1' });

        const frozenEquityAccount = INITIAL_CAPITAL - ENTRY_COMMISSION * R_ENTRY + GROSS * R_SIZING;
        const qty = calculateOrderQty(context, undefined, 1, SIZING_PRICE);
        expect(qty).toBeCloseTo(steppedQty(frozenEquityAccount, R_SIZING), 12);

        // Discriminating: reading the live realized accumulator instead of the
        // snapshot would add the just-closed trade's residual at R_EXIT.
        const mixed = frozenEquityAccount + (GROSS - EXIT_COMMISSION) * (R_EXIT - 1);
        expect(Math.abs(qty - steppedQty(mixed, R_SIZING))).toBeGreaterThan(QTY_STEP);
    });

    it('is byte-identical to the pre-VIN-113 path when no FX series is provided', () => {
        // GREEN on the parent too, by contract: this is the identity guard.
        const context = makeContext(undefined);
        runOneClosedTrade(context);

        const qty = calculateOrderQty(context, undefined, 1, SIZING_PRICE);
        // Rate absent → identity fallback: exactly the pre-fix arithmetic.
        expect(qty).toBe(steppedQty(INITIAL_CAPITAL + NETPROFIT_SYMBOL, 1));
    });

    it('leaves a cash_per_order fee out of the conversion residual', () => {
        // computeLegCommission documents cash fees as ACCOUNT-currency amounts,
        // and calculateOrderQty subtracts the reserve in account space: such a
        // fee carries no conversion residual. TV's behaviour for cash fees on a
        // foreign-currency symbol is NOT proved by any capture.
        const context = makeContext(RATES);
        context.strategy!.config.commission_type = 'cash_per_order';
        context.strategy!.config.commission_value = 10;
        openTrade(context, 'e1', 1, TRADE_QTY, ENTRY_PRICE, ENTRY_DAY);
        context.data.openTime = new Series([EXIT_DAY]);
        closePartialPosition(context, TRADE_QTY, EXIT_PRICE, EXIT_DAY, { exitId: 'x1' });
        markToMarket(context, EXIT_PRICE);
        context.data.openTime = new Series([SIZING_DAY]);

        // Only the gross converts: the two 10-unit fees stay account-currency.
        // The cash_per_order reserve is subtracted in ACCOUNT space, before the
        // notional is converted to the symbol currency.
        const equityAccount = INITIAL_CAPITAL - 10 + GROSS * R_EXIT - 10;
        const rawQty = (equityAccount - 10) / R_SIZING / SIZING_PRICE;
        expect(calculateOrderQty(context, undefined, 1, SIZING_PRICE))
            .toBeCloseTo(Math.floor(rawQty / QTY_STEP) * QTY_STEP, 12);
    });
});
