// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Series } from '../../Series';

/**
 * VIN-113 — account ↔ symbol currency conversion shared by the `cash`
 * sizing branch and the `strategy.convert_to_symbol` / `convert_to_account`
 * builtins (single source of truth, DRY).
 *
 * TradingView converts at the "previous daily value": the last daily FX
 * close STRICTLY BEFORE the UTC day of the sizing bar. The rate series is
 * provided by the host (provider → context.pine.currencyRates) as
 * `{ "<symbolCurrency><accountCurrency>": [[dayUtcMs, close], ...] }`,
 * sorted ascending by day (e.g. `"USDTUSD"` = USDT-USD daily close in USD).
 *
 * Conversion factors:
 *   - account → symbol: the amount is multiplied by `F = 1/close` (USD→USDT);
 *   - symbol → account: the amount is multiplied by `close` (USDT→USD).
 *
 * When the currencies are equal (or the symbol currency is unknown) the
 * value passes through unchanged. When the rate series is ABSENT the caller
 * chooses the pre-VIN-113 behavior: `'identity'` (cash sizing treats the
 * amount as symbol currency, as before) or `'na'` (convert_to_* builtins
 * return NaN, as before). A throttled warning (once per context) reports the
 * missing series so harness users notice the fallback.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcDayStartMs(timeMs: number): number {
    return Math.floor(timeMs / MS_PER_DAY) * MS_PER_DAY;
}

function warnOnce(context: any, pair: string): void {
    if (context._currencyRatesWarned) return;
    context._currencyRatesWarned = true;
    console.warn(
        `[currency] conversion needed for ${pair} but no currencyRates series was provided — falling back to pre-VIN-113 behavior`
    );
}

/**
 * Last daily close STRICTLY BEFORE the UTC day of `timeMs`, or undefined
 * when the series is missing/empty/no entry precedes that day.
 */
function previousDailyClose(context: any, pair: string, timeMs: number): number | undefined {
    const rates: Record<string, Array<[number, number]>> | undefined = context.pine?.currencyRates;
    const series = rates?.[pair];
    if (!Array.isArray(series) || series.length === 0) return undefined;
    const dayStart = utcDayStartMs(timeMs);
    // Sorted ascending — scan from the end: the first entry strictly before
    // the sizing day is the previous daily value.
    for (let i = series.length - 1; i >= 0; i--) {
        const entry = series[i];
        if (entry && entry[0] < dayStart) return entry[1];
    }
    return undefined;
}

function resolveConversion(
    context: any,
    timeMs: number,
    warnWhenNoRate = true
): { factor: number; kind: 'same' | 'converted' | 'noRate' } {
    const symCur = context.pine?.syminfo?.currency;
    const acctCur = context.strategy?.account_currency ?? 'USD';
    if (!symCur || symCur === acctCur) return { factor: 1, kind: 'same' };
    const pair = `${symCur}${acctCur}`;
    const close = previousDailyClose(context, pair, timeMs);
    if (close !== undefined && Number.isFinite(close) && close !== 0) {
        return { factor: close, kind: 'converted' };
    }
    if (warnWhenNoRate) warnOnce(context, pair);
    return { factor: 1, kind: 'noRate' };
}

/**
 * Convert a value from the ACCOUNT currency to the SYMBOL currency.
 * `noRateFallback` selects the behavior when the rate series is absent:
 * 'identity' returns the value unchanged (cash sizing pre-VIN-113), 'na'
 * returns NaN (convert_to_symbol pre-VIN-113).
 */
export function convertAccountToSymbol(context: any, value: number, timeMs: number, noRateFallback: 'identity' | 'na' = 'identity'): number {
    const { factor, kind } = resolveConversion(context, timeMs);
    if (kind === 'noRate' && noRateFallback === 'na') return NaN;
    return value / factor; // account USD → symbol USDT via F = 1/close
}

/**
 * Convert a value from the SYMBOL currency to the ACCOUNT currency.
 * Mirror of convertAccountToSymbol (factor inverted).
 */
export function convertSymbolToAccount(context: any, value: number, timeMs: number, noRateFallback: 'identity' | 'na' = 'identity'): number {
    const { factor, kind } = resolveConversion(context, timeMs);
    if (kind === 'noRate' && noRateFallback === 'na') return NaN;
    return value * factor; // symbol USDT → account USD via close
}

/**
 * VIN-136 — the ACCOUNT-currency conversion RESIDUAL of a symbol-currency
 * amount: `convertSymbolToAccount(value) − value`, i.e. what the account
 * currency adds to the raw symbol figure. Used by the percent_of_equity
 * sizing equity, which TradingView composes in the account currency while
 * the ledger keeps the symbol currency.
 *
 * Deliberately SILENT when no rate series is available: the residual is then
 * exactly 0, so the caller behaves exactly as before the conversion existed
 * and a "missing series" warning would be misinformation (the corpus scan,
 * the witnesses and diff-engine provide no series).
 */
export function symbolToAccountResidual(context: any, value: number, timeMs: number): number {
    const { factor } = resolveConversion(context, timeMs, false);
    return value * factor - value;
}

/**
 * Current bar's open time — the sizing reference used by the cash branch and
 * the convert_to_* builtins (they have no explicit time parameter).
 */
export function currentBarTimeMs(context: any): number {
    return Series.from(context.data.openTime).get(0);
}
