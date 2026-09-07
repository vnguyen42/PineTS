// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { parseArgsForPineParams } from '../../utils';

/**
 * `strategy.risk` is a nested namespace with 6 setter functions that
 * configure pre-trade risk rules. Each call mutates `context.strategy.risk_rules`;
 * the actual blocking is performed by `checkRiskRules()` in utils.ts,
 * invoked before each entry fills.
 *
 * `allow_entry_in` never opens a prohibited residual: an entry in the
 * prohibited direction may still close/reduce an existing opposite
 * (allowed) position — its qty is truncated to that close leg at fill —
 * while flat or same-side positions block it entirely.
 *
 * Pine signatures:
 *   strategy.risk.allow_entry_in(value)                         → void
 *   strategy.risk.max_cons_loss_days(count, alert_message)      → void
 *   strategy.risk.max_drawdown(value, type, alert_message)      → void
 *   strategy.risk.max_intraday_filled_orders(count, alert_message) → void
 *   strategy.risk.max_intraday_loss(value, type, alert_message) → void
 *   strategy.risk.max_position_size(contracts)                  → void
 */
export function risk(context: any) {
    return {
        allow_entry_in: (value: 'long' | 'short' | 'all') => {
            if (!context.strategy) return;
            context.strategy.risk_rules.allow_entry_in = value;
        },
        max_cons_loss_days: (count: number, alert_message?: string) => {
            if (!context.strategy) return;
            context.strategy.risk_rules.max_cons_loss_days = { count, alert_message };
        },
        max_drawdown: (...args: any[]) => {
            if (!context.strategy) return;
            // VIN-168: public source 1592 supplies named value/type arguments.
            const { value, type } = parseArgsForPineParams<{ value: number; type: 'cash' | 'percent_of_equity' }>(
                args, ['value', 'type', 'alert_message'], { value: 'number', type: 'string', alert_message: 'string' },
            );
            context.strategy.risk_rules.max_drawdown = { value, type };
        },
        max_intraday_filled_orders: (count: number, alert_message?: string) => {
            if (!context.strategy) return;
            context.strategy.risk_rules.max_intraday_filled_orders = { count, alert_message };
        },
        max_intraday_loss: (...args: any[]) => {
            if (!context.strategy) return;
            // VIN-169: public source 1785 supplies named type/value arguments.
            const { value, type } = parseArgsForPineParams<{ value: number; type: 'cash' | 'percent_of_equity' }>(
                args, ['value', 'type', 'alert_message'], { value: 'number', type: 'string', alert_message: 'string' },
            );
            context.strategy.risk_rules.max_intraday_loss = { value, type };
        },
        max_position_size: (contracts: number) => {
            if (!context.strategy) return;
            context.strategy.risk_rules.max_position_size = contracts;
        },
    };
}
