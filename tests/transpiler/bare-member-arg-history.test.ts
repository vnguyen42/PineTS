// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * VIN-118 — bare auto-called ta members keep their per-bar history when
 * passed as arguments to history-reading builtins.
 *
 * Root cause: a bare namespace member in argument position (e.g. the
 * `ta.vwap` inside `ta.crossover(ma, ta.vwap)`) was auto-called and hoisted
 * to a raw scalar, then handed to the callee WITHOUT the namespace `param`
 * wrapping every other expression argument gets. `Series.from(number)` wraps
 * the scalar in a single-element series, so `.get(1)` is NaN and
 * `ta.crossover(ma, ta.vwap)` could never fire — while the equivalent
 * `above = ma > ta.vwap; above and not above[1]` fired hundreds of times
 * (corpus id 1861, oracle-archives/vin116-faithful/1861.md).
 *
 * Reference: the explicit call form `ta.vwap(hlc3)` (same default source),
 * which already went through the correct argument lowering. These tests were
 * red before the fix (0 crossings on the bare form, 127 on the explicit
 * form, mock 4h range) and green after: the bare form must equal the
 * explicit form bar-for-bar.
 */

import { describe, it, expect } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';

function makePineTS() {
    return new PineTS(Provider.Mock, 'BTCUSDC', '240', null,
        new Date('2024-01-01').getTime(), new Date('2024-06-01').getTime());
}

function values(plots: any, title: string): Array<string> {
    const data = plots[title]?.data ?? [];
    return data.map((entry: any) => String(entry?.value));
}

describe('VIN-118: bare auto-called ta member as history argument', () => {
    it('ta.crossover(ma, ta.vwap) equals ta.crossover(ma, ta.vwap(hlc3)) bar-for-bar', async () => {
        const pineTS = makePineTS();
        const code = `
//@version=6
indicator("VIN118 crossover")
ma = ta.sma(close, 5)
cross_bare = ta.crossover(ma, ta.vwap)
cross_expl = ta.crossover(ma, ta.vwap(hlc3))
plot(cross_bare, "CrossBare")
plot(cross_expl, "CrossExpl")
`;
        const { plots } = await pineTS.run(code);
        const bare = values(plots, 'CrossBare');
        const expl = values(plots, 'CrossExpl');
        expect(bare.length).toBeGreaterThan(100);
        expect(bare).toEqual(expl);
        // History was restored — the bare form actually fires (not both zero).
        expect(bare.filter((v) => v === 'true').length).toBeGreaterThan(50);
    });

    it('ta.crossunder(ma, ta.vwap) equals ta.crossunder(ma, ta.vwap(hlc3)) bar-for-bar', async () => {
        const pineTS = makePineTS();
        const code = `
//@version=6
indicator("VIN118 crossunder")
ma = ta.sma(close, 5)
crossdn_bare = ta.crossunder(ma, ta.vwap)
crossdn_expl = ta.crossunder(ma, ta.vwap(hlc3))
plot(crossdn_bare, "DnBare")
plot(crossdn_expl, "DnExpl")
`;
        const { plots } = await pineTS.run(code);
        const bare = values(plots, 'DnBare');
        const expl = values(plots, 'DnExpl');
        expect(bare.length).toBeGreaterThan(100);
        expect(bare).toEqual(expl);
        expect(bare.filter((v) => v === 'true').length).toBeGreaterThan(50);
    });
});
