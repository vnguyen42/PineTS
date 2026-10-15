// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Family: v4 legacy call lowering — the function form `vwap(source)`.
// Revealing script: 1557 (`RSI_VWAP = rsi(vwap(close), RSI_VWAP_length)`, v4).
// The bare value `vwap` was lowered (LEGACY_VALUE_TARGETS) but the call form
// was not: the callee reached JavaScript as a free `vwap` identifier
// (ReferenceError at run time, refused by Studio's safe-script gate).

import { describe, it, expect } from 'vitest';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';

describe('v4 vwap(source) call lowering (1557)', () => {
    it('lowers the callee to ta.vwap', () => {
        const result = pineToJS('//@version=4\nstrategy("v")\nr = rsi(vwap(close), 17)\nplot(r)');
        if (!result.success) throw new Error(result.error);
        expect(result.code).toContain('ta.vwap(close)');
        expect(result.code).not.toMatch(/(?<!\.)\bvwap\(/);
    });

    it('matches the v5 ta.vwap(source) values', async () => {
        const run = (source: string) =>
            new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2019-01-01').getTime(), new Date('2019-03-01').getTime()).run(source);
        const [v4Context, v5Context] = await Promise.all([
            run('//@version=4\nstrategy("v4")\nr = rsi(vwap(close), 3)\nplot(vwap(open), "v")\nplot(r, "r")\n'),
            run('//@version=5\nstrategy("v5")\nr = ta.rsi(ta.vwap(close), 3)\nplot(ta.vwap(open), "v")\nplot(r, "r")\n'),
        ]);
        for (const name of ['v', 'r']) {
            expect(v4Context.plots[name].data.length).toBeGreaterThan(0);
            expect(v4Context.plots[name].data).toEqual(v5Context.plots[name].data);
        }
    });
});
