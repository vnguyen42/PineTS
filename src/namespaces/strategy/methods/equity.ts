// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Returns the current equity (initial_capital + netprofit + openprofit).
 * Matches Pine's strategy.equity, which TradingView reports in the ACCOUNT
 * currency: the VIN-136 account-currency residual (exactly 0 without a host
 * FX series) is added to the symbol-currency equity. Revealed by
 * BINANCE:JASMYUSDT 120 (script 1868, currency=USD on a USDT symbol): its
 * `strategy.equity / close` quantities follow TV's USD equity, whose closed
 * trades are converted at the previous UTC day's USDTUSD close.
 */
export function equity(context: any) {
    return () => {
        const strategy = context.strategy;
        if (strategy?.equity == null) return strategy?.config?.initial_capital ?? 10000;
        return strategy.equity + strategy._equity_account_residual;
    };
}
