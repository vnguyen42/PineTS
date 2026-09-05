// VIN-152: public argument behavior preserved by the single-signature fast path.
import { describe, expect, it } from 'vitest';
import { parseArgsForPineParams } from '../../src/namespaces/utils';
import { Series } from '../../src/Series';

describe('VIN-152 positional and named Pine arguments', () => {
    const signature = ['id', 'qty', 'enabled'];
    const types = { id: 'string', qty: 'series', enabled: 'boolean' };
    for (const signatures of [signature, [signature]]) {
        it('keeps NaN, signed zero, and live series arguments', () => {
            for (const qty of [NaN, -0, new Series([1, 2])]) {
                const result = parseArgsForPineParams(['entry', qty, true], signatures, types);
                expect(result).toEqual({ id: 'entry', qty, enabled: true });
                expect(Object.is(result.qty, qty)).toBe(true);
            }
        });
        it('keeps the valid prefix, accepts named arguments after an invalid positional argument, and applies overrides last', () => {
            expect(parseArgsForPineParams(['entry', null, true, { qty: 7, id: 'named' }], signatures, types, { qty: 9 }))
                .toEqual({ id: 'named', qty: 9 });
        });
        it('ignores excess positional values but still consumes a later named bag', () => {
            expect(parseArgsForPineParams(['entry', 2, false, 99, { enabled: true }], signatures, types))
                .toEqual({ id: 'entry', qty: 2, enabled: true });
        });
    }
});
