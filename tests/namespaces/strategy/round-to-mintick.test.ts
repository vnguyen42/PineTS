import { describe, expect, it } from 'vitest';
import { roundToMintick } from '../../../src/namespaces/strategy/utils';

/**
 * VIN-100 — roundToMintick snaps to the NEAREST tick within a
 * magnitude-relative epsilon (1e-12 × max(1, |price|)) BEFORE the away
 * rounding, never a fixed EPS on the quotient.
 *
 * The four canonical cases (HARNESS.md, reviewers rule — VIN-86 burned three
 * review passes on this family):
 *   1. a value exactly on the grid stays UNCHANGED (0.07/0.01 → 0.07, the
 *      float noise 7.000000000000001 absorbed);
 *   2. a real fraction rounds away from the reference (0.073 → 0.08);
 *   3. upstream subtraction noise is absorbed (0.1 − 9×0.01 → 0.01);
 *   4. a sub-noise fraction is PRESERVED and rounds away (5e-10 with mintick
 *      1 above reference 0 → 1, not −0).
 */
describe('strategy roundToMintick — nearest-tick snap (VIN-100)', () => {
    it('case 1: an exactly-on-grid value stays unchanged (float noise absorbed)', () => {
        expect(roundToMintick(0.07, 0, 0.01)).toBe(0.07);
        expect(roundToMintick(0.07000000000000001, 0, 0.01)).toBe(0.07);
        expect(roundToMintick(4188.45, 4184, 0.01)).toBe(4188.45);
    });

    it('case 2: a real fraction rounds AWAY from the reference price', () => {
        // Buy stop above current → ceil.
        expect(roundToMintick(0.073, 0, 0.01)).toBe(0.08);
        expect(roundToMintick(4188.4541, 4184, 0.01)).toBe(4188.46);
        // Sell stop below current → floor.
        expect(roundToMintick(0.077, 1, 0.01)).toBe(0.07);
    });

    it('case 3: upstream subtraction noise is absorbed', () => {
        expect(roundToMintick(0.1 - 9 * 0.01, 0, 0.01)).toBe(0.01);
    });

    it('case 4: a sub-noise fraction is PRESERVED and rounds away (not -0)', () => {
        // 5e-10 is far below any grid epsilon for |price| ~ 1: it must round
        // UP from reference 0 to a full tick, not collapse to 0 / -0.
        expect(roundToMintick(5e-10, 0, 1)).toBe(1);
        expect(Object.is(roundToMintick(5e-10, 0, 1), -0)).toBe(false);
    });

    it('defensive: mintick 0 / non-finite price pass through', () => {
        expect(roundToMintick(123, 100, 0)).toBe(123);
        expect(Number.isNaN(roundToMintick(NaN, 100, 0.01))).toBe(true);
    });
});
