// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * EXTENDED-TICKER chart-type modifiers.
 *
 * A ticker id may carry a chart-type modifier as a `";modifier"` suffix —
 * `"BINANCE:BTCUSDT;heikinashi"`. THE CHART TYPE IS THE TICKER — the single
 * source of truth: a host runs a non-standard chart by constructing PineTS
 * with the extended ticker (`new PineTS(source, "SYM;heikinashi", …)`), and
 * everything derives from it — `chart.is_heikinashi`, the `syminfo.tickerid`
 * suffix, and `request.security` routing. In scripts, `ticker.heikinashi()`
 * appends the modifier and `ticker.standard()` strips it.
 *
 * Division of labor: bundled providers fetch the underlying STANDARD candles
 * and strip the modifier before sending it to the venue. PineTS then applies
 * the deterministic Heikin-Ashi transform when it materializes a context with
 * the `heikinashi` modifier; other modifiers remain provider-owned.
 *
 * The transform is deliberately kept beside the ticker marker so every
 * secondary context and chart context uses the same immutable candle logic.
 */

import type { Kline } from './marketData/types';

/** The modifier suffixes recognized as chart-type markers. */
const KNOWN_MODIFIERS = new Set(['heikinashi', 'standard']);

/** Split `"SYM;modifier"` into its parts. Plain symbols yield `modifier: null`. */
export function splitTickerModifier(tickerId: string): { symbol: string; modifier: string | null } {
    if (typeof tickerId !== 'string') return { symbol: tickerId, modifier: null };
    const at = tickerId.lastIndexOf(';');
    if (at <= 0 || at === tickerId.length - 1) return { symbol: tickerId, modifier: null };
    const modifier = tickerId.slice(at + 1).toLowerCase();
    if (!KNOWN_MODIFIERS.has(modifier)) return { symbol: tickerId, modifier: null };
    return { symbol: tickerId.slice(0, at), modifier };
}

/** The plain symbol with any chart-type modifier removed. */
export function stripTickerModifier(tickerId: string): string {
    return splitTickerModifier(tickerId).symbol;
}

/** Append a chart-type modifier (replacing any existing one; idempotent). */
export function withTickerModifier(tickerId: string, modifier: string): string {
    return `${stripTickerModifier(tickerId)};${modifier}`;
}

/**
 * Transform one standard candle into its Heikin-Ashi representation.
 *
 * `previous` must be the already-transformed preceding candle. The first
 * candle uses TradingView's initialization rule `(open + close) / 2`.
 * Metadata (time, volume, and provider-specific fields) is preserved.
 */
export function transformHeikinAshiCandle(
    candle: Kline,
    previous?: Pick<Kline, 'open' | 'close'>,
): Kline {
    const haClose = (candle.open + candle.high + candle.low + candle.close) / 4;
    const haOpen = previous
        ? (previous.open + previous.close) / 2
        : (candle.open + candle.close) / 2;

    return {
        ...candle,
        open: haOpen,
        close: haClose,
        high: Math.max(candle.high, haOpen, haClose),
        low: Math.min(candle.low, haOpen, haClose),
    };
}

/**
 * Transform a complete feed into Heikin-Ashi candles.
 *
 * The recurrence starts at the first available feed candle, never at a
 * visible-window boundary. The input is not mutated.
 */
export function transformHeikinAshi(candles: readonly Kline[]): Kline[] {
    const transformed: Kline[] = [];
    let previous: Pick<Kline, 'open' | 'close'> | undefined;
    for (const candle of candles) {
        const haCandle = transformHeikinAshiCandle(candle, previous);
        transformed.push(haCandle);
        previous = haCandle;
    }
    return transformed;
}
