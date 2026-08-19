// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/** TradingView's implicit strategy margin: v5 and earlier use 0%; v6+ uses 100%. */
export function defaultStrategyMargin(pineVersion: number | null): number {
    return pineVersion !== null && pineVersion >= 6 ? 100 : 0;
}
