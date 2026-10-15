// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * STRATEGY_EQUITY_ACCOUNT_CURRENCY — revealing script 1868
 * (BINANCE:JASMYUSDT 120, strategy currency=USD on a USDT symbol).
 *
 * TradingView reports `strategy.equity` in the ACCOUNT currency: each closed
 * trade's P&L is converted at the previous UTC day's USDTUSD close (TV's
 * implied rate on 1868 matches that close on 546/551 trades). The script
 * sizes `qty = strategy.equity / close`, so the engine's symbol-currency
 * equity produced 595/602 quantities off by 1e-5..4e-5 relative. The
 * account-currency residual already existed for percent_of_equity sizing
 * (VIN-136, 1841); the script-visible equity did not include it.
 *
 * The FX series is SYNTHETIC (distinct constant daily closes, not TV
 * measurements). RED on the parent (symbol-currency equity), GREEN after.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { closePartialPosition, initializeStrategy, markToMarket, openTrade } from '../../../src/namespaces/strategy/utils';
import { equity } from '../../../src/namespaces/strategy/methods/equity';

const DAY = 24 * 60 * 60 * 1000;
const ENTRY_DAY = Date.parse('2022-01-03T00:00:00Z');
const EXIT_DAY = Date.parse('2022-01-04T00:00:00Z');
const R_ENTRY = 1.0002;
const R_EXIT = 0.9989;
const RATES = { USDTUSD: [[ENTRY_DAY - DAY, R_ENTRY], [EXIT_DAY - DAY, R_EXIT]] as Array<[number, number]> };

const INITIAL = 1000;
const QTY = 10917.03;
const ENTRY = 0.0916;
const EXIT = 0.0859;
const COMM_PCT = 0.075;

function makeContext(rates?: typeof RATES) {
    const context = new Context({ marketData: [], source: ['strategy("s")', 'plot(close)'], tickerId: 'JASMYUSDT', timeframe: '120' });
    context.idx = 0;
    context.data.open = new Series([ENTRY]);
    context.data.high = new Series([ENTRY]);
    context.data.low = new Series([ENTRY]);
    context.data.close = new Series([ENTRY]);
    context.data.openTime = new Series([ENTRY_DAY]);
    context.pine.syminfo = { mintick: 0.0001, pointvalue: 1, currency: 'USDT', type: 'spot' };
    if (rates) context.pine.currencyRates = rates;
    initializeStrategy(context, {
        initial_capital: INITIAL, currency: 'USD', commission_type: 'percent', commission_value: COMM_PCT,
    });
    openTrade(context, 'Long', 1, QTY, ENTRY, ENTRY_DAY);
    context.data.openTime = new Series([EXIT_DAY]);
    closePartialPosition(context, QTY, EXIT, EXIT_DAY, { exitId: 'x' });
    markToMarket(context, EXIT);
    return context;
}

const ENTRY_COMM = QTY * ENTRY * COMM_PCT / 100;
const EXIT_COMM = QTY * EXIT * COMM_PCT / 100;
const GROSS = (EXIT - ENTRY) * QTY;

describe('strategy.equity in the ACCOUNT currency (STRATEGY_EQUITY_ACCOUNT_CURRENCY, 1868)', () => {
    it('converts each realized leg at its previous-daily rate', () => {
        const context = makeContext(RATES);
        const expected = INITIAL - ENTRY_COMM * R_ENTRY + (GROSS - EXIT_COMM) * R_EXIT;
        expect(equity(context)()).toBeCloseTo(expected, 10);
        // Parent value: the symbol-currency equity.
        expect(Math.abs(equity(context)() - (INITIAL - ENTRY_COMM + GROSS - EXIT_COMM))).toBeGreaterThan(1e-3);
    });

    it('is unchanged without a host FX series', () => {
        const context = makeContext(undefined);
        expect(equity(context)()).toBe(context.strategy!.equity);
    });
});
