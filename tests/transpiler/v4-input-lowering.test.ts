// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// V4 input() lowering — targeted tests for the version-4 pipeline
// (VIN-42 iteration 2). Convention: same as v4-legacy-lowering.test.ts —
// codegen-level assertions on pineToJS output, plus end-to-end engine runs
// for the value semantics (the runtime parseInputOptions/resolveInput path).

import { describe, it, expect } from 'vitest';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';
import { PineTS } from '../../src/PineTS.class';
import { Indicator } from '../../src/Indicator';
import { Provider } from '../../src/marketData/Provider.class';
import { Series } from '../../src/Series';

const v4 = (body: string) => `//@version=4\n${body}`;

function codeOf(body: string): string {
    const result = pineToJS(v4(body));
    if (!result.success) throw new Error(result.error);
    return result.code;
}

describe('V4 input() lowering (typed forms → input.* methods)', () => {
    it('maps type=input.integer → input.int (named type consumed)', () => {
        const code = codeOf('fast = input(title="Fast Length", type=input.integer, defval=5, minval=1)\nplot(fast)');
        expect(code).toContain('input.int({title: \'Fast Length\', defval: 5, minval: 1})');
        expect(code).not.toContain('type:');
        expect(code).not.toContain('input.integer');
    });

    it('maps the typed families per the migration table', () => {
        const table: Array<[string, string]> = [
            ['input.float', 'input.float'],
            ['input.bool', 'input.bool'],
            ['input.string', 'input.string'],
            ['input.symbol', 'input.symbol'],
            ['input.resolution', 'input.timeframe'],
            ['input.session', 'input.session'],
            ['input.source', 'input.source'],
            ['input.time', 'input.time'],
            ['input.color', 'input.color'],
        ];
        for (const [family, expected] of table) {
            const code = codeOf(`x = input(title="X", type=${family}, defval=1)\nplot(x)`);
            expect(code).toContain(`input.${expected.replace('input.', '')}({`);
            expect(code).not.toContain('type:');
            // v4 families whose v5 name differs must disappear entirely.
            if (family === 'input.resolution') expect(code).not.toContain('input.resolution');
        }
    });

    it('consumes the 3rd POSITIONAL type (v4 input(defval, title, type, ...))', () => {
        const code = codeOf('src = input(close, "Price Source", input.source, group="G")\nplot(src)');
        expect(code).toContain(`input.source(close, 'Price Source', {group: 'G'})`);
        expect(code).not.toContain('input.source,');
    });

    it('keeps positional defval/title + input.<famille> en 3e position + args nommés (forme RÉELLE du corpus : 1618/1678/1752/1794, 27 appels)', () => {
        const code = codeOf('x = input(21, "Length", input.integer, minval=1, group="G")\nplot(x)');
        expect(code).toContain(`input.int(21, 'Length', {minval: 1, group: 'G'})`);
        expect(code).not.toContain('input.integer,');
        const code2 = codeOf('s = input("SMA", "Basis Type", input.string, options=["SMA","EMA"], inline="1")\nplot(close)');
        expect(code2).toContain(`input.string('SMA', 'Basis Type', {options: ['SMA', 'EMA'], inline: '1'})`);
    });

    it('keeps options/minval/maxval/step named args (no numeric effect in this runtime, transmitted anyway)', () => {
        const code = codeOf('v = input(title="X", type=input.float, minval=0.0, step=0.1, defval=1)\nplot(v)');
        expect(code).toContain('minval: 0.0');
        expect(code).toContain('step: 0.1');
        const code2 = codeOf('s = input(defval="ema", options=["ema","sma"], title="Type", type=input.string)\nplot(close)');
        expect(code2).toContain("options: ['ema', 'sma']");
    });

    it('never emits the type= value (the v4→v5 semantic hazard is eliminated)', () => {
        // Before the fix, `input({... type: input.session ...})` compiled to a
        // ZERO-ARG `input.session()` call (value undefined) stuffed back into
        // the bag under `type`. After the fix: no bare zero-arg input.* call,
        // no `type` key anywhere in the emitted input call.
        const code = codeOf('s = input(title="S", type=input.session, defval="0915-1455", confirm=true)\nplot(close)');
        expect(code).toContain(`input.session({title: 'S', defval: '0915-1455', confirm: true})`);
        expect(code).not.toMatch(/input\.session\(\)/);
        expect(code).not.toMatch(/type:/);
    });

    it('explicit transpile error for a type= family the runtime does not implement', () => {
        const result = pineToJS(v4('x = input(1, "t", type=input.price)\nplot(x)'));
        expect(result.success).toBe(false);
        expect(String(result.error)).toContain('input.price');
    });

    it('explicit transpile error for a non input.* type= value', () => {
        const result = pineToJS(v4('x = input(1, "t", type=42)\nplot(x)'));
        expect(result.success).toBe(false);
        expect(String(result.error)).toMatch(/non input\.\*/);
    });
});

describe('V4 input() lowering (no type= → defval-lexical inference)', () => {
    it('infers int from an integer literal (raw without ./e)', () => {
        const code = codeOf('len = input(55, minval=1, title="SMA length")\nplot(len)');
        expect(code).toContain('input.int(55,');
    });

    it('infers float from a float literal (raw with ./e) — same discipline as the V4-1 RSI fix', () => {
        const code = codeOf('f = input(3.5, "Mult")\nplot(f)');
        expect(code).toContain('input.float(3.5,');
        const code2 = codeOf('x = input(1., minval=0.236)\nplot(x)');
        expect(code2).toContain('input.float(1');
        const code3 = codeOf('x = input(8.64e+7, "C")\nplot(x)');
        expect(code3).toContain('input.float(');
    });

    it('infers bool from a boolean literal', () => {
        const code = codeOf('b = input(true, "Show?")\nplot(close)');
        expect(code).toContain('input.bool(true,');
    });

    it('infers string from a string literal', () => {
        const code = codeOf('s = input("NONE", title="Type", options=["ATR", "NONE"])\nplot(close)');
        expect(code).toContain(`input.string('NONE',`);
    });

    it('infers source from a source builtin identifier', () => {
        const code = codeOf('src = input(hlc3, title="Source")\nplot(src)');
        expect(code).toContain('input.source(hlc3,');
        const code2 = codeOf('src = input(close, title="Source")\nplot(src)');
        expect(code2).toContain('input.source(close,');
    });

    it('infers string from a #RRGGBBAA literal (v4 auto-detect: string, color only via explicit type=)', () => {
        const code = codeOf('c = input(#fffff0aa, "Bg")\nplot(close)');
        expect(code).toContain(`input.string('#fffff0aa',`);
        // Le type color n'existe que par type=input.color explicite.
        const code2 = codeOf('lc = input(#ff0000, title="Line", type=input.color)\nplot(close)');
        expect(code2).toContain('input.color(\'#ff0000\',');
    });

    it('infers color from a color.* member / color.new() call', () => {
        const code = codeOf('c = input(color.black, "C")\nplot(close)');
        expect(code).toContain('input.color(color.black,');
        const code2 = codeOf('c = input(color.new(#2157f3, 80), "", inline="buy")\nplot(close)');
        expect(code2).toContain('input.color(color.new(');
    });

    it('resolves a const identifier through the declaration table', () => {
        const code = codeOf('kEma = "EMA"\nt = input(kEma, title="Type", options=["SMA","EMA"])\nplot(close)');
        expect(code).toContain('input.string(kEma,');
    });

    it('falls back to the generic input.any for statically unresolvable defvals', () => {
        // size.normal is an enum member — resolved identically by input.any.
        const code = codeOf('sz = input(size.normal, options=[size.tiny, size.normal], title="Size")\nplot(close)');
        expect(code).toContain('input.any(size.normal,');
        // Unresolved bare identifier → generic input.any (runtime-supported).
        const code2 = codeOf('x = input(unknownVar, "T")\nplot(close)');
        expect(code2).toContain('input.any(unknownVar,');
    });
});

describe('V4 input() lowering (scope discipline)', () => {
    it('does not rewrite when the user declares a variable named input', () => {
        const code = codeOf('input = 5\nx = input + 1\nplot(x)');
        expect(code).not.toContain('input.int');
        expect(code).not.toContain('input.any');
    });

    it('does not rewrite when the user declares a function named input', () => {
        const code = codeOf('input(a, b) => a + b\nx = input(1, 2)\nplot(x)');
        expect(code).toContain('function input');
        expect(code).not.toContain('input.int');
        expect(code).not.toContain('input.any');
    });

    it('leaves v6 sources untouched (v5/v6 gate — input.int stays, bare input stays bare)', () => {
        const result = pineToJS('//@version=6\nindicator("x")\nlen = input.int(14, "L", minval=1)\nv = input(14, "Bare")\nplot(len)');
        if (!result.success) throw new Error(result.error);
        expect(result.code).toContain('input.int(14,');
        expect(result.code).toContain('input(14, \'Bare\')');
    });
});

describe('V4 input() lowering (end-to-end values)', () => {
    it('returns the correct value per mapped family', async () => {
        const source = v4(`
indicator("v4 inputs")
fast = input(title="Fast Length", type=input.integer, defval=5)
mult = input(3.5, "Mult")
flag = input(true, "Flag")
label = input("NONE", title="Type", options=['ATR', 'NONE'])
sess = input(title="S", type=input.session, defval="0930-1600", confirm=true)
res = input(title="Res", type=input.resolution, defval="240")
col = input(color.black, "C")
plot(mult + 1)
plot(flag ? 1 : 0)
plot(label == "NONE" ? 1 : 0)
plot(sess == "0930-1600" ? 1 : 0)
plot(res == "240" ? 1 : 0)
plot(col == color.black ? 1 : 0)
plot(fast > 0 ? 1 : 0)
`);
        const engine = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2019-01-01').getTime(), new Date('2019-02-01').getTime());
        const context = await engine.run(source);
        const values = (i: number) => context.plots[`#${i}`].data.map((p: { value: unknown }) => p.value);
        const finite = (i: number) => values(i).filter((v: unknown) => typeof v === 'number' && Number.isFinite(v));
        expect(finite(0)[0]).toBe(4.5); // 3.5 + 1
        expect(finite(1)[0]).toBe(1); // true
        expect(finite(2)[0]).toBe(1); // "NONE" == "NONE"
        expect(finite(3)[0]).toBe(1); // session default
        expect(finite(4)[0]).toBe(1); // timeframe default
        expect(finite(5)[0]).toBe(1); // color default
        expect(finite(6)[0]).toBe(1); // integer default > 0
    });

    it('source input default resolves to the named series current-bar value', async () => {
        const source = v4(`
indicator("src")
src = input(close, title="Source")
plot(src)
`);
        const engine = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2019-01-01').getTime(), new Date('2019-02-01').getTime());
        const context = await engine.run(source);
        const data = context.plots['#0'].data.map((p: { value: unknown }) => p.value);
        // Series index 0 is the LAST bar; the plot array index 0 is the FIRST.
        const lastClose = Series.from(context.data.close).get(0);
        const lastPlot = data[data.length - 1];
        expect(typeof lastPlot).toBe('number');
        expect(Number.isFinite(lastPlot)).toBe(true);
        expect(lastPlot).toBe(lastClose);
    });
});

describe('V4 input() lowering → input.timeframe honours runtime overrides (L1 fix)', () => {
    it('v5 input.timeframe honours a varId-keyed override (runtime regression guard)', async () => {
        const source = `//@version=6
indicator("tf")
r = input.timeframe("240", "Res")
plot(r == "60" ? 1 : 0, "cmp")`;
        const ind = new Indicator(source, { r: '60' });
        const engine = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2019-01-01').getTime(), new Date('2019-02-01').getTime());
        const context = await engine.run(ind);
        const values = context.plots['cmp'].data.map((p: { value: unknown }) => p.value);
        expect(values.filter((v: unknown) => typeof v === 'number' && Number.isFinite(v)).every((v: unknown) => v === 1)).toBe(true);
    });

    it('v5 input.timeframe honours a title-keyed override (legacy path)', async () => {
        const source = `//@version=6
indicator("tf2")
r = input.timeframe("240", "Res")
plot(r == "60" ? 1 : 0, "cmp")`;
        const ind = new Indicator(source, { Res: '60' });
        const engine = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2019-01-01').getTime(), new Date('2019-02-01').getTime());
        const context = await engine.run(ind);
        const values = context.plots['cmp'].data.map((p: { value: unknown }) => p.value);
        expect(values.filter((v: unknown) => typeof v === 'number' && Number.isFinite(v)).every((v: unknown) => v === 1)).toBe(true);
    });

    it('v4 input.resolution (lowered to input.timeframe) honours a runtime override', async () => {
        const source = v4(`
indicator("tf3")
r = input(title="Res", type=input.resolution, defval="240")
plot(r == "60" ? 1 : 0, "cmp")`);
        const ind = new Indicator(source, { r: '60' });
        const engine = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2019-01-01').getTime(), new Date('2019-02-01').getTime());
        const context = await engine.run(ind);
        const values = context.plots['cmp'].data.map((p: { value: unknown }) => p.value);
        expect(values.filter((v: unknown) => typeof v === 'number' && Number.isFinite(v)).every((v: unknown) => v === 1)).toBe(true);
    });

    it('without override the v4 resolution default flows through', async () => {
        const source = v4(`
indicator("tf4")
r = input(title="Res", type=input.resolution, defval="240")
plot(r == "240" ? 1 : 0, "cmp")`);
        const engine = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2019-01-01').getTime(), new Date('2019-02-01').getTime());
        const context = await engine.run(source);
        const values = context.plots['cmp'].data.map((p: { value: unknown }) => p.value);
        expect(values.filter((v: unknown) => typeof v === 'number' && Number.isFinite(v)).every((v: unknown) => v === 1)).toBe(true);
    });
});
