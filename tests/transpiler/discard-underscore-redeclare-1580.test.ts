// Famille : discard `_` redéclaré (FAMILLES.md #67)
// Ids révélateurs : 1580 1879 1883 2094 2696 — le codegen émettait plusieurs
// `let _` (un par déclaration de destructuring) → SyntaxError acorn à la
// re-parse ; les occurrences suivantes doivent être renommées `_$<n>`.
// Fix : fork daf737c — writeArrayPatternElements() (premier `_` conservé,
// suivants renommés via le compteur partagé).
// Motif réel : 1580/2696 déclarent `[_, X, Y] = ta.bb(...)` plusieurs fois
// dans le même scope.

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';

const runMock = async (source: string) => {
    const engine = new PineTS(
        Provider.Mock,
        'BTCUSDC',
        '60',
        null,
        new Date('2024-01-01').getTime(),
        new Date('2024-01-10').getTime()
    );
    return engine.run(source);
};

describe('discard `_` redéclaré dans un même scope', () => {
    it('multiple [_, X, Y] tuple destructures in one scope run and keep their captured values', async () => {
        const source = `//@version=5
indicator("discard underscore redeclared")
[bbMid1, bbUp1, bbLo1] = ta.bb(close, 20, 2.0)
[_, bbUp2, bbLo2] = ta.bb(close, 20, 2.0)
[kcMid1, kcUp1, kcLo1] = ta.kc(close, 20, 1.5, true)
[_, kcUp2, kcLo2] = ta.kc(close, 20, 1.5, true)
plot(bbUp1, "bbUp1")
plot(bbUp2, "bbUp2")
plot(bbLo1, "bbLo1")
plot(bbLo2, "bbLo2")
plot(kcUp1, "kcUp1")
plot(kcUp2, "kcUp2")
plot(kcLo1, "kcLo1")
plot(kcLo2, "kcLo2")
`;
        // Pre-fix, the second `[_, ...]` declaration emits a duplicate `let _`
        // in the same JS scope → SyntaxError at `new Function` → run() rejects.
        const result = await runMock(source);
        const values = (name: string) => result.plots[name].data.map((point: { value: unknown }) => point.value);
        const bbUp1 = values('bbUp1');
        const bbUp2 = values('bbUp2');
        const bbLo1 = values('bbLo1');
        const bbLo2 = values('bbLo2');
        const kcUp1 = values('kcUp1');
        const kcUp2 = values('kcUp2');
        const kcLo1 = values('kcLo1');
        const kcLo2 = values('kcLo2');

        expect(bbUp1.length).toBeGreaterThan(20);
        // Warmup passed: the destructured channels carry real values, so the
        // comparison below is not vacuous.
        expect(bbUp2.slice(25).every((v: unknown) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
        expect(kcUp2.slice(25).every((v: unknown) => typeof v === 'number' && Number.isFinite(v))).toBe(true);

        // Same call arguments → the values captured through the `_` slots must
        // match the reference tuple, bar for bar (NaN-aware, warmup included).
        for (let n = 0; n < bbUp1.length; n++) {
            expect(Object.is(bbUp2[n], bbUp1[n])).toBe(true);
            expect(Object.is(bbLo2[n], bbLo1[n])).toBe(true);
            expect(Object.is(kcUp2[n], kcUp1[n])).toBe(true);
            expect(Object.is(kcLo2[n], kcLo1[n])).toBe(true);
        }
    });
});