// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TradingView relational tolerance — magnitude-relative, bounded.
 *
 * Values are compared as equal when `|a - b| < relationalTolerance(a, b)`.
 * The tolerance is RELATIVE at 1e-10 × max(|a|, |b|) (ten significant
 * digits) below magnitude 1, and capped at the historical absolute 1e-10
 * for magnitudes ≥ 1, so the relational helpers are never looser than the
 * pre-fix engine (no new masking at large prices).
 *
 * Ground truth (probed on TradingView):
 *   - magnitude ≈ 1: `1.0 + 5e-11 == 1.0` → true and `1.0 + 5e-10 == 1.0`
 *     → false (probed 2026-06-19, BTCUSDC 1W) — a tolerance in
 *     [5e-11, 5e-10): the 1e-10 cap satisfies it.
 *   - magnitude ≈ 6e-6 (BINANCE:BONKUSDT 60m, script 2470): a 7e-11 gap
 *     between close 0.0000059 and 0.95 × sma200 is a REAL difference on TV
 *     (order placed at bar 19407) — the relative term 1e-10 × 6e-6 ≈ 6e-16
 *     keeps it real. A fixed absolute 1e-10 swallowed it (1e-10 ≈ 1/100 of
 *     tick at BONK prices ≈ 1.7e-5 relative) → order placed one bar late.
 *   - magnitude ≥ 1: the pre-fix engine used 1e-10 absolute everywhere; the
 *     cap keeps every comparison here byte-identical to that behavior.
 *
 * At an exact 0 operand the relative term would be 0; comparisons against
 * an exact 0 keep the historical absolute 1e-10 floor instead, so values
 * that only differ from 0 by float noise (e.g. 0.3 − 0.1 − 0.2, no longer
 * absorbed by the removed 10 dp storage rounding) still compare equal.
 */
export function relationalTolerance(a: number, b: number): number {
    if (a === 0 || b === 0) return 1e-10;
    return Math.min(1e-10, 1e-10 * Math.max(Math.abs(a), Math.abs(b)));
}