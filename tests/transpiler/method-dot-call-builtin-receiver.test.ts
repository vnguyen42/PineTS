// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `x.name(…)` where `name` is a user-defined method and `x` is a built-in value
 * (array, primitive, series, function parameter, call result) runs the method like
 * its function form `name(x, …)`. It used to transpile to `x?.name?.(…)`, which the
 * built-in object does not have: the call was silently skipped.
 */

import { describe, it, expect } from 'vitest';
import { PineTS, Provider } from 'index';

const chartStart = new Date('2019-01-01').getTime();
const chartEnd = new Date('2019-01-11').getTime();

async function lastValues(body: string): Promise<Record<string, unknown>> {
    const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, chartStart, chartEnd);
    const ctx: any = await pineTS.run(`//@version=5\nindicator("dot")\n${body}`);
    return Object.fromEntries(Object.entries(ctx.plots).map(([title, plot]: [string, any]) => [title, plot.data.at(-1)?.value]));
}

const GROW = `method grow(series array<float> arr, float v) =>
    arr.push(v)
    arr
var a = array.new<float>()
`;

describe('user-defined method dot-calls on built-in receivers', () => {
    it('runs like the function form, with a qualified parameter type', async () => {
        const dot = await lastValues(`${GROW}n = a.grow(1.0).size()\nplot(a.size(), "size")\nplot(n, "n")`);
        const fn = await lastValues(`${GROW}n = grow(a, 1.0).size()\nplot(a.size(), "size")\nplot(n, "n")`);
        expect(dot.size).toBeGreaterThan(5);
        expect(dot).toEqual(fn);
    });

    it('accepts a spaced dot, chained calls and a bare statement', async () => {
        const values = await lastValues(`${GROW}a . grow(1.0)\nn = a.grow(2.0).grow(3.0).size()\nplot(n, "n")`);
        const bars = (await lastValues(`plot(bar_index + 1, "bars")`)).bars as number;
        expect(values.n).toBe(3 * bars);
    });

    it('works on a function parameter and on a built-in series', async () => {
        const values = await lastValues(`${GROW}f(array<float> q) => q.grow(1.0).size()
method twice(float x) => x * 2
plot(f(a), "n")
plot(close.twice(), "twice")
plot(close, "close")`);
        expect(values.n).toBe((await lastValues(`plot(bar_index + 1, "bars")`)).bars);
        expect(values.twice).toBe((values.close as number) * 2);
    });

    it('leaves namespace calls with the same name as a user method alone', async () => {
        const values = await lastValues(`method sum(array<float> arr) => -1.0
method sma(array<float> arr) => -1.0
b = array.from(1.0, 2.0, 4.0)
plot(array.sum(b), "sum")
plot(ta.sma(close, 3), "sma")
plot(math.sum(close, 3) / 3, "mean")`);
        expect(values.sum).toBe(7);
        expect(values.sma).toBeCloseTo(values.mean as number, 9);
    });

    it('keeps built-in methods of the receiver', async () => {
        const values = await lastValues(`${GROW}method size(map<string, float> m) => -1
a.grow(1.0)
plot(a.size(), "size")`);
        expect(values.size).toBeGreaterThan(5);
    });

    it('refuses a user method overriding a built-in method of the same receiver type', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'D', null, chartStart, chartEnd);
        const code = `//@version=5\nindicator("dot")\nmethod sum(array<float> arr) => -1.0\nb = array.from(1.0, 2.0)\nplot(b.sum())`;
        await expect(pineTS.run(code)).rejects.toThrow(/overrides the built-in `array.sum`/);
    });
});
