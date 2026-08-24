// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { convertAccountToSymbol, currentBarTimeMs } from '../currency';

/**
 * Inverse of convert_to_account: from account currency → symbol currency.
 *
 * Pre-VIN-113 behavior (preserved when no FX rate series is provided):
 * identity passthrough when account and symbol currencies are the same
 * string, NaN when they differ. With a `currencyRates` series provided by
 * the host, the value is actually converted at the previous daily FX close
 * (see currency.ts). String equality is used, not economic equivalence — so
 * nominally pegged pairs like USDC vs USD still fall back when their
 * currency strings differ.
 */
export function convert_to_symbol(context: any) {
    return (value: number) => {
        // TV converts at the previous daily value; the sizing bar is the
        // current bar (same time reference as the cash sizing branch).
        return convertAccountToSymbol(context, value, currentBarTimeMs(context), 'na');
    };
}
