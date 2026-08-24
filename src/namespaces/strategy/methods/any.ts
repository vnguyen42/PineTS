// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { parseStrategyOptions, initializeStrategy, unwrapSeriesConfig } from '../utils';

/**
 * Declares a strategy and initializes strategy state
 * Usage: strategy(title, overlay=false, ...)
 */
export function any(context: any) {
    return (...args: any[]) => {
        const options = parseStrategyOptions(args);

        // Initialize strategy state if not already initialized
        if (!context.strategy) {
            initializeStrategy(context, options);
        } else {
            // Update config if called again — the strategy() declaration
            // re-executes on every bar, so its args re-arrive with LIVE
            // Series wrappers (e.g. `default_qty_value=v` with `v`
            // reassigned each bar). Normalize the merged config exactly like
            // initializeStrategy does: unwrap every Series to its CURRENT
            // value at this bar, or a recalculated Pine variable re-polls
            // the config and sizing collapses — calculateOrderQty(Series)
            // → NaN → qty>0 refused (1833: 0 trades), commission_value
            // → Number(Series) → NaN P&L (2133/2135). User .prop overrides
            // re-apply on top so the same layer order holds across calls.
            context.strategy.config = unwrapSeriesConfig({ ...context.strategy.config, ...options, ...(context._propOverrides ?? {}) });
        }

        return context.strategy.config;
    };
}
