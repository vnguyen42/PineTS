// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Family: entry na-qty default sizing — revealing id 2473 ("50 Pips A Day",
// `qty = useRiskMagmt ? riskBasedQty : na`, risk management off by default).
//
// TradingView: a `strategy.entry()` call uses the strategy's default quantity
// type and value unless it "specifies a non-na `qty` value" (Pine docs,
// Concepts / Strategies, "Position sizing"). The engine sized `qty = na` as a
// NaN quantity and dropped the order (VIN-103 `!(baseQty > 0)` guard): 2473 had
// 0 trades on every feed. TV report FX:EURUSD 120, 2017-01-03 → 2024-01-12:
// 2586 trades (~368 a year); the engine on the archived TV EURUSD 120 candles,
// 2020-01-07 → 2024-01-12: 0 before the fix, 1491 after (~372 a year).

import { describe, it, expect } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Provider } from '../../../src/marketData/Provider.class';

const script = (qtyArgument: string) => `//@version=5
strategy("na qty", initial_capital = 1000, default_qty_type = strategy.percent_of_equity, default_qty_value = 50)
float none = na
if bar_index % 6 == 1
    strategy.entry("L", strategy.long${qtyArgument})
if bar_index % 6 == 4
    strategy.close("L")
`;

type Trade = { size: number; entry_price: number; exit_price: number; profit: number };

async function trades(source: string): Promise<Trade[]> {
    const engine = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2019-01-01').getTime(), new Date('2019-03-01').getTime());
    const context = await engine.run(source);
    return context.strategy.closedtrades as Trade[];
}

describe('strategy.entry with qty = na uses the default sizing (2473)', () => {
    // `none` is an na-valued float variable (2473's shape); `na` is the bare
    // literal, which reaches the runtime as the na helper object, not a NaN.
    it.each([['na variable', ', qty = none'], ['bare na literal', ', qty = na']])(
        'sizes an explicit qty = na (%s) exactly like an omitted qty',
        async (_label, qtyArgument) => {
            const [omitted, explicitNa] = await Promise.all([trades(script('')), trades(script(qtyArgument))]);
            expect(omitted.length).toBeGreaterThan(5);
            expect(explicitNa.map((t) => [t.size, t.entry_price, t.exit_price, t.profit])).toEqual(
                omitted.map((t) => [t.size, t.entry_price, t.exit_price, t.profit]),
            );
        },
    );
});
