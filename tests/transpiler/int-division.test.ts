// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pine v4/v5 integer division is a qualifier-sensitive compatibility rule:
 * only const-int / const-int truncates. Inputs and series keep their
 * fractional value, and v6 always keeps it. The old RC2b tests asserted
 * int/int truncation in v6; those expectations were intentionally replaced
 * here because they encoded the pre-fix semantics.
 */
import { describe, it, expect } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '@pinets/marketData/Provider.class';
import { transpile } from '../../src/transpiler/index';

function tj(version: number, body: string): string {
    return transpile(`//@version=${version}\nindicator("t")\n${body}`).toString();
}

const IDIV = '__idiv';

describe('Pine integer division (__idiv) — version and qualifier gate', () => {
    describe('emits __idiv only for const-int / const-int in v4 and v5', () => {
        it.each([4, 5])('v%s literal / literal', (version) => {
            expect(tj(version, 'x = 7 / 2')).toContain(IDIV);
        });

        it.each([4, 5])('v%s const expression / const expression', (version) => {
            expect(tj(version, 'a = 1\nb = 2\nx = a / (a + b)')).toContain(IDIV);
        });

        it.each([4, 5])('v%s unary-minus const literal', (version) => {
            expect(tj(version, 'x = -11 / 2')).toContain(IDIV);
        });

        it.each([4, 5])('v%s int cast of const / int cast of const', (version) => {
            expect(tj(version, 'x = int(5) / int(2)')).toContain(IDIV);
        });
        it.each([4, 5])('v%s explicit primitive annotations gate by qualifier', (version) => {
            const js = tj(version, [
                'float floatValue = 7',
                'series int seriesValue = 7',
                'simple int simpleValue = 7',
                'const int constValue = 7',
                'x = floatValue / 2 + seriesValue / 2 + simpleValue / 2 + constValue / 2',
            ].join('\n'));
            expect(js.match(new RegExp(IDIV, 'g'))?.length).toBe(1);
            expect(js).not.toContain('__pineVarType@');
        });

        it.each([4, 5])('v%s keeps same-name annotations in separate function scopes', (version) => {
            const js = tj(version, [
                'f() =>',
                '    float a = 7',
                '    a / 2',
                'g() =>',
                '    const int a = 7',
                '    a / 2',
                'x = f() + g()',
            ].join('\n'));
            expect(js.match(new RegExp(IDIV, 'g'))?.length).toBe(1);
        });

        it.each([4, 5])('v%s does not let a free-standing user string spoof metadata', (version) => {
            const js = tj(version, [
                'x = 7',
                '"__pineVarType:x=series int"',
                'y = x / 2',
            ].join('\n'));
            expect(js.match(new RegExp(IDIV, 'g'))?.length).toBe(1);
        });

        it.each([4, 5])('v%s isolates explicit const shadowing for true and false branches', (version) => {
            for (const condition of ['true', 'false']) {
                const js = tj(version, [
                    'f() =>',
                    '    float a = 7',
                    `    if ${condition}`,
                    '        if true',
                    '            const int a = 7',
                    '            inner = a / 2',
                    '    a / 2',
                    'x = f()',
                ].join('\n'));
                expect(js.match(new RegExp(IDIV, 'g'))?.length).toBe(1);
            }
        });
    });

    describe('does not emit __idiv for input, series, unknown, or non-v4/v5 values', () => {
        it.each([4, 5])('v%s input int keeps fractional division', (version) => {
            const source = version === 4 ? 'input(4)' : 'input.int(4)';
            expect(tj(version, `x = ${source} / 100`)).not.toContain(IDIV);
        });

        it.each([4, 5])('v%s input-derived denominator is not const', (version) => {
            expect(tj(version, 'length = input.int(250)\nx = 2 / (length + 1)')).not.toContain(IDIV);
        });

        it.each([4, 5])('v%s series integer builtin keeps fractional division', (version) => {
            expect(tj(version, 'x = bar_index / 2')).not.toContain(IDIV);
        });

        it.each([4, 5])('v%s reassigned integer is series-qualified', (version) => {
            expect(tj(version, 'c = 0\nc := c + 1\nx = c / 2')).not.toContain(IDIV);
        });

        it('v6 literal / literal keeps native fractional division', () => {
            expect(tj(6, 'x = 7 / 2')).not.toContain(IDIV);
        });

        it('version-less PineTS syntax keeps native division', () => {
            expect(transpile('x = 7 / 2').toString()).not.toContain(IDIV);
        });

        it.each([4, 5, 6])('v%s float / int stays native', (version) => {
            expect(tj(version, 'x = 2.5 / 2')).not.toContain(IDIV);
        });

        it.each([4, 5, 6])('v%s pivot price / int stays native', (version) => {
            expect(tj(version, 'ph = ta.pivothigh(5, 5)\nx = ph / 2')).not.toContain(IDIV);
        });

        it.each([4, 5, 6])('v%s var float reassigned from pivot stays native', (version) => {
            const js = tj(version, [
                'var float lastHigh = na',
                'ph = ta.pivothigh(5, 5)',
                'if not na(ph)',
                '    lastHigh := ph',
                'x = lastHigh / 2',
            ].join('\n'));
            expect(js).not.toContain(IDIV);
        });
    });

    describe('float-literal preservation (pine2js codegen)', () => {
        it('preserves an integer-valued float literal (2.0 stays 2.0)', () => {
            expect(tj(5, 'y = 2.0')).toContain('2.0');
        });
        it('normalizes a dot-prefix literal (.5 → 0.5)', () => {
            expect(tj(5, 'y = .5')).toContain('0.5');
        });
    });
});

describe('Pine integer division runtime values', () => {
    async function evalPine(
        version: number,
        exprs: Record<string, string>,
    ): Promise<Record<string, any>> {
        const pineTS = new PineTS(
            Provider.Mock,
            'BTCUSDC',
            '1h',
            null,
            new Date('2024-01-01').getTime(),
            new Date('2024-01-10').getTime(),
        );
        const lines = Object.entries(exprs)
            .map(([name, expression]) => `plotchar(${expression}, '${name}')`)
            .join('\n');
        const source = `//@version=${version}\nindicator("division")\n${lines}`;
        const { plots } = await pineTS.run(source);
        const out: Record<string, any> = {};
        for (const name of Object.keys(exprs)) out[name] = plots[name].data[0].value;
        return out;
    }
    async function evalAnnotated(version: number): Promise<Record<string, any>> {
        const pineTS = new PineTS(
            Provider.Mock,
            'BTCUSDC',
            '1h',
            null,
            new Date('2024-01-01').getTime(),
            new Date('2024-01-10').getTime(),
        );
        const source = `//@version=${version}
indicator("annotations")
float floatValue = 7
series int seriesValue = 7
simple int simpleValue = 7
const int constValue = 7
plotchar(floatValue / 2, "float")
plotchar(seriesValue / 2, "series")
plotchar(simpleValue / 2, "simple")
plotchar(constValue / 2, "const")`;
        const { plots } = await pineTS.run(source);
        return {
            float: plots.float.data[0].value,
            series: plots.series.data[0].value,
            simple: plots.simple.data[0].value,
            const: plots.const.data[0].value,
        };
    }


    it('v4 truncates only const-int division', async () => {
        const r = await evalPine(4, {
            constValue: '7 / 2',
            inputValue: 'input(4) / 100',
        });
        expect(r.constValue).toBe(3);
        expect(r.inputValue).toBe(0.04);
    });

    it('v5 truncates const-int division and preserves input fractions', async () => {
        const r = await evalPine(5, {
            constValue: '7 / 2',
            inputValue: 'input.int(4) / 100',
            derivedInput: '2 / (input.int(250) + 1)',
        });
        expect(r.constValue).toBe(3);
        expect(r.inputValue).toBe(0.04);
        expect(r.derivedInput).toBe(2 / 251);
    });

    it.each([4, 5])('v%s honors explicit primitive qualifiers at runtime', async (version) => {
        const r = await evalAnnotated(version);
        expect(r.float).toBe(3.5);
        expect(r.series).toBe(3.5);
        expect(r.simple).toBe(3.5);
        expect(r.const).toBe(3);
    });
    it('v6 keeps fractional const-int division', async () => {
        const r = await evalPine(6, { value: '7 / 2' });
        expect(r.value).toBe(3.5);
    });

    it('keeps float division exact and preserves div-by-zero semantics', async () => {
        const r = await evalPine(5, {
            floatValue: '11 / 2.0',
            floatProduct: '(1.0 * 5) / 2',
            infinity: '1 / 0',
            nan: '0 / 0',
        });
        expect(r.floatValue).toBe(5.5);
        expect(r.floatProduct).toBe(2.5);
        expect(r.infinity).toBe(Infinity);
        expect(Number.isNaN(r.nan)).toBe(true);
    });
});
