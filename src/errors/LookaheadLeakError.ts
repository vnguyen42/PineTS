// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Thrown under `PineTS.setStrictLookahead(true)` when a `request.security` call
 * reads a higher timeframe with lookahead on and its expression is not one that
 * is known when the higher-timeframe bar opens (`open`, `time`, `x[n]` with a
 * literal n ≥ 1, or a tuple of those): on historical bars it would see the
 * higher-timeframe bar's final values before they exist.
 */
export class LookaheadLeakError extends Error {
    constructor(
        public readonly symbol: string,
        public readonly timeframe: string,
    ) {
        super(
            `request.security(${symbol}, "${timeframe}") with lookahead on reads the higher-timeframe bar's future values; ` +
                'request `open`, `time` or a confirmed value `x[1]`, or use lookahead off.',
        );
        this.name = 'LookaheadLeakError';
    }
}
