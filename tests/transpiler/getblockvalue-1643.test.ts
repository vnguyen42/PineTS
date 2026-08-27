// Famille : getBlockValue (FAMILLES.md #76)
// Id révélateur : 1643 — 0 trades avant fix
// Fix : fork 196776c — la valeur d'une branche if/switch dont l'énoncé final
// est une VariableDeclaration retourne l'INITIALISEUR (fallback identifiant
// sans init), plus l'identifiant qui générait des self-reads `x = cond ? x : x`.

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

const plotValues = (result: { plots: Record<string, { data: Array<{ value: unknown }> }> }, name: string): unknown[] =>
    result.plots[name].data.map((point) => point.value);

describe('getBlockValue — branche if/switch à déclaration finale', () => {
    it('if-branch final `x = a` returns the initializer a, not a self-read of x', async () => {
        const source = `//@version=5
indicator("branch initializer")
cond = bar_index % 2 == 0
a = 10.0
b = 20.0
x = if cond
    x = a
else
    x = b
plot(x, "x")
`;
        // Pre-fix, getBlockValue returned the identifier → `x = cond ? x : x` :
        // a self-read of an unset series reproduces na/undefined on every bar.
        const result = await runMock(source);
        const values = plotValues(result, 'x');
        expect(values.slice(0, 6)).toEqual([10, 20, 10, 20, 10, 20]);
    });

    it('switch-case final `x = 10.0` returns the initializer, not the identifier', async () => {
        const source = `//@version=5
indicator("switch initializer")
mode = bar_index % 2
x = switch mode
    0 =>
        x = 10.0
    =>
        x = 20.0
plot(x, "x")
`;
        // Same contract through the switch path (196776c covers if ET switch).
        const result = await runMock(source);
        const values = plotValues(result, 'x');
        expect(values.slice(0, 6)).toEqual([10, 20, 10, 20, 10, 20]);
    });
});