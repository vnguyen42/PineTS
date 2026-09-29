// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Runtime defense for script-controlled index keys. A Pine `int` is always a JS
 * number, so a string/object reaching a history/array/matrix index can only come
 * from invalid Pine the transpiler passed through (`close[k]` with k a string,
 * `array.get(a, "constructor")`, ...). The runtime helpers must reject those
 * keys with a clean TypeError before any `obj[key]` lookup — coercing them into
 * the underlying array would read inherited properties (`data["constructor"]`
 * → Array) or write arbitrary own properties (`array.set(a, "__proto__", v)`).
 */
import { describe, it, expect } from 'vitest';
import { PineTS, Provider } from 'index';

describe('non-numeric index keys are rejected at runtime', () => {
    const pineTS = new PineTS(
        Provider.Mock,
        'BTCUSDC',
        'W',
        null,
        new Date('2019-01-01').getTime(),
        new Date('2019-02-01').getTime(),
    );

    it('string-keyed history access (`close[k]` with k a string) throws a clean TypeError', async () => {
        const code = `
//@version=6
strategy("hist key")
k = "constructor"
x = close[k]
strategy.entry("L", strategy.long)
`;
        await expect(pineTS.run(code)).rejects.toThrow(/indices must be numbers/);
    });

    it('array.get with a string key throws instead of returning the Array constructor', async () => {
        const code = `
//@version=6
strategy("array key")
a = array.new<float>(3)
k = "constructor"
x = array.get(a, k)
strategy.entry("L", strategy.long)
`;
        await expect(pineTS.run(code)).rejects.toThrow(/Pine array indices must be numbers/);
    });

    it('array.set with a string key throws instead of writing a property', async () => {
        const code = `
//@version=6
strategy("array set key")
a = array.new<float>(3)
k = "__proto__"
array.set(a, k, 1.5)
strategy.entry("L", strategy.long)
`;
        await expect(pineTS.run(code)).rejects.toThrow(/Pine array indices must be numbers/);
    });

    it('array.insert / array.remove with a string key throw instead of splicing at 0', async () => {
        const code = `
//@version=6
strategy("array splice key")
a = array.new<float>(3)
k = "constructor"
array.insert(a, k, 1.5)
strategy.entry("L", strategy.long)
`;
        await expect(pineTS.run(code)).rejects.toThrow(/Pine array indices must be numbers/);

        const removeCode = `
//@version=6
strategy("array remove key")
a = array.new<float>(3)
k = "constructor"
x = array.remove(a, k)
strategy.entry("L", strategy.long)
`;
        await expect(pineTS.run(removeCode)).rejects.toThrow(/Pine array indices must be numbers/);
    });

    it('matrix.get / matrix.set with a string row throw instead of a property lookup', async () => {
        const code = `
//@version=6
strategy("matrix key")
m = matrix.new<float>(2, 2)
k = "constructor"
x = matrix.get(m, k, 0)
strategy.entry("L", strategy.long)
`;
        await expect(pineTS.run(code)).rejects.toThrow(/Pine matrix indices must be numbers/);

        const setCode = `
//@version=6
strategy("matrix set key")
m = matrix.new<float>(2, 2)
k = "constructor"
matrix.set(m, k, 0, 1.5)
strategy.entry("L", strategy.long)
`;
        await expect(pineTS.run(setCode)).rejects.toThrow(/Pine matrix indices must be numbers/);
    });

    it('valid numeric indexing — including computed ints and negative array indices — still runs', async () => {
        const code = `
//@version=6
strategy("ok indices")
src = close[1] + close[2]
a = array.new<float>(3)
array.set(a, 0, src)
array.set(a, -1, 42.0)
mid = array.get(a, 2)
m = matrix.new<float>(2, 2)
matrix.set(m, 1, 1, mid)
v = matrix.get(m, 1, 1)
if v > 0
    strategy.entry("L", strategy.long)
`;
        const { strategy } = await pineTS.run(code);
        expect(strategy).toBeDefined();
    });
});