// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * VALUEWHEN_SOURCE_ROUNDED_10DP (corpus ids 2014/2029)
 *
 * Regression tests proving ta.valuewhen restores the memorized source value
 * bit-for-bit. The old implementation pushed the value through
 * `context.precision(result)` (10 dp), manufacturing artificial crossings at
 * equality boundaries: `1.0881399999999999` → `1.08814` made
 * `crossunder(close, valuewhen(...))` fire on the capture bar itself instead
 * of the next one.
 */

import { describe, it, expect } from 'vitest';
import { Series } from '../../../src/Series';
import { valuewhen } from '../../../src/namespaces/ta/methods/valuewhen';

const PRECISION_ROUNDING_SOURCE = 1.0881399999999999;
const PLAIN_SOURCE = 1.23456789012345;

interface State {
    idx: number;
    taState: Record<string, unknown>;
    precision(v: number): number;
}

function makeContext(idx: number): State {
    return {
        idx,
        taState: {},
        precision: (v: number) => Math.round(v * 1e10) / 1e10,
    };
}

function runValuewhen(ctx: State, condition: boolean, source: number, occurrence: number): number {
    const fn = valuewhen(ctx as any);
    return fn(
        new Series([condition], 0),
        new Series([source], 0),
        new Series([occurrence], 0),
        'test',
    ) as number;
}

describe('ta.valuewhen source passthrough (FIX-2, 2014/2029)', () => {
    it('returns the memorized source value bit-for-bit (no 10-dp rounding)', () => {
        const ctx = makeContext(1);
        // Bar 1: condition fires → memorizes the raw source value.
        const captured = runValuewhen(ctx, true, PRECISION_ROUNDING_SOURCE, 0);
        expect(captured).toBe(PRECISION_ROUNDING_SOURCE);
        // Bar 2: condition false → committed value replayed as-is.
        ctx.idx = 2; // advance the bar so the tentative state commits
        const replayed = runValuewhen(ctx, false, 1.09, 0);
        expect(replayed).toBe(PRECISION_ROUNDING_SOURCE);
        // The old 10-dp rounding would have returned 1.08814.
        expect(replayed).not.toBe(1.08814);
    });

    it('preserves exact equality at the capture boundary (no manufactured cross)', () => {
        const ctx = makeContext(1);
        const captured = runValuewhen(ctx, true, PRECISION_ROUNDING_SOURCE, 0);
        // If the close equals the captured source, the comparison must see
        // equality — not close < rounded (which fired the fake crossunder).
        expect(PRECISION_ROUNDING_SOURCE === captured).toBe(true);
    });

    it('still returns the right occurrence and plain values unchanged', () => {
        const ctx = makeContext(1);
        const occ1 = runValuewhen(ctx, true, PLAIN_SOURCE, 1);
        expect(occ1).toBeNaN(); // one occurrence only → occurrence 1 is off the list
        const occ0 = runValuewhen(ctx, true, PLAIN_SOURCE, 0);
        expect(occ0).toBe(PLAIN_SOURCE);
    });

    it('does not round non-number results (boolean/color passthrough)', () => {
        const ctx = makeContext(1);
        const fn = valuewhen(ctx as any);
        const out = fn(
            new Series([true], 0),
            new Series([true], 0),
            new Series([0], 0),
            'colorTest',
        );
        expect(out).toBe(true);
    });
});