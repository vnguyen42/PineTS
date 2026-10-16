// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Family: built-in namespace member as a function parameter default —
 * revealing id 1799 ("Zendog V3 DCA bot"):
 * `take_profit_price(_avg_price = strategy.position_avg_price, _pos_size =
 * strategy.position_size) => …`, called as `take_profit_price()`. The default
 * stayed a raw member read, which binds the getter FUNCTION (the same read in
 * an expression is lowered to `strategy.position_avg_price()`), so the take
 * profit price was NaN and the take-profit limit became a market order that
 * closed every deal on the next bar. A history read default
 * (`strategy.position_avg_price[1]`) is left raw: its lowering needs the call
 * context `$$`, which the parameter list cannot see.
 */

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';

const source = `//@version=5
strategy("default namespace member", initial_capital = 10000)
tp(_avg = strategy.position_avg_price, _k = 2) =>
    _avg * (1 + _k / 100)
prevAvg(_x = strategy.position_avg_price[1]) =>
    _x
float previous = prevAvg()
if bar_index == 3
    strategy.entry("L", strategy.long, qty = 1)
plot(nz(tp(), -1), "default")
plot(nz(tp(strategy.position_avg_price), -1), "explicit")
`;

describe('a namespace member default parameter is read at each call (1799)', () => {
    it('equals the explicit argument', async () => {
        const context = await new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, new Date('2019-01-01').getTime(), new Date('2019-02-01').getTime()).run(source);
        const values = (title: string) => context.plots[title].data.map((point: { value: unknown }) => point.value);
        const explicit = values('explicit');
        expect(explicit.some((value: unknown) => typeof value === 'number' && value > 0)).toBe(true);
        expect(values('default')).toEqual(explicit);
    });
});
