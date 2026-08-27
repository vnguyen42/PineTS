// Famille : iff retourne le wrapper Series (FAMILLES.md #77)
// Ids révélateurs : 1594 1534 (UT Bot — récursions v4 corrompues : x[1]
// retournait la VALEUR COURANTE, crossovers jamais déclenchés), 1728
// (int() sur le wrapper → crash bar 0).
// Fix : fork 33b1810 — déballage Series dans Core.iff (la valeur choisie
// d'une branche wrapper `$.param` ne doit pas fuir dans les buffers de série).
// Motif réel : le tour de coude UT Bot 1594 (`xATRTrailingStop := iff(...)`
// avec nz(x[1])), distillé dans l'invariant d'historique ci-dessous.

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Provider } from '../../src/marketData/Provider.class';

const v4 = (body: string) => `//@version=4\n${body}`;

const makePineTS = () =>
    new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2019-01-01').getTime(), new Date('2019-02-01').getTime());

describe('iff retourne le wrapper Series — invariant v4', () => {
    it('iff inside a := recursion keeps x[1] reading the previous bar value', async () => {
        // If the chosen Series wrapper leaks into the target buffer, a later
        // x[1] read re-resolves it against the param buffer rewritten by the
        // next bars. Invariant: the x[1] plot observed at bar n must equal the
        // x plot at bar n-1.
        const source = v4(`
x = 0.0
x := iff(close > nz(x[1], 0), max(nz(x[1]), close - 1), close + 1)
plot(x, "x")
plot(x[1], "x1")
`);
        const context = await makePineTS().run(source);
        const values = (name: string) => context.plots[name].data.map((point: { value: unknown }) => point.value);
        const x = values('x');
        const x1 = values('x1');
        expect(x.length).toBeGreaterThan(1);
        expect(x1[0]).toBeNaN();
        for (let n = 1; n < x.length; n++) {
            expect(x1[n]).toEqual(x[n - 1]);
        }
    });
});