// SPDX-License-Identifier: AGPL-3.0-only

/**
 * namespace runtime.error (corpus 2014, 2029, 2191, 2385, 2559, 2767;
 * fork fix 325508c).
 *
 * The corpus scripts use runtime.error() to stop when their data precondition
 * is not met. The observable contract is a PineRuntimeError carrying the
 * supplied message, rather than a missing-namespace ReferenceError.
 */

import { describe, expect, it } from 'vitest';
import PineTS from '../../src/PineTS.class';

const candles = [
    {
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
        openTime: Date.UTC(2024, 0, 1),
        closeTime: Date.UTC(2024, 0, 2),
    },
];

describe('namespace runtime.error', () => {
    it('halts a Pine script with the supplied Pine runtime error', async () => {
        const pineTS = new PineTS(candles, 'TEST', 'D');
        const source = `
//@version=5
indicator("runtime error")
runtime.error("volume is unavailable")
`;

        await expect(pineTS.run(source)).rejects.toMatchObject({
            name: 'PineRuntimeError',
            method: 'runtime.error',
            message: 'volume is unavailable',
        });
    });
});
