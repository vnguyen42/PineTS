// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `PineTS.setStrictLookahead(true)`: a higher-timeframe `request.security` read with
 * lookahead on is refused unless its expression is known when the higher-timeframe
 * bar opens (`open`, `time`, `x[n]` with a literal n ≥ 1, tuples of those). The
 * expression is classified on the transpiled AST and the lookahead/timeframe at run
 * time, so source-text tricks (comments in strings, spacing, escaped quotes,
 * reassigned or shadowed timeframes, a lookahead held in a variable) cannot bypass it.
 */

import { describe, it, expect } from 'vitest';
import { PineTS, Provider, LookaheadLeakError } from 'index';

const chartStart = new Date('2018-12-15').getTime();
const chartEnd = new Date('2019-02-15').getTime();

async function run(body: string, strict = true) {
    const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, chartStart, chartEnd);
    pineTS.setStrictLookahead(strict);
    const ctx: any = await pineTS.run(`//@version=5\nindicator("strict")\n${body}\nplot(dc, "dc")\n`);
    return (ctx.plots.dc?.data ?? []).map((d: any) => d.value) as number[];
}

const ON = 'lookahead=barmerge.lookahead_on';

describe('strict lookahead', () => {
    const leaks: Record<string, string> = {
        'plain close': `dc = request.security(syminfo.tickerid, "W", close, ${ON})`,
        '`//` earlier on the line, inside a string': `dc = str.length("//") > 0 ? request.security(syminfo.tickerid, "W", close, ${ON}) : 0.0`,
        'space before the dot': `dc = request .security(syminfo.tickerid, "W", close, ${ON})`,
        'escaped quote in the expression': `dc = request.security(syminfo.tickerid, "W", close + (str.length("\\"") * 0), ${ON})`,
        'escaped quote in a later argument': `dc = request.security(syminfo.tickerid, "W", close, ${ON}, ignore_invalid_symbol=str.length("\\"") > 0)`,
        'reassigned input timeframe': `var tf = input.timeframe("D")\ntf := "W"\ndc = request.security(syminfo.tickerid, tf, close, ${ON})`,
        'conditionally reassigned input timeframe': `var tf = input.timeframe("D")\nif bar_index > 0\n    tf := "W"\ndc = request.security(syminfo.tickerid, tf, close, ${ON})`,
        'wrapper parameter shadowing a global input': `tf = input.timeframe("D")\nf(tf) => request.security(syminfo.tickerid, tf, close, ${ON})\ndc = f("W")`,
        'named lookahead held in a variable': `lk = barmerge.lookahead_on\ndc = request.security(syminfo.tickerid, "W", close, lookahead=lk)`,
        'positional lookahead held in a variable': `lk = barmerge.lookahead_on\ndc = request.security(syminfo.tickerid, "W", close, barmerge.gaps_off, lk)`,
        'function parameter named open': `g(open) => request.security(syminfo.tickerid, "W", open, ${ON})\ndc = g(close)`,
        'variable offset': `n = 0\ndc = request.security(syminfo.tickerid, "W", close[n], ${ON})`,
        'computed expression': `dc = request.security(syminfo.tickerid, "W", ta.sma(close, 2), ${ON})`,
        'tuple with an unconfirmed item': `[dc, x] = request.security(syminfo.tickerid, "W", [close[1], close], ${ON})`,
        'all arguments named': `dc = request.security(symbol=syminfo.tickerid, timeframe="W", expression=close, ${ON})`,
    };
    for (const [name, body] of Object.entries(leaks)) {
        it(`refuses: ${name}`, async () => {
            await expect(run(body)).rejects.toBeInstanceOf(LookaheadLeakError);
        });
    }

    const confirmed: Record<string, string> = {
        'close[1]': `dc = request.security(syminfo.tickerid, "W", close[1], ${ON})`,
        open: `dc = request.security(syminfo.tickerid, "W", open, ${ON})`,
        time: `dc = request.security(syminfo.tickerid, "W", time, ${ON})`,
        '[high[1], low[1]]': `[dc, lo] = request.security(syminfo.tickerid, "W", [high[1], low[1]], ${ON})`,
        'named expression=close[1]': `dc = request.security(syminfo.tickerid, "W", expression=close[1], ${ON})`,
        'wrapper with a timeframe parameter': `f(tf) => request.security(syminfo.tickerid, tf, close[1], ${ON})\ndc = f("W")`,
        'lookahead_off close': `dc = request.security(syminfo.tickerid, "W", close, lookahead=barmerge.lookahead_off)`,
        'default lookahead close': `dc = request.security(syminfo.tickerid, "W", close)`,
        'same timeframe close': `dc = request.security(syminfo.tickerid, "D", close, ${ON})`,
    };
    for (const [name, body] of Object.entries(confirmed)) {
        it(`serves the same values as without the guard: ${name}`, async () => {
            const strict = await run(body);
            expect(strict.filter(Number.isFinite).length).toBeGreaterThan(10);
            expect(strict).toEqual(await run(body, false));
        });
    }

    it('is off by default (TradingView semantics)', async () => {
        const values = await run(`dc = request.security(syminfo.tickerid, "W", close, ${ON})`, false);
        expect(values.filter(Number.isFinite).length).toBeGreaterThan(10);
    });
});

describe('request.security argument binding', () => {
    it('a named expression after positional arguments reads the expression, not the options bag', async () => {
        const named = await run('dc = request.security(syminfo.tickerid, "W", expression=close[1])');
        expect(named.filter(Number.isFinite).length).toBeGreaterThan(10);
        expect(named).toEqual(await run('dc = request.security(syminfo.tickerid, "W", close[1])'));
    });

    it('a named lookahead held in a variable applies like the literal', async () => {
        const held = await run('lk = barmerge.lookahead_on\ndc = request.security(syminfo.tickerid, "W", close[1], lookahead=lk)');
        expect(held).toEqual(await run(`dc = request.security(syminfo.tickerid, "W", close[1], ${ON})`));
        expect(held).not.toEqual(await run('dc = request.security(syminfo.tickerid, "W", close[1])'));
    });
});
