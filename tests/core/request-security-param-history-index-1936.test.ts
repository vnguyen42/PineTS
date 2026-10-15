// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Family `request-security-param-history-index` — revealing script: TradingView
 * corpus 1936 (`getVolume(symbol, bar) => request.security(syminfo.tickerid,
 * "D", volume)[bar]`).
 *
 * The history operator on a call result unwraps a function-parameter index to
 * its current scalar (`$.get(bar, 0)`), but request.security results were
 * excluded from that unwrap, so the raw parameter Series reached `$.get` as the
 * lookback index. Before strict Pine mode this silently produced NaN; since the
 * runtime rejects non-numeric keys it throws "Pine lookback indices must be
 * numbers (got object)" on valid Pine.
 */
import { describe, it, expect } from 'vitest';
import { PineTS, Provider } from 'index';

describe('request.security(...)[param] uses the parameter value as the lookback', () => {
    const pineTS = new PineTS(
        Provider.Mock,
        'BTCUSDC',
        'W',
        null,
        new Date('2019-01-01').getTime(),
        new Date('2019-06-01').getTime(),
    );

    it('a function parameter index on a request.security result reads that many bars back', async () => {
        const code = `
//@version=5
indicator("param index on security")
getVolume(bar) =>
    request.security(syminfo.tickerid, "W", volume)[bar]
plot(getVolume(3), "viaParam")
plot(volume[3], "direct")
`;
        const { plots } = await pineTS.run(code);
        const viaParam = plots['viaParam'].data.map((d: { value: number }) => d.value);
        const direct = plots['direct'].data.map((d: { value: number }) => d.value);
        expect(direct.filter((v: number) => Number.isFinite(v)).length).toBeGreaterThan(10);
        expect(viaParam).toEqual(direct);
    });

    it('a string index on a request.security result is still rejected', async () => {
        const code = `
//@version=5
indicator("string index on security")
k = "constructor"
plot(request.security(syminfo.tickerid, "W", volume)[k])
`;
        await expect(pineTS.run(code)).rejects.toThrow(/indices must be numbers/);
    });
});
