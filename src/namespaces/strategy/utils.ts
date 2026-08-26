// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Order, StrategyState, Trade } from './types';
import { Series } from '../../Series';
import { defaultStrategyMargin } from './defaults';
import { convertAccountToSymbol, currentBarTimeMs } from './currency';

/**
 * Parse strategy() function arguments
 */
export function parseStrategyOptions(args: any[]): any {
    // Pine v5/v6 strategy() signature:
    //   strategy(title, shorttitle, overlay, format, precision, scale,
    //            pyramiding, calc_on_order_fills, ...)
    // The transpiler emits leading POSITIONAL strings (title, optionally
    // shorttitle) followed by a trailing object with all named args.
    // Three input shapes show up in practice:
    //   1. strategy("title")                       — title only
    //   2. strategy("title", { opts })             — title + named args
    //   3. strategy("title", "shorttitle", {opts}) — Pine v6 with shorttitle
    // The original implementation handled #1 and #2 but DROPPED the
    // trailing options object in #3 (returning only { title }), which
    // silently lost commission_type, commission_value, overlay, and every
    // other named arg.
    if (args.length === 0) return {};

    // If first arg is itself an object, treat it as the whole options bag.
    if (typeof args[0] === 'object' && args[0] !== null) {
        return args[0];
    }

    const options: any = {};
    if (typeof args[0] === 'string') options.title = args[0];

    // Walk remaining args. Strings are positional (so far only shorttitle
    // is observed in this position). The LAST object encountered is the
    // named-args bundle — its keys win over positional fields if there's
    // overlap (matching Pine's behavior of named args overriding positional).
    let trailingOptions: any = null;
    for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (typeof a === 'string') {
            // Currently only shorttitle slots in as a positional string.
            // If future Pine versions add more positional strings, extend
            // here.
            if (options.shorttitle === undefined) options.shorttitle = a;
        } else if (typeof a === 'object' && a !== null) {
            trailingOptions = a;
        }
    }
    if (trailingOptions) Object.assign(options, trailingOptions);
    return options;
}

/**
 * Round a stop/limit price to the symbol's mintick grid, AWAY from the
 * reference price (typically the current bar's close at order placement).
 *
 * Pine's broker emulator places stop/limit orders on the mintick grid
 * conservatively — a buy stop at 4188.4541 above current 4184 becomes
 * 4188.46 (ceiling), not 4188.45. This makes the order trigger LATER
 * (requires more price movement), mirroring real-broker order placement.
 *
 * The rule:
 *   price > referencePrice → ceil to mintick (push price UP)
 *   price < referencePrice → floor to mintick (push price DOWN)
 *   price === referencePrice → return as-is
 *
 * `rounding` overrides the reference direction for exit levels whose
 * broker-side direction is known: `up` uses ceil and `down` uses floor.
 *
 * For mintick === 0 or undefined (defensive), returns the price unchanged.
 * A non-finite mintick (NaN, ±Infinity — e.g. invalid symbol metadata where
 * minmove/pricescale resolve to 0) also returns the price unchanged instead
 * of letting 0 × Infinity corrupt the rounding into NaN.
 */
export function roundToMintick(
    price: number,
    referencePrice: number,
    mintick: number,
    rounding?: 'up' | 'down',
): number {
    if (!Number.isFinite(mintick) || mintick <= 0 || !Number.isFinite(price)) return price;
    if (rounding === undefined && price === referencePrice) return price;
    const ticks = price / mintick;
    // Snap to the NEAREST tick when the price sits within a
    // magnitude-relative epsilon of the grid (absorbs upstream float noise
    // such as 0.1 - 9×0.01 → 0.01, or 0.07 with 1-ulp error). The epsilon
    // scales with the price magnitude, never with the quotient: a genuine
    // sub-noise fraction must round AWAY from the reference price instead of
    // collapsing to 0/-0 (5e-10 with mintick 1 above reference 0 → 1, not -0).
    const nearestTicks = Math.round(ticks);
    const snapEps = 1e-12 * Math.max(1, Math.abs(price));
    if (Math.abs(price - nearestTicks * mintick) <= snapEps) return nearestTicks * mintick;
    if (rounding === 'up') return Math.ceil(ticks) * mintick;
    if (rounding === 'down') return Math.floor(ticks) * mintick;
    return price > referencePrice ? Math.ceil(ticks) * mintick : Math.floor(ticks) * mintick;
}
/**
 * Snap a nominal market execution price to the nearest symbol tick.
 *
 * This intentionally differs from roundToMintick(): execution uses Pine's
 * nearest-grid rule with JavaScript's exact Math.round division behavior,
 * while order placement rounds conservatively away from its reference price.
 */
function snapExecutionPrice(price: number, mintick: number): number {
    if (!Number.isFinite(price) || !Number.isFinite(mintick) || mintick <= 0) return price;
    const ticks = price / mintick;
    const roundedTicks = Math.round(ticks);
    const snapped = roundedTicks * mintick;
    // A non-finite quotient (price/mintick overflow) or product must not
    // fabricate an execution price — return the original nominal value.
    if (!Number.isFinite(roundedTicks) || !Number.isFinite(snapped)) return price;
    // Preserve an already-grid nominal representation so multiplication
    // noise (e.g. 26216.01 → 26216.010000000002) does not perturb strict
    // ledgers. The tolerance is BOUNDED below half a tick: a magnitude-
    // relative epsilon alone would preserve genuinely off-grid values at
    // large prices (|price| 1e12 → epsilon 1, far past half a 0.01 tick).
    const snapEps = Math.min(1e-12 * Math.max(1, Math.abs(price)), Math.abs(mintick) * 0.25);
    if (Math.abs(price - snapped) <= snapEps) return price;
    // Normalize a genuinely snapped fill to the mintick's decimal places so
    // strict ledgers never see multiplication noise (9696 × 0.01 →
    // 96.96000000000001 must be 96.96). Same convention as roundTrailLevel.
    // toFixed is only defined for 0–100 decimals; beyond that (minticks
    // smaller than ~1e-100) the raw finite product is already the best
    // representation — a RangeError must never abort an execution. And
    // Math.round's exact signed-zero result must survive normalization:
    // (-0).toFixed(2) → "0.00" → +0 would erase the mandated -0 fill.
    const mintickNotation = mintick.toString().toLowerCase();
    const [coefficient, exponentText] = mintickNotation.split('e');
    const exponent = exponentText === undefined ? 0 : Number(exponentText);
    const decimalPlaces = Math.max(0, (coefficient.split('.')[1]?.length ?? 0) - exponent);
    if (decimalPlaces > 100 || Object.is(snapped, -0)) return snapped;
    return Number(snapped.toFixed(decimalPlaces));
}
/**
 * Snap a stock price observed by TV to the displayed nearest tick.
 *
 * This is deliberately separate from roundToMintick(): order levels keep
 * their reference-directed, away-from-zero contract, while displayed
 * sizing/mark-to-market prices and OHLC path values use the nearest grid
 * point from Math.round(price / mintick). Values already on-grid within the
 * canonical magnitude-relative tolerance are pre-snapped before the
 * quotient is evaluated, absorbing upstream binary noise without changing
 * genuine half-tick decisions.
 */
function snapDisplayPrice(price: number, mintick: number): number {
    if (!Number.isFinite(price) || !Number.isFinite(mintick) || mintick <= 0) return price;

    const snapEps = 1e-12 * Math.max(1, Math.abs(price));
    const nearestTicks = Math.round(price / mintick);
    const nearestPrice = nearestTicks * mintick;
    const preSnappedPrice =
        Number.isFinite(nearestPrice) && Math.abs(price - nearestPrice) <= snapEps
            ? nearestPrice
            : price;
    const roundedTicks = Math.round(preSnappedPrice / mintick);
    const snapped = roundedTicks * mintick;
    return Number.isFinite(roundedTicks) && Number.isFinite(snapped) ? snapped : price;
}

interface OhlcPrices {
    open: number;
    high: number;
    low: number;
    close: number;
}

/**
 * Build the nearest-tick OHLC view shown by TradingView for stocks.
 *
 * Keep this view separate from the raw feed: trigger/path decisions use the
 * displayed values, while gap executions retain their raw nominal price and
 * are normalized once after slippage.
 */
function snapDisplayOhlc(prices: OhlcPrices, mintick: number): OhlcPrices {
    return {
        open: snapDisplayPrice(prices.open, mintick),
        high: snapDisplayPrice(prices.high, mintick),
        low: snapDisplayPrice(prices.low, mintick),
        close: snapDisplayPrice(prices.close, mintick),
    };
}

/**
 * Pine's `na` price literal reaches the strategy runtime as `NaN`.
 * Normalize it only when the sibling price level is also part of the call.
 * A lone `stop=na`/`limit=na` keeps the legacy non-executable order shape;
 * explicit `limit=na, stop=na` becomes a market order.
 */
export function normalizeOrderLevel<T>(value: T, pairedLevelProvided: boolean): T | undefined {
    if (!pairedLevelProvided) return value;
    if (typeof value === 'number' && Number.isNaN(value)) return undefined;
    if (typeof value === 'object' && value !== null && '__value' in value) {
        const pineValue = value.__value;
        if (typeof pineValue === 'number' && Number.isNaN(pineValue)) return undefined;
    }
    return value;
}

interface IntrabarPathPosition {
    pathSegment: number;
    distanceAlongSegment: number;
}

interface PathTrigger {
    position: IntrabarPathPosition;
    fillPrice: number;
}

function assumedIntrabarPath(open: number, high: number, low: number, close: number): number[] {
    // VIN-132b: on an EXACT distance tie the assumed broker path goes LOW
    // first (measured TV broker-emulator rule: 1781 USDZAR bar 66 — stop and
    // limit at equal distance from the open, TV fills the stop).
    return Math.abs(high - open) < Math.abs(open - low)
        ? [open, high, low, close]
        : [open, low, high, close];
}

function comparePathPositions(left: IntrabarPathPosition, right: IntrabarPathPosition): number {
    return left.pathSegment - right.pathSegment
        || left.distanceAlongSegment - right.distanceAlongSegment;
}

/**
 * Find the first point satisfying a monotonic price condition after `start`.
 * A segment of -1 denotes the bar's open before any intrabar movement.
 */
function firstTriggerAfter(
    path: readonly number[],
    level: number,
    isTriggered: (price: number) => boolean,
    start: IntrabarPathPosition,
    startPrice: number,
): PathTrigger | undefined {
    if (isTriggered(startPrice)) {
        return { position: start, fillPrice: startPrice };
    }

    const firstSegment = Math.max(0, start.pathSegment);
    let segmentStartPrice = start.pathSegment < 0 ? path[0] : startPrice;
    for (let segment = firstSegment; segment < path.length - 1; segment++) {
        const segmentEndPrice = path[segment + 1];
        if (!isTriggered(segmentStartPrice) && isTriggered(segmentEndPrice)) {
            const segmentLength = Math.abs(path[segment + 1] - path[segment]);
            return {
                position: {
                    pathSegment: segment,
                    distanceAlongSegment: segmentLength > 0
                        ? Math.abs(level - path[segment]) / segmentLength
                        : 0,
                },
                fillPrice: level,
            };
        }
        segmentStartPrice = segmentEndPrice;
    }
    return undefined;
}

function entryFillPathPosition(
    order: Order,
    direction: number,
    path: readonly number[],
    cofState: { pass: number } | null,
    atClose: boolean,
): IntrabarPathPosition {
    if (atClose) return { pathSegment: path.length - 2, distanceAlongSegment: 1 };
    if (cofState !== null) {
        if (cofState.pass === 0) return { pathSegment: -1, distanceAlongSegment: 0 };
        const segment = cofState.pass - 1;
        const level = order.type === 'stop' ? order.stop : order.limit;
        const segmentLength = Math.abs(path[segment + 1] - path[segment]);
        return {
            pathSegment: segment,
            distanceAlongSegment: level !== undefined && segmentLength > 0
                ? Math.abs(level - path[segment]) / segmentLength
                : 1,
        };
    }
    if (order.type === 'market') return { pathSegment: -1, distanceAlongSegment: 0 };

    const level = order.type === 'stop' ? order.stop : order.limit;
    if (level === undefined) return { pathSegment: -1, distanceAlongSegment: 0 };
    const isTriggered = order.type === 'stop'
        ? direction === 1
            ? (price: number) => price >= level
            : (price: number) => price <= level
        : direction === 1
          ? (price: number) => price <= level
          : (price: number) => price >= level;
    return firstTriggerAfter(
        path,
        level,
        isTriggered,
        { pathSegment: -1, distanceAlongSegment: 0 },
        path[0],
    )?.position ?? { pathSegment: -1, distanceAlongSegment: 0 };
}

/**
 * Margin required to hold a position of `qty` contracts at `price`, given
 * the `marginPct` (% of notional that must be posted as collateral). The
 * pointValue factor converts price units to account-currency dollars
 * (1 for crypto, varies for futures).
 *
 * Pine docs (strategy() declaration): `margin_long` / `margin_short` is
 * the percentage of notional held as collateral. 100 = no leverage, 20 =
 * 5× leverage, etc.
 */
export function computeRequiredMargin(qty: number, price: number, marginPct: number, pointValue: number): number {
    return (Math.abs(qty) * price * pointValue * marginPct) / 100;
}

/**
 * Account equity computed AS IF the marketprice were `atPrice` — used to
 * check what equity would be at a hypothetical intra-bar price (e.g. the
 * bar's adverse extreme for a margin-call check).
 *
 *   equity_at_price = initial_capital + netprofit + unrealizedPnL_at_price
 *
 * The mark-to-market is computed against EVERY open trade's entry price.
 */
export function computeEquityAtPrice(context: any, atPrice: number): number {
    const strategy: StrategyState = context.strategy;
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    let unrealized = 0;
    for (const lot of ledgerOpenLots(strategy)) {
        const priceChange = lot.dir === 1 ? atPrice - lot.entry_price : lot.entry_price - atPrice;
        unrealized += priceChange * lot.qty * pointValue;
    }
    return strategy.initial_capital + strategy.netprofit + unrealized;
}

/**
 * Total margin currently held by all open positions, valued at `atPrice`.
 * Per-position margin uses `margin_long` for longs and `margin_short` for
 * shorts (Pine semantic — see strategy() declaration). With the v5 default
 * of 0 (no margin requirement) the held margin is 0.
 */
export function computeHeldMargin(context: any, atPrice: number): number {
    const strategy: StrategyState = context.strategy;
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    let total = 0;
    for (const trade of strategy.opentrades) {
        const dir = Math.sign(trade.size);
        const marginPct = dir === 1 ? (strategy.config.margin_long ?? 0) : (strategy.config.margin_short ?? 0);
        total += computeRequiredMargin(trade.size, atPrice, marginPct, pointValue);
    }
    return total;
}

/**
 * Truncate a computed quantity at the provider's instrument quantity step
 * (VIN-113 cash, VIN-95 percent_of_equity). The rule is the same proved
 * truncation for both: floor(rawQty / step) * step (0.001 on CAKEUSDT, 1 on
 * integer-share stocks). Absent/invalid step → undefined, so the caller keeps
 * its generic precision truncation (corpus unchanged when no step is
 * supplied).
 */
function quantizeToQtyStep(context: any, rawQty: number): number | undefined {
    const step = context.pine?.qtyStep;
    // A stepped quantity is meaningful only for finite, positive inputs.
    // Invalid values fall through to the caller's generic precision path.
    if (
        !Number.isFinite(rawQty)
        || !(rawQty > 0)
        || typeof step !== 'number'
        || !Number.isFinite(step)
        || !(step > 0)
    ) {
        return undefined;
    }

    let quotient = rawQty / step;
    if (!Number.isFinite(quotient) || !(quotient > 0)) return undefined;

    // Decimal quantities can divide to a few ulps below an exact integer
    // (0.3 / 0.1 === 2.9999999999999996 = 2·EPSILON below 3; 1.2 / 0.1 ===
    // 11.999999999999998 = 4 ulps at 12). Snap only within the ULP-scale
    // tolerance EPSILON·max(1, |quotient|) — the smallest proved constant:
    // 0.3 / 0.1 needs K ≥ 2/3, 1.2 / 0.1 needs K ≥ 2/3·2 (both covered by
    // K = 1) and 1_234_567.89 / 0.001 needs K ≥ 0.87. Anything beyond a
    // few ulps is a genuinely sub-step value and must floor: the old
    // 1e-12-relative tolerance (1e-3 at |q| ≈ 1e9) wrongly snapped
    // 1_000_000_000.9995 up to 1_000_000_001, booking one extra share.
    const nearest = Math.round(quotient);
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(quotient));
    if (Math.abs(quotient - nearest) <= tolerance) quotient = nearest;

    const flooredQuotient = Math.floor(quotient);
    if (!Number.isFinite(flooredQuotient) || flooredQuotient < 0) return undefined;
    const steppedQty = flooredQuotient * step;
    // Zero is a valid result: it is how a positive sub-step quantity is
    // rejected by the VIN-95/VIN-103 sizing path.
    return Number.isFinite(steppedQty) && steppedQty >= 0 ? steppedQty : undefined;
}

/**
 * Calculate order quantity based on strategy configuration
 */
export function calculateOrderQty(context: any, specifiedQty: number | undefined, direction: number, fillPrice: number): number {
    const strategy: StrategyState = context.strategy;

    // Get qty type and value, calling functions if needed
    let qtyType = strategy.config.default_qty_type || 'fixed';
    let qtyValue = strategy.config.default_qty_value || 1;

    // If qtyType is a function, call it to get the actual string value
    if (typeof qtyType === 'function') {
        qtyType = (qtyType as Function)();
    }

    // If qtyValue is a function, call it to get the actual numeric value
    if (typeof qtyValue === 'function') {
        qtyValue = (qtyValue as Function)();
    }

    // Pine's broker emulator truncates computed quantities. The generic
    // precision remains six decimals for explicit/fixed/cash quantities;
    // percent_of_equity uses TV's five-decimal equity-sizing quantum.
    const QTY_PRECISION = 1e6;
    const PERCENT_QTY_PRECISION = 1e5;
    const truncateQty = (q: number, precision = QTY_PRECISION) => Math.floor(q * precision) / precision;

    if (specifiedQty !== undefined && specifiedQty !== null) {
        const absoluteQty = Math.abs(specifiedQty);
        const stepped = quantizeToQtyStep(context, absoluteQty);
        return stepped !== undefined ? stepped : truncateQty(absoluteQty);
    }

    let rawQty: number;
    let qtyPrecision = QTY_PRECISION;
    switch (qtyType) {
        case 'fixed':
            rawQty = qtyValue;
            break;

        case 'cash':
            // VIN-113: the cash amount is expressed in the ACCOUNT currency
            // (strategy.currency). TV converts it to the symbol currency at
            // the previous daily FX rate before dividing by the sizing price
            // (cash sizing on 1918/1999 CAKEUSDT reproduced 524/524 with
            // qty = floor3((50000/R(t))/close)). Without a rate series
            // provided by the host the amount passes through unconverted,
            // preserving the pre-VIN-113 corpus behavior.
            // ACTED CHOICE (VIN-113 review): unlike percent_of_equity (VIN-89),
            // no commission reserve is applied to the cash denominator — the
            // only cash captures (1918/1999) have commission_value=0, which
            // makes both hypotheses indistinguishable. Revisit with a TV
            // capture combining cash sizing and a non-zero percent commission.
            rawQty = convertAccountToSymbol(context, qtyValue, currentBarTimeMs(context), 'identity') / fillPrice;
            // TV truncates the resulting quantity at the instrument's qty
            // step (0.001 on CAKEUSDT — the 1044 TV quantities have ≤3
            // decimals). The step is per-instrument and only applied when
            // the provider supplies it; otherwise the generic six-decimal
            // truncation below applies (corpus unchanged).
            {
                const stepped = quantizeToQtyStep(context, rawQty);
                if (stepped !== undefined) return stepped;
            }
            break;

        case 'percent_of_equity': {
            // TradingView reserves the entry commission inside the requested
            // equity notional. With commission_value=0.11%, for example:
            // qty = equity * pct / (price * (1 + 0.0011)).
            //
            // VIN-134: the equity notional is expressed in the ACCOUNT
            // currency (strategy.currency). TradingView converts it to the
            // symbol currency at the previous daily FX rate before dividing
            // by the sizing price (percent sizing on 2577 EURONEXT:ALO,
            // symbol EUR / account USD: TV 2591 vs fork 3222 → implied rate
            // 1.2435353, interval proof ]1.2432741; 1.2437540]). Same helper
            // and previous-daily temporal convention as the cash branch
            // (VIN-113); without a rate series provided by the host the
            // notional passes through unconverted, preserving the
            // pre-VIN-134 corpus behavior. The calc_on_order_fills fill
            // resize and strategy.default_entry_qty share this function, so
            // they convert through the same single point.
            // VIN-130: TradingView sizes percent_of_equity on the DISPLAYED
            // symbol prices — stock references use the displayed nearest tick
            // with the canonical magnitude-relative pre-snap tolerance, then
            // Math.round on the binary quotient. This deliberately differs
            // from roundToMintick(), whose order-level contract remains
            // reference-directed and away from zero.
            // VIN-130: TV applies this displayed-price path to stock symbols.
            // Non-stock paths retain the established sizing semantics
            // (witness 2825 / crypto).
            const stockTickSizing = context.pine?.syminfo?.type === 'stock';
            const sizingPrice = stockTickSizing
                ? snapDisplayPrice(fillPrice, context.pine?.syminfo?.mintick ?? 0)
                : fillPrice;
            const sizingEquity = stockTickSizing
                ? strategy.equity - strategy.openprofit + openProfitAt(context, sizingPrice)
                : strategy.equity;

            const positionValue = convertAccountToSymbol(context, (sizingEquity * qtyValue) / 100, currentBarTimeMs(context), 'identity');
            const commissionRate = strategy.config.commission_type === 'percent'
                ? (Number(strategy.config.commission_value) || 0) / 100
                : 0;
            rawQty = positionValue / (sizingPrice * (1 + commissionRate));
            qtyPrecision = PERCENT_QTY_PRECISION;
            // VIN-95: TV truncates percent_of_equity quantities at the same
            // instrument qty step as cash (integer shares on stocks: a 0.41
            // share leg quantizes to 0 and the order is never submitted —
            // 1786/2467). Same proved rule as the cash branch; absent step →
            // the five-decimal equity-sizing truncation below.
            {
                const stepped = quantizeToQtyStep(context, rawQty);
                if (stepped !== undefined) return stepped;
            }
            break;
        }

        default:
            rawQty = qtyValue;
    }
    return truncateQty(rawQty, qtyPrecision);
}

/**
 * Process pending orders and execute them
 *
 * `reversalEntriesOnly` (VIN-110): the COF same-tick drain mode, symmetric
 * to `marketExitsOnly` in processExitOrders. Only REVERSAL MARKET entries
 * created by the current-bar recalculation (`_cof_reversal_same_tick`) fill,
 * at the current assumed intrabar tick. Fresh/pyramiding market entries and
 * price-based orders keep their next-tick/path semantics.
 */
export function processStrategyOrders(context: any, phase: 'open' | 'close' = 'open', reversalEntriesOnly = false): number {
    if (!context.strategy) return 0;

    const strategy: StrategyState = context.strategy;
    const { pending_orders } = strategy;

    // calc_on_order_fills=true intrabar sequencing (TV broker emulator):
    // orders placed during a same-bar recalculation fill on the NEXT tick
    // of that bar; the fill prices for same-bar MARKET orders are the
    // bar's assumed tick OHLC values (see CofBarState / the execution loop).
    const cof = strategy.config.calc_on_order_fills === true;
    const cofState = cof ? (strategy._cof ?? null) : null;
    // process_orders_on_close is a distinct fill phase, not a second user
    // evaluation: orders queued by the normal bar-close execution are
    // processed once at that bar's close.
    const processOnClose = strategy.config.process_orders_on_close === true;
    const closePhase = phase === 'close' && processOnClose;
    // Number of orders filled by this call — the execution loop uses it to
    // decide whether to recalculate the strategy (TV: recalc after each fill).
    let fills = 0;

    // Get current bar's OHLC data
    const rawOhlc: OhlcPrices = {
        open: Series.from(context.data.open).get(0),
        high: Series.from(context.data.high).get(0),
        low: Series.from(context.data.low).get(0),
        close: Series.from(context.data.close).get(0),
    };
    const { open: openPrice, high: highPrice, low: lowPrice, close: closePrice } = rawOhlc;
    const currentTime = Series.from(context.data.openTime).get(0);
    const mintick = context.pine?.syminfo?.mintick ?? 0.01;
    const snapExecutionPrices = context.pine?.syminfo?.type === 'stock';
    const displayedOhlc = snapExecutionPrices ? snapDisplayOhlc(rawOhlc, mintick) : rawOhlc;
    const intrabarPath = assumedIntrabarPath(openPrice, highPrice, lowPrice, closePrice);
    const displayedIntrabarPath = snapExecutionPrices
        ? assumedIntrabarPath(displayedOhlc.open, displayedOhlc.high, displayedOhlc.low, displayedOhlc.close)
        : intrabarPath;

    // Per-trade peak adverse / favorable excursion (max-drawdown / max-runup
    // on each open trade) using INTRA-BAR high/low rather than close-only.
    // Both excursions are commission-netted (entry leg charged on fill):
    //   - max_drawdown includes the entry commission as a baseline cost.
    //   - max_runup is the favorable price gain net of that same cost.
    // This matches TV's per-trade reporting.
    //
    // pointValue converts a one-unit price move into account-currency dollars.
    // For BTC and most crypto/forex it's 1; for futures it can be e.g. $50
    // per point on the ES E-mini. Multiplied into every priceChange × qty
    // computation throughout this file so excursions and P&L are in $.
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    for (const trade of strategy.opentrades) {
        const tradeQty = Math.abs(trade.size);
        const isLongTrade = trade.size > 0;
        const entryComm = trade.commission ?? 0;
        const advPrice = isLongTrade
            ? (trade.entry_price - lowPrice) * tradeQty * pointValue
            : (highPrice - trade.entry_price) * tradeQty * pointValue;
        const favPrice = isLongTrade
            ? (highPrice - trade.entry_price) * tradeQty * pointValue
            : (trade.entry_price - lowPrice) * tradeQty * pointValue;
        const advNet = Math.max(0, advPrice) + entryComm;
        const favNet = Math.max(0, favPrice - entryComm);
        if (advNet > (trade.max_drawdown ?? 0)) trade.max_drawdown = advNet;
        if (favNet > (trade.max_runup ?? 0)) trade.max_runup = favNet;
    }

    // Mark-to-market at the phase's fill price so fill logic / risk checks see
    // accurate equity. Peaks are NOT latched here; updateEquityPeaks runs once
    // at the bar's end.
    markToMarket(context, closePhase ? closePrice : openPrice);

    // Process each pending order that was placed on a previous bar
    for (const order of pending_orders) {
        if (order.status !== 'pending') continue;

        // Skip exit-category orders — processExitOrders handles them.
        if ((order.category ?? 'entry') === 'exit') continue;

        // VIN-110 same-tick drain: only reversal MARKET entries created by
        // the current-bar recalculation fill at the current tick. One fill
        // per logical order id per pass — the recalculation re-emits the
        // same reversal on every drain iteration (TV books it once; without
        // the guard the drain would oscillate the position forever).
        if (reversalEntriesOnly) {
            if (
                cofState === null
                || order.bar !== context.idx
                || order.type !== 'market'
                || !order._cof_reversal_same_tick
            ) {
                continue;
            }
            if (cofState.drainedEntryPass !== cofState.pass) {
                cofState.drainedEntryPass = cofState.pass;
                cofState.drainedEntryIds = new Set();
            }
            if (cofState.drainedEntryIds!.has(order.id)) continue;
        } else {
            // Orders placed on bar N can only fill on bar N+1 or later.
            // Skip current-bar orders outside the COF intrabar path, except
            // for current-bar MARKET orders in the explicit process-on-close
            // phase.
            const currentBarOrder = order.bar >= context.idx;
            const sameBarEligible = (cof && !closePhase) || (closePhase && order.type === 'market');
            if (currentBarOrder && !sameBarEligible) {
                continue;
            }
        }

        let shouldFill = false;
        let fillPrice = openPrice;
        // True when the chosen fill price is an OPEN/gap execution (market
        // fills; stops filled at the bar open, the COF open tick, or a
        // marketable-at-submission stop). Ordinary intrabar stop crossings
        // fill at their trigger level and are NOT execution-snapped.
        let gapExecution = false;

        // Determine if order should be filled based on type
        switch (order.type) {
            case 'market':
                // Market orders fill at the current bar's open (the next bar's
                // open from ordinary order placement). In calc_on_order_fills
                // mode, same-bar orders fill on the next assumed intrabar tick.
                // The process_orders_on_close phase is the one exception:
                // current-bar market orders fill at the signal bar's close.
                shouldFill = true;
                gapExecution = true;
                fillPrice = closePhase && order.bar === context.idx
                    ? closePrice
                    : cofState && order.bar === context.idx
                      ? snapExecutionPrices
                          ? openPrice
                          : cofState.ticks[Math.min(cofState.pass, cofState.ticks.length - 1)]
                      : openPrice;
                break;
            // In COF mode, price-based orders are evaluated only against the
            // current point on the assumed intrabar path. Recalculations can
            // refresh an order after an earlier extreme; using the full bar's
            // high/low here would incorrectly re-fire it against a price the
            // path has already left.

            case 'limit':
                if (order.limit !== undefined) {
                    const direction = parseDirection(order.direction);
                    const tickPrice = cofState
                        ? cofState.ticks[Math.min(cofState.pass, cofState.ticks.length - 1)]
                        : undefined;
                    const limitPreviousTick = cofState && cofState.pass > 0
                        ? cofState.ticks[cofState.pass - 1]
                        : undefined;
                    const newlyActivated = order._stop_limit_activated === true;
                    if (newlyActivated) order._stop_limit_activated = false;
                    if (direction === 1) {
                        if (tickPrice !== undefined) {
                            const executable = cofState.pass === 0 || newlyActivated
                                ? tickPrice <= order.limit
                                : limitPreviousTick! >= order.limit && tickPrice <= order.limit;
                            if (executable) {
                                shouldFill = true;
                                fillPrice = cofState.pass === 0 || newlyActivated ? tickPrice : order.limit;
                            }
                        } else if (lowPrice <= order.limit) {
                            shouldFill = true;
                            fillPrice = openPrice <= order.limit ? openPrice : order.limit;
                        }
                    } else if (tickPrice !== undefined) {
                        const executable = cofState.pass === 0 || newlyActivated
                            ? tickPrice >= order.limit
                            : limitPreviousTick! <= order.limit && tickPrice >= order.limit;
                        if (executable) {
                            shouldFill = true;
                            fillPrice = cofState.pass === 0 || newlyActivated ? tickPrice : order.limit;
                        }
                    } else if (highPrice >= order.limit) {
                        shouldFill = true;
                        fillPrice = openPrice >= order.limit ? openPrice : order.limit;
                    }
                }
                break;

            case 'stop':
                if (order.stop !== undefined) {
                    const direction = parseDirection(order.direction);
                    const tickPrice = cofState
                        ? cofState.ticks[Math.min(cofState.pass, cofState.ticks.length - 1)]
                        : undefined;
                    const stopPreviousTick = cofState && cofState.pass > 0
                        ? cofState.ticks[cofState.pass - 1]
                        : undefined;
                    if (direction === 1) {
                        if (tickPrice !== undefined) {
                            const crossed = cofState.pass === 0
                                ? tickPrice >= order.stop
                                : stopPreviousTick! <= order.stop && tickPrice >= order.stop;
                            if (crossed) {
                                shouldFill = true;
                                // Pass 0 evaluates the OPEN tick (a gap/open
                                // execution); later passes cross intrabar at
                                // the trigger level.
                                gapExecution = cofState.pass === 0;
                                fillPrice = cofState.pass === 0 ? tickPrice : order.stop;
                            }
                        } else {
                            // TV stop-entry semantics (VIN-95): a buy-stop
                            // already crossed at the bar's open fills at the
                            // open (gap-through); otherwise a stop reached
                            // intrabar fills at the stop level — equality
                            // inclusive. The rounded trigger (2538×0.001 →
                            // 2.5380000000000003) and the feed price (2.538)
                            // can differ by 1 ulp, so an exact touch compares
                            // with a magnitude-relative tolerance (C1-1665:
                            // high == stop == 2.538). An order already
                            // marketable at submission behaves as a triggered
                            // market order and fills at the next admissible
                            // open regardless of the gap (C4-2097).
                            const stopEps = 1e-12 * Math.max(1, Math.abs(order.stop));
                            const gapAtOpen = displayedOhlc.open >= order.stop - stopEps;
                            if (order._stop_marketable || displayedOhlc.high >= order.stop - stopEps) {
                                shouldFill = true;
                                gapExecution = order._stop_marketable || gapAtOpen;
                                fillPrice = gapExecution ? openPrice : order.stop;
                            }
                        }
                    } else if (tickPrice !== undefined) {
                        const crossed = cofState.pass === 0
                            ? tickPrice <= order.stop
                            : stopPreviousTick! >= order.stop && tickPrice <= order.stop;
                        if (crossed) {
                            shouldFill = true;
                            gapExecution = cofState.pass === 0;
                            fillPrice = cofState.pass === 0 ? tickPrice : order.stop;
                        }
                    } else {
                        // Mirror for sell-stops (see the LONG branch above).
                        const stopEps = 1e-12 * Math.max(1, Math.abs(order.stop));
                        const gapAtOpen = displayedOhlc.open <= order.stop + stopEps;
                        if (order._stop_marketable || displayedOhlc.low <= order.stop + stopEps) {
                            shouldFill = true;
                            gapExecution = order._stop_marketable || gapAtOpen;
                            fillPrice = gapExecution ? openPrice : order.stop;
                        }
                    }
                }
                break;

            case 'stop-limit':
                if (order.stop !== undefined && order.limit !== undefined) {
                    const direction = parseDirection(order.direction);
                    const tickPrice = cofState
                        ? cofState.ticks[Math.min(cofState.pass, cofState.ticks.length - 1)]
                        : undefined;
                    const previousTick = cofState && cofState.pass > 0
                        ? cofState.ticks[cofState.pass - 1]
                        : undefined;
                    const firstSameBarEvaluation = tickPrice !== undefined
                        && order.bar === context.idx
                        && order._cof_stop_limit_evaluated !== true;
                    if (tickPrice !== undefined && order.bar === context.idx) {
                        order._cof_stop_limit_evaluated = true;
                    }
                    const useCurrentLevel = tickPrice !== undefined
                        && (cofState!.pass === 0 || firstSameBarEvaluation);
                    const activated = direction === 1
                        ? tickPrice !== undefined
                            ? useCurrentLevel
                                ? tickPrice >= order.stop
                                : previousTick! <= order.stop && tickPrice >= order.stop
                            : highPrice >= order.stop
                        : tickPrice !== undefined
                          ? useCurrentLevel
                              ? tickPrice <= order.stop
                              : previousTick! >= order.stop && tickPrice <= order.stop
                          : lowPrice <= order.stop;
                    if (activated) {
                        // The stop activates a limit order; it does not itself
                        // fill. A later tick fills at the limit or better.
                        // https://www.tradingview.com/pine-script-docs/concepts/strategies/#stop-and-stop-limit-orders
                        order.type = 'limit';
                        order._stop_limit_activated = true;
                    }
                }
                break;
        }

        if (shouldFill) {
            // Risk rules run below, after any fill-time quantity re-sizing.

            // TV applies strategy slippage to market and stop fills, but not
            // limit fills. A stop-limit becomes a limit after activation and
            // therefore also bypasses slippage here.
            const direction = parseDirection(order.direction);
            fillPrice = order.type === 'limit'
                ? fillPrice
                : applySlippage(context, direction, fillPrice);
            // A price-based fill, including slippage, cannot exist outside
            // the bar that filled it. Stock intrabar stops are evaluated
            // against displayed OHLC, so use that same range for the
            // non-gap clamp. Gap fills retain raw OHLC here and are snapped
            // after this block.
            if (order.type === 'limit' || order.type === 'stop') {
                const clampOhlc = snapExecutionPrices && order.type === 'stop' && !gapExecution
                    ? displayedOhlc
                    : rawOhlc;
                fillPrice = Math.min(clampOhlc.high, Math.max(clampOhlc.low, fillPrice));
            }
            // On the proved stock surface, executions recorded on the
            // nearest mintick after slippage are MARKET fills and OHLC-GAP
            // fills (stop filled at the open / open tick / marketable at
            // submission). An ordinary intrabar stop crossing keeps its
            // trigger level — it is not an execution snap. Limit fills (an
            // activated stop-limit is a limit by this point) retain their
            // placement semantics.
            if (snapExecutionPrices && gapExecution) {
                fillPrice = snapExecutionPrice(fillPrice, mintick);
            }

            // Pre-trade margin check (Pine broker emulator). When the
            // required margin for the new position would exceed available
            // equity at fill time, the order is silently dropped — no
            // trade record, no log. For reversals the close leg always
            // succeeds (frees its prior margin) and only the new open leg
            // is checked. For pyramiding (same-direction adds), held
            // margin from existing positions stays locked.
            //
            // Only applies when margin_long/margin_short are EXPLICITLY set
            // (> 0). The Pine v5 default is 0 — the broker emulator then
            // imposes no margin requirement at all ("the strategy does not
            // check available funds"; Migration guide to Pine v6: the v6
            // change is "the default long and short margin percentage for
            // strategies is now 100", implying 0 for v5). With margin 0,
            // TV accepts entries whose notional exceeds equity (observed:
            // 1502, BUYVALUE=100000 on 100k capital, 448 entries with
            // notional > equity, marginCalls=0). At 100% margin the
            // required margin equals the full notional and the rejection
            // applies — the fork's previous behavior.
            const marginPct = direction === 1 ? (strategy.config.margin_long ?? 0) : (strategy.config.margin_short ?? 0);
            {
                const oldSize = strategy.position_size;
                const oldSign = Math.sign(oldSize);
                const isReversal = oldSign !== 0 && oldSign !== direction;
                // calc_on_order_fills mode: TV sizes percent_of_equity default
                // orders at FILL ("position sizes will be calculated as a
                // percentage of the available equity when the trade opens" —
                // Strategy properties help article). The placement-time size
                // (equity at the placement bar's close / that close) times a
                // higher fill open spuriously trips the margin rejection below
                // (notional = qty × fill > equity) for orders TV accepts —
                // observed on 2205/FLOWUSDT 4h: 3 entries rejected by the
                // fork, filled by TV. Re-derive the qty at fill using the
                // fill-time equity and the fill price. Explicit qty arguments
                // and other default_qty_type modes are never re-scaled.
                if (cof && order._qty_from_default_equity) {
                    let qtyType = strategy.config.default_qty_type ?? 'fixed';
                    if (typeof qtyType === 'function') qtyType = (qtyType as Function)();
                    if (qtyType === 'percent_of_equity') {
                        // Same sizing function as placement/default_entry_qty
                        // (VIN-95: qty-step truncation included), evaluated at
                        // fill-time equity and fill price.
                        const baseQty = calculateOrderQty(context, undefined, direction, fillPrice);
                        // A quantized-zero/non-finite default base cancels the
                        // whole pending entry. Check before adding the old
                        // position's close leg for a reversal: otherwise a
                        // zero requested base would still close the position.
                        if (!(baseQty > 0) || !Number.isFinite(baseQty)) {
                            order.status = 'cancelled';
                            continue;
                        }
                        order._base_qty = baseQty;
                        order.qty = isReversal ? Math.abs(oldSize) + baseQty : baseQty;
                    }
                }
                // VIN-110: a same-tick reversal entry was sized at placement
                // against the position BEFORE the same-tick market-exit
                // drain. TV re-derives the reversal at fill against the
                // CURRENT position: close what remains, open the requested
                // base size. Without this, a close drained first leaves its
                // stale close-qty in the open leg (TV 1539: close 1, open 1 —
                // not 2).
                if (order._cof_reversal_same_tick && order._base_qty !== undefined) {
                    const reversing = oldSign !== 0 && oldSign !== direction;
                    order.qty = reversing ? Math.abs(oldSize) + order._base_qty : order._base_qty;
                }
                // VIN-103: never open a zero-size lot. A COF percent_of_equity
                // resize can shrink the fill qty to 0 (equity moved between
                // placement and fill); TV does not book such fills. Orders
                // whose placement qty was <= 0 were already refused at
                // submission (entry/order).
                if (!(order.qty > 0)) {
                    order.status = 'cancelled';
                    continue;
                }
                // Risk rules are evaluated at the fill, after dynamic
                // percent_of_equity sizing. max_position_size truncates only
                // the leg that increases the absolute position; a reducing
                // order remains at its requested quantity.
                if (isOrderBlockedByRisk(strategy, order)) {
                    order.status = 'cancelled';
                    continue;
                }

                const newOpenQty = isReversal ? Math.max(0, order.qty - Math.abs(oldSize)) : order.qty;

                if (newOpenQty > 0) {
                    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
                    // Equity is already MtM'd at the phase's fill price at
                    // the top of processStrategyOrders, so strategy.equity is
                    // the current account value. Subtract margin held by
                    // positions that will REMAIN after this order:
                    //   - reversal: nothing remains from old position.
                    //   - pyramiding (same dir): existing held margin stays.
                    //   - fresh entry: nothing held to begin with.
                    let heldMarginRemaining = 0;
                    if (oldSign === direction) {
                        heldMarginRemaining = computeHeldMargin(context, closePhase ? closePrice : openPrice);
                    }
                    const availableEquity = strategy.equity - heldMarginRemaining;
                    const requiredMargin = computeRequiredMargin(newOpenQty, fillPrice, marginPct, pointValue);

                    // marginPct === 0 (the v5 default): no margin requirement,
                    // TV never rejects — requiredMargin is 0 and even a
                    // negative-equity account can still open (infinite-leverage
                    // mode). Guard explicitly so an equity < 0 edge cannot
                    // resurrect a rejection under margin 0.
                    if (marginPct > 0 && requiredMargin > availableEquity) {
                        // TV broker emulator: the margin check only guards the
                        // OPEN leg. On a reversal, the close leg always
                        // executes (it frees margin / realizes the position) —
                        // TV's exit shows the reversal order's id as exit id
                        // while no opposite position appears. Verified against
                        // QA margin_calls xlsx: after a partial margin-call
                        // liquidation, the remainder was closed by the next
                        // reversal order whose open leg was margin-rejected.
                        const qtyToClose = Math.min(Math.abs(oldSize), order.qty);
                        if (isReversal && qtyToClose > 0) {
                            closePartialPosition(context, qtyToClose, fillPrice, currentTime, {
                                exitId: order.id,
                                exitComment: order.comment,
                            });
                            order.status = 'filled';
                            order.fill_price = fillPrice;
                            order.fill_bar = context.idx;
                            order.fill_time = currentTime;
                            fills += 1;
                        } else {
                            order.status = 'cancelled';
                        }
                        continue;
                    }
                }
            }

            // Preserve when this logical entry became active on the assumed
            // path. A pre-existing exit may attach to it, but cannot inherit
            // a trigger crossed earlier in the same bar.
            const fillsAtClose = closePhase && order.type === 'market' && order.bar === context.idx;
            const fillPath = snapExecutionPrices && order.type === 'stop'
                ? displayedIntrabarPath
                : intrabarPath;
            const fillPathPosition = entryFillPathPosition(order, direction, fillPath, cofState, fillsAtClose);
            executeOrder(context, order, fillPrice, currentTime, fillPathPosition);
            order.status = 'filled';
            order.fill_price = fillPrice;
            order.fill_bar = context.idx;
            order.fill_time = currentTime;
            fills += 1;
            // VIN-110 anti-loop: the recalculation re-emits the same reversal
            // order id on every drain iteration; only the FIRST fill of each
            // logical id counts for the current pass.
            if (reversalEntriesOnly && cofState) {
                cofState.drainedEntryIds ??= new Set();
                cofState.drainedEntryIds.add(order.id);
            }
        }
    }

    // Remove filled and cancelled orders
    strategy.pending_orders = pending_orders.filter((o) => o.status === 'pending');

    // Refresh equity at CLOSE for processExitOrders' opening read.
    // Peaks are latched at the bar's end inside processExitOrders.
    markToMarket(context, closePrice);
    updateStrategyMetrics(context);
    return fills;
}

/**
 * Parse direction string/number to numeric value
 */
export function parseDirection(direction: number | string): number {
    if (typeof direction === 'number') return direction;
    if (direction === 'long') return 1;
    if (direction === 'short') return -1;
    return 0;
}

/**
 * Translate the legacy v4 direction value for strategy.entry().
 *
 * Pine v4 declares the direction parameter as `long: series bool` (named
 * `long=`); Pine v5+ renamed it to `direction: series const string`
 * (strategy.long / strategy.short). The caller gates this helper on
 * `context.pineVersion === 4`; v5 strings continue through parseDirection()
 * unchanged. The transpiler collects named arguments into a trailing
 * options bag, so v4 `long=<value>` arrives as a bag key while v4's
 * positional bool/int arrives in the `direction` slot:
 *   - boolean true/false → +1/-1   (`long=true` / `long=false`)
 *   - number 1 → +1, 0 → -1       (legacy int idiom `entry("L", 1)`)
 *   - 'long' / 'short' → +1/-1    (v4 bool-like constants as represented by
 *                                  the fork runtime)
 *   - anything else (na, objects, 'all', …) → 0 → explicit caller error;
 *     no dir=0/qty=0 ghost order is enqueued.
 */
export function parseEntryDirection(raw: unknown): number {
    if (typeof raw === 'boolean') return raw ? 1 : -1;
    if (typeof raw === 'number') {
        if (Number.isNaN(raw)) return 0; // Pine `na` in the direction slot
        if (raw === 1) return 1;
        if (raw === 0 || raw === -1) return -1;
        return 0;
    }
    if (typeof raw === 'string') return parseDirection(raw);
    return 0;
}

/**
 * Charge commission for one fill leg (entry OR exit) given the qty filled and
 * the price at fill. Returns the dollar amount to deduct.
 *
 * Pine commission types:
 *   - strategy.commission.percent          : commission_value % of leg notional
 *   - strategy.commission.cash_per_contract: commission_value per contract filled
 *   - strategy.commission.cash_per_order   : commission_value flat per fill leg
 */
function computeLegCommission(context: any, strategy: StrategyState, qty: number, price: number): number {
    const type = strategy.config.commission_type ?? 'percent';
    const value = strategy.config.commission_value ?? 0;
    if (!value || value === 0) return 0;
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    switch (type) {
        case 'percent':
            // Notional = qty × price × pointValue, commission is value% of it.
            return Math.abs(qty) * price * pointValue * (value / 100);
        case 'cash_per_contract':
            // value is in account currency per contract — no pointValue factor.
            return Math.abs(qty) * value;
        case 'cash_per_order':
            return value;
        default:
            return 0;
    }
}

/**
 * Apply slippage to a nominal fill price, shifting against the trade's
 * direction (longs fill higher, shorts fill lower). slippage is expressed in
 * ticks of `syminfo.mintick`. Returns the adjusted fill price.
 */
function applySlippage(context: any, direction: number, nominalPrice: number): number {
    const strategy: StrategyState = context.strategy;
    const slippage = strategy.config.slippage ?? 0;
    if (!slippage || slippage === 0) return nominalPrice;
    const mintick = context.pine?.syminfo?.mintick ?? 0.01;
    const slippageAmount = slippage * mintick;
    return direction === 1 ? nominalPrice + slippageAmount : nominalPrice - slippageAmount;
}

/**
 * Update max_contracts_held_* peaks after a position-size change.
 * Called whenever position_size mutates (openTrade / closePartialPosition).
 */
function updateMaxContractsHeld(strategy: StrategyState): void {
    const abs = Math.abs(strategy.position_size);
    if (abs > strategy.max_contracts_held_all) strategy.max_contracts_held_all = abs;
    if (strategy.position_size > strategy.max_contracts_held_long) {
        strategy.max_contracts_held_long = strategy.position_size;
    }
    if (-strategy.position_size > strategy.max_contracts_held_short) {
        strategy.max_contracts_held_short = -strategy.position_size;
    }
}

/**
 * Returns true if adding a same-direction entry would exceed the strategy's
 * pyramiding cap. Counts existing open trades in the requested direction.
 *
 * `strategy.entry()` (when implemented) consults this; `strategy.order()` does
 * NOT — Pine treats strategy.order as a low-level primitive that ignores the
 * pyramiding limit.
 */
export function wouldExceedPyramiding(strategy: StrategyState, direction: number): boolean {
    const cap = strategy.config.pyramiding ?? 1;
    let openSameSide = 0;
    for (const t of strategy.opentrades) {
        if (Math.sign(t.size) === direction) openSameSide++;
    }
    return openSameSide >= cap;
}

/**
 * Pre-fill risk-rule check. Returns true if the order should be BLOCKED.
 *
 * Consulted rules (independent; first violation wins):
 *   - risk_halted (latched by any catastrophic rule)
 *   - allow_entry_in: 'long' blocks short orders; 'short' blocks long.
 *     A prohibited-direction order never opens a prohibited residual: when
 *     it would only close/reduce an existing opposite (allowed) position,
 *     its qty is truncated to that close leg (`min(qty, |position|)`) and
 *     the order proceeds as a pure close; with no opposite position (flat
 *     or same-side position) the order is blocked entirely.
 *   - max_position_size: evaluated at fill; an increasing leg is truncated
 *     to the remaining cap, while a purely reducing order is unchanged
 */
export function isOrderBlockedByRisk(strategy: StrategyState, order: Order): boolean {
    if (strategy.risk_halted) return true;
    const rules = strategy.risk_rules;
    const orderDir = order.direction;

    if (rules.allow_entry_in) {
        if (rules.allow_entry_in === 'long' && orderDir === -1) {
            // Only longs allowed: a short order may close/reduce an existing
            // long, never open a short. Truncate to the close leg; a flat or
            // same-side (short) position has nothing closeable → blocked.
            const positionSize = strategy.position_size;
            const closeable = positionSize > 0 ? Math.min(order.qty, positionSize) : 0;
            if (!(closeable > 0)) return true;
            order.qty = closeable;
        } else if (rules.allow_entry_in === 'short' && orderDir === 1) {
            // Only shorts allowed: a long order may close/reduce an existing
            // short, never open a long.
            const positionSize = strategy.position_size;
            const closeable = positionSize < 0 ? Math.min(order.qty, -positionSize) : 0;
            if (!(closeable > 0)) return true;
            order.qty = closeable;
        }
    }
    if (rules.max_position_size !== undefined) {
        const positionSize = strategy.position_size;
        const positionDirection = Math.sign(positionSize);
        const isReducing = positionDirection !== 0 && positionDirection !== orderDir;
        const reductionQty = isReducing ? Math.min(order.qty, Math.abs(positionSize)) : 0;
        const increasingQty = order.qty - reductionQty;

        // An order that only reduces the current position is not subject to
        // max_position_size. If it reverses, only its new opposite-side leg
        // consumes the cap.
        if (increasingQty <= 0) return false;

        const retainedSize = isReducing
            ? Math.abs(positionSize) - reductionQty
            : Math.abs(positionSize);
        const remaining = rules.max_position_size - retainedSize;
        if (remaining <= 0) return true;
        if (increasingQty > remaining) {
            order.qty = reductionQty + remaining;
        }
    }
    return false;
}

/**
 * Latches `risk_halted` when any catastrophic rule trips (max_drawdown,
 * max_intraday_loss, max_cons_loss_days). Once halted, all entries are
 * blocked for the rest of the run.
 *
 * Called after each close. The intraday rules use simple cumulative
 * approximations — true day-rollover detection would require bar timestamp
 * + timezone logic that's deferred.
 */
export function evaluateCatastrophicRiskHalt(strategy: StrategyState): void {
    if (strategy.risk_halted) return;
    const rules = strategy.risk_rules;

    if (rules.max_drawdown) {
        const limit =
            rules.max_drawdown.type === 'percent_of_equity' ? (rules.max_drawdown.value / 100) * strategy.equity_peak : rules.max_drawdown.value;
        if (strategy.max_drawdown >= limit) {
            strategy.risk_halted = true;
            return;
        }
    }
    if (rules.max_intraday_loss) {
        const limit =
            rules.max_intraday_loss.type === 'percent_of_equity'
                ? (rules.max_intraday_loss.value / 100) * strategy.initial_capital
                : rules.max_intraday_loss.value;
        if (strategy.grossloss >= limit) {
            strategy.risk_halted = true;
            return;
        }
    }
    if (rules.max_cons_loss_days) {
        let consecutive = 0;
        for (let i = strategy.closedtrades.length - 1; i >= 0; i--) {
            if ((strategy.closedtrades[i].profit ?? 0) < 0) consecutive++;
            else break;
        }
        if (consecutive >= rules.max_cons_loss_days.count) {
            strategy.risk_halted = true;
        }
    }
}

/**
 * Open a new trade.
 *
 * @param direction +1 long, -1 short
 * @param qty       unsigned contract count
 * @param price     fill price
 * @param time      fill time (ms)
 */
export function openTrade(
    context: any,
    entryId: string,
    direction: number,
    qty: number,
    price: number,
    time: number,
    entryComment?: string,
    isReversalOpen?: boolean,
    entryPathPosition?: IntrabarPathPosition,
): void {
    const strategy: StrategyState = context.strategy;
    const tradeNum = strategy.opentrades.length + strategy.closedtrades.length;

    // Charge entry-leg commission up front; trade.commission will be increased
    // by the exit leg when it closes (or proportional share on partial close).
    //
    // For cash_per_order on a reversal open, charge only HALF the flat fee:
    // the other half is charged to the closing leg in closePartialPosition,
    // matching TV's 50/50 split of the order's flat fee between the two legs.
    const commTypeOpen = strategy.config.commission_type ?? 'percent';
    const halveFlat = isReversalOpen && commTypeOpen === 'cash_per_order';
    const rawEntryCommission = computeLegCommission(context, strategy, qty, price);
    const entryCommission = halveFlat ? rawEntryCommission / 2 : rawEntryCommission;

    const trade: Trade = {
        id: `trade_${tradeNum}`,
        entry_id: entryId,
        // TV's strategy.closedtrades.entry_comment falls back to the entry id
        // when no explicit comment was passed to strategy.entry/order. Mirror
        // that by stamping the id as the entry comment when none is given.
        entry_comment: entryComment ?? entryId,
        entry_price: price,
        _bracket_entry: price,
        entry_bar_index: context.idx,
        entry_time: time,
        _activation_entry_path_segment: entryPathPosition?.pathSegment,
        _activation_entry_path_distance: entryPathPosition?.distanceAlongSegment,
        size: direction * qty, // SIGNED — matches Pine's closedtrades.size()
        commission: entryCommission,
        max_drawdown: 0,
        max_runup: 0,
        status: 'open',
    };

    strategy.opentrades.push(trade);

    // Latch the slippage-adjusted entry price of the FIRST trade ever opened —
    // the anchor for the buy-and-hold benchmark (see finalizeStrategyRun).
    if (strategy._first_entry_price === undefined) {
        strategy._first_entry_price = price;
    }


    // Realize the entry commission immediately as a cash outflow. TV reports
    // strategy.netprofit and strategy.grossloss net of entry commission the
    // moment the trade opens (commission is a real cost paid at fill, not
    // Entry commission hits strategy.netprofit (and grossloss as a pending
    // liability) AT FILL TIME — matches TV's `strategy.netprofit` value
    // during an open trade (verified against xlsx exports: TV's "Net profit"
    // line during an open position equals closed-trades-total minus the
    // sum of open trades' entry commissions). The exit commission is
    // realized in closePartialPosition when the trade actually closes.
    //
    // Drawdown compensation: `updateEquityPeaks` adds the open trades'
    // entry commission BACK to the drawdown formula. This mirrors TV's
    // drawdown formula which has an explicit `+ openCommission` term —
    // the result is correct for any peak timing (before vs during open
    // trade), see math in the QA-drawdown analysis notes.
    if (entryCommission > 0) {
        strategy.netprofit -= entryCommission;
        strategy.grossloss += entryCommission;
    }

    // Per-trade fill-bar excursion: capture this bar's intra-bar H/L against
    // the just-filled trade. Without this, the per-trade loop at the top of
    // processStrategyOrders misses the fill bar (it ran before this trade
    // existed in opentrades), and the bar's adverse / favorable excursion is
    // lost from trade.max_drawdown / trade.max_runup.
    //
    // Clamp at pending SL/TP trigger prices: a trade with an attached stop
    // can't actually experience price excursions past the stop — once price
    // touches the stop, the trade closes there. Without clamping, a same-bar
    // entry+SL trade records the bar's full low (a phantom excursion that
    // never happened to this trade).
    const highPrice = Series.from(context.data.high).get(0);
    const lowPrice = Series.from(context.data.low).get(0);
    const mintick = context.pine?.syminfo?.mintick ?? 0.01;

    let worstPrice = direction === 1 ? lowPrice : highPrice;
    let bestPrice = direction === 1 ? highPrice : lowPrice;
    for (const exitOrder of strategy.pending_orders) {
        if ((exitOrder.category ?? 'entry') !== 'exit') continue;
        if (exitOrder.from_entry && exitOrder.from_entry !== entryId) continue;

        // SL trigger price (stop=absolute, loss=ticks-from-entry).
        let sl: number | undefined;
        if (exitOrder.stop !== undefined) sl = exitOrder.stop;
        else if (exitOrder.loss !== undefined) {
            sl = direction === 1 ? price - exitOrder.loss * mintick : price + exitOrder.loss * mintick;
        }
        // TP trigger price (limit=absolute, profit=ticks-from-entry).
        let tp: number | undefined;
        if (exitOrder.limit !== undefined) tp = exitOrder.limit;
        else if (exitOrder.profit !== undefined) {
            tp = direction === 1 ? price + exitOrder.profit * mintick : price - exitOrder.profit * mintick;
        }

        if (direction === 1) {
            // Long: worst is low (cap upward by sl), best is high (cap downward by tp).
            if (sl !== undefined && sl > worstPrice) worstPrice = sl;
            if (tp !== undefined && tp < bestPrice) bestPrice = tp;
        } else {
            // Short: worst is high (cap downward by sl), best is low (cap upward by tp).
            if (sl !== undefined && sl < worstPrice) worstPrice = sl;
            if (tp !== undefined && tp > bestPrice) bestPrice = tp;
        }
    }

    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    const adv = direction === 1 ? (price - worstPrice) * qty * pointValue : (worstPrice - price) * qty * pointValue;
    const fav = direction === 1 ? (bestPrice - price) * qty * pointValue : (price - bestPrice) * qty * pointValue;
    // Fold entry-leg commission into BOTH excursions: a trade is "down" by
    // the entry commission the moment it fills (so the adverse excursion
    // includes that cost), and the favorable excursion is the price gain NET
    // of that same cost (the trade has to overcome the commission first
    // before showing any runup). TV reports both metrics commission-netted.
    trade.max_drawdown = Math.max(0, adv) + entryCommission;
    trade.max_runup = Math.max(0, fav - entryCommission);

    // Update flat position scalars
    const oldSize = strategy.position_size;
    const newSize = oldSize + trade.size;

    if (oldSize === 0) {
        // Opening fresh position
        strategy.position_size = newSize;
        strategy.position_avg_price = price;
        strategy.position_entry_name = entryId;
    } else if (Math.sign(oldSize) === Math.sign(newSize)) {
        // Adding to existing same-direction position — weighted-avg the entry price
        const totalCost = Math.abs(oldSize) * strategy.position_avg_price + qty * price;
        const totalQty = Math.abs(newSize);
        strategy.position_avg_price = totalCost / totalQty;
        strategy.position_size = newSize;
    }

    updateMaxContractsHeld(strategy);
}

/**
 * Execute an order
 * strategy.order() modifies the net position directly
 */
function executeOrder(
    context: any,
    order: Order,
    fillPrice: number,
    fillTime: number,
    entryPathPosition?: IntrabarPathPosition,
): void {
    const strategy: StrategyState = context.strategy;
    const direction = parseDirection(order.direction);
    const oldPosition = strategy.position_size;
    const oldSign = Math.sign(oldPosition);

    // Check if we are reducing/reversing the position
    // (Long position and selling, or Short position and buying)
    const isReducing = (oldSign === 1 && direction === -1) || (oldSign === -1 && direction === 1);

    if (isReducing) {
        // We are reducing or reversing
        // First, use the order to close existing trades. For a reversal,
        // the reversing order's id/comment become the EXIT id/comment of
        // the prior trade — that's TV behavior.
        const qtyToClose = Math.min(Math.abs(oldPosition), order.qty);
        const remainingQty = order.qty - qtyToClose;
        // True reversal: the SAME order both flattens the prior position
        // AND opens a new one in the opposite direction. For cash_per_order
        // commission, TV charges the order's flat fee ONCE total — split
        // 50/50 between the closing leg and the opening leg (so the closing
        // trade gets +value/2 and the new trade also gets +value/2 on its
        // entry). Marking the close with isImplicitReversal triggers that
        // half-charge in closePartialPosition; the new openTrade is told
        // separately to apply the same half-charge.
        const isReversal = remainingQty > 0;
        closePartialPosition(context, qtyToClose, fillPrice, fillTime, {
            exitId: order.id,
            exitComment: order.comment,
            isImplicitReversal: isReversal,
        });

        // If there is remaining quantity (reversal), open a new trade.
        // When the close leg consumed LESS than the order anticipated at
        // queue time (a deferred close-margin-call shrank the position
        // between queue and fill), the remaining qty exceeds the ordered
        // base size. TV books the intended base size and the overshoot as
        // TWO separate lots (each with its own exit bracket and ledger
        // row — xlsx 2021-10-02: longs 5 + 0.263108 at the same fill).
        if (remainingQty > 0) {
            const baseQty = (order as any)._base_qty;
            if (baseQty !== undefined && remainingQty > baseQty + 1e-9) {
                openTrade(context, order.id, direction, baseQty, fillPrice, fillTime, order.comment, /* isReversalOpen */ true, entryPathPosition);
                openTrade(context, order.id, direction, remainingQty - baseQty, fillPrice, fillTime, order.comment, /* isReversalOpen */ true, entryPathPosition);
            } else {
                openTrade(context, order.id, direction, remainingQty, fillPrice, fillTime, order.comment, /* isReversalOpen */ true, entryPathPosition);
            }
        }
    } else {
        // We are increasing position or opening fresh
        openTrade(context, order.id, direction, order.qty, fillPrice, fillTime, order.comment, undefined, entryPathPosition);
    }
}

/**
 * Close partial or full position.
 *
 * FIFO accounting: closes oldest open trades first. Splits a trade if the
 * close qty is smaller than the trade's remaining qty.
 */

export interface CloseInfo {
    /** Which exit leg triggered ('profit'/'loss'/'trailing'), null otherwise. */
    triggerKind?: 'profit' | 'loss' | 'trailing' | null;
    /** Exit order's id, set onto the closed trade as trade.exit_id. */
    exitId?: string;
    /** Resolved exit comment (the matching comment_profit/loss/trailing). */
    exitComment?: string;
    /**
     * True when this close is part of a single REVERSAL order that will
     * also open a new trade in the opposite direction. Affects
     * `cash_per_order` commission: TV charges the flat fee ONCE per order
     * placement, attributed to the new entry — the implicit close leg of
     * the reversal does NOT incur a second flat charge. Per-leg types
     * (percent, cash_per_contract) are unaffected by this flag.
     */
    isImplicitReversal?: boolean;
}


export function closePartialPosition(context: any, qtyToClose: number, exitPrice: number, exitTime: number, closeInfo?: CloseInfo): void {
    const strategy: StrategyState = context.strategy;
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    let remainingQty = qtyToClose;
    const remainingActivation = activationSegmentsAfterClose(
        strategy.opentrades,
        strategy.opentrades.flatMap((trade) => activationSegmentsOf(trade).map((segment) => segment.id)),
        qtyToClose,
    );

    // Close trades from oldest to newest (FIFO)
    const tradesToClose = [...strategy.opentrades];
    strategy.opentrades = [];

    for (const trade of tradesToClose) {
        if (remainingQty <= 0) {
            // Keep this trade open
            strategy.opentrades.push(trade);
            continue;
        }

        const tradeQty = Math.abs(trade.size);
        const qtyClosing = Math.min(tradeQty, remainingQty);
        const tradeDirection = Math.sign(trade.size);

        const emitClosedRows = (qtyClosed: number) => {
            const commType = strategy.config.commission_type ?? 'percent';
            const halveFlat = closeInfo?.isImplicitReversal && commType === 'cash_per_order';
            const rawExitCommission = computeLegCommission(context, strategy, qtyClosed, exitPrice);
            const exitCommission = halveFlat ? rawExitCommission / 2 : rawExitCommission;
            const entryCommission = (trade.commission ?? 0) * (qtyClosed / tradeQty);
            const priceChange = tradeDirection === 1 ? exitPrice - trade.entry_price : trade.entry_price - exitPrice;
            const gross = priceChange * qtyClosed * pointValue;
            const row: Trade = {
                id: `trade_${strategy.opentrades.length + strategy.closedtrades.length + tradesToClose.length}`,
                entry_id: trade.entry_id,
                entry_comment: trade.entry_comment,
                entry_price: trade.entry_price,
                _bracket_entry: trade._bracket_entry,
                entry_bar_index: trade.entry_bar_index,
                entry_time: trade.entry_time,
                size: tradeDirection * qtyClosed,
                commission: entryCommission + exitCommission,
                max_drawdown: trade.max_drawdown,
                max_runup: trade.max_runup,
                status: 'closed',
                exit_price: exitPrice,
                exit_bar_index: context.idx,
                exit_time: exitTime,
                exit_id: closeInfo?.exitId ?? trade.exit_id,
                exit_comment: closeInfo?.exitComment ?? trade.exit_comment,
                profit: gross - entryCommission - exitCommission,
            };
            if (closeInfo?.triggerKind === 'loss') row.max_runup = 0;
            if (closeInfo?.triggerKind === 'profit') row.max_drawdown = entryCommission;
            strategy.netprofit += gross - exitCommission;
            strategy.grossloss -= entryCommission;
            if (row.profit! > 0) {
                strategy.grossprofit += row.profit!;
                strategy.wintrades++;
                strategy.wintrades_total_profit += row.profit!;
            } else if (row.profit! < 0) {
                strategy.grossloss += Math.abs(row.profit!);
                strategy.losstrades++;
                strategy.losstrades_total_loss += Math.abs(row.profit!);
            } else {
                strategy.eventrades++;
            }
            strategy.closedtrades.push(row);
        };

        // Epsilon on the full-close decision: when the requested qty is a
        // float hair short of the trade's size (fractional margin-call
        // remainders), treat it as a full close instead of leaving a
        // ~1e-15 ghost portion open.
        if (qtyClosing >= tradeQty - 1e-9) {
            // Fully close this physical lot.
            trade.status = 'closed';
            trade.exit_price = exitPrice;
            trade.exit_bar_index = context.idx;
            trade.exit_time = exitTime;
            emitClosedRows(tradeQty);
            remainingQty -= qtyClosing;
        } else {
            // Partially close this physical lot and keep its residual entry
            // commission on the canonical open lot.
            emitClosedRows(qtyClosing);
            const entryCommissionShare = (trade.commission ?? 0) * (qtyClosing / tradeQty);

            // The remaining open portion keeps the residual entry commission share.
            trade.size = tradeDirection * (tradeQty - qtyClosing);
            trade.commission = (trade.commission ?? 0) - entryCommissionShare;
            strategy.opentrades.push(trade);
            remainingQty = 0;
        }
    }
    assignActivationSegments(strategy, remainingActivation);

    // Catastrophic risk-rule halt check after this close.
    evaluateCatastrophicRiskHalt(strategy);

    // Update flat position scalars from the (possibly shrunken) open-trade book
    const currentSize = strategy.position_size;
    const sizeReduction = Math.sign(currentSize) * qtyToClose; // Reduce magnitude
    let newSize = currentSize - sizeReduction;

    // Epsilon-snap to flat: fractional quantities (margin-call partial
    // liquidations) leave float residuals (~1e-15) when the position fully
    // unwinds. An exact `=== 0` check then misses the flatten, leaving
    // position_avg_price alive on a ghost position — the script captures
    // stale TP/SL prices from it and the next entry gets phantom-exited at
    // its own entry price (QA pyramiding xlsx, 2021-11-09 BTCUSDC).
    if (Math.abs(newSize) < 1e-9) newSize = 0;

    strategy.position_size = newSize;
    updateMaxContractsHeld(strategy);

    if (newSize === 0) {
        strategy.position_avg_price = NaN;
        strategy.position_entry_name = '';
    } else if (strategy.opentrades.length > 0) {
        // Recompute average entry price from the remaining open book
        // (LEDGER view — see ledgerOpenLots). Crucial because closing
        // older entries (FIFO pairing) changes the weighted average if
        // the position was built from multiple entries at different
        // prices.
        let totalCost = 0;
        let totalQty = 0;
        for (const t of ledgerOpenLots(strategy)) {
            totalCost += t.qty * t.entry_price;
            totalQty += t.qty;
        }
        strategy.position_avg_price = totalCost / totalQty;
        // position_entry_name keeps pointing at whichever entry opened the
        // first still-open trade
        strategy.position_entry_name = strategy.opentrades[0].entry_id;
    }
}

/** Canonical chronological open-lot view used by all equity calculations. */
function ledgerOpenLots(strategy: StrategyState): Array<{ qty: number; entry_price: number; commission: number; dir: number }> {
    return strategy.opentrades.map((trade) => ({
        qty: Math.abs(trade.size),
        entry_price: trade.entry_price,
        commission: trade.commission ?? 0,
        dir: Math.sign(trade.size),
    }));
}

/**
 * Unrealized P&L of the open positions marked at `price` — the shared
 * valuation used by markToMarket and by the percent_of_equity sizing
 * (which re-derives it at the snapped reference price, VIN-130).
 */
function openProfitAt(context: any, price: number): number {
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;
    let unrealizedPnL = 0;
    for (const lot of ledgerOpenLots(context.strategy)) {
        const priceChange = lot.dir === 1 ? price - lot.entry_price : lot.entry_price - price;
        unrealizedPnL += priceChange * lot.qty * pointValue;
    }
    return unrealizedPnL;
}

/**
 * Mark-to-market the open positions to `currentPrice`, updating
 * `strategy.openprofit` and `strategy.equity`. Does NOT touch the
 * max_drawdown / max_runup peaks — those are latched once per bar by
 * `updateEquityPeaks` AFTER all entry+exit fills have settled, so that
 * trades closed mid-bar by TP / SL are reflected as realized P&L (rather
 * than as a phantom intra-bar excursion against the bar's raw H/L).
 */
function markToMarket(context: any, currentPrice: number): void {
    const strategy: StrategyState = context.strategy;
    const unrealizedPnL = openProfitAt(context, currentPrice);
    strategy.openprofit = unrealizedPnL;
    strategy.equity = strategy.initial_capital + strategy.netprofit + unrealizedPnL;
}

/**
 * Latch `strategy.max_drawdown` and `strategy.max_runup` using INTRA-BAR
 * high/low excursions of the CURRENT open position (after all fills have
 * settled for the bar).
 *
 * Algorithm:
 *   1. `equity_peak` / `equity_trough` track the running high/low of
 *      REALIZED equity (initial_capital + netprofit). They step only on
 *      closed-trade P&L.
 *   2. For the still-open position (single weighted-avg via position_size /
 *      position_avg_price), compute worst- and best-case unrealized excursion
 *      against the bar's adverse / favorable extreme:
 *        long:  worstPrice = low,   bestPrice = high
 *        short: worstPrice = high,  bestPrice = low
 *   3. drawdown_this_bar = (equity_peak  − realized_equity) + worst_excursion
 *      runup_this_bar    = (realized_equity − equity_trough) + best_excursion
 *   4. Latch the running maxima.
 *
 * Why latch only after fills: a trade closed by TP / SL during the bar
 * realizes exactly its stop/target P&L. Computing drawdown against the bar's
 * raw low BEFORE the fill would overcount — the trade never actually marked
 * to that low because the stop fired first. Running this only after fills
 * means closed trades contribute via `realizedEquity` (their actual close
 * price), and only positions that survived the bar contribute via H/L.
 *
 * Per-trade excursions (trade.max_drawdown / trade.max_runup) are tracked
 * separately at the top of processStrategyOrders against the same bar H/L.
 */
function updateEquityPeaks(context: any, highPrice: number, lowPrice: number): void {
    const strategy: StrategyState = context.strategy;
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;

    const realizedEquity = strategy.initial_capital + strategy.netprofit;

    // Open-book entry commissions (already deducted from netprofit at
    // fill) — LEDGER view, consistent with netprofit's slice increments.
    let openCommission = 0;
    for (const lot of ledgerOpenLots(strategy)) openCommission += lot.commission;

    // PEAK basis excludes the open trades' entry commissions. TV latches the
    // equity high-water on the intermediate funds state right after a close
    // settles — BEFORE the entry commission of a trade opened on the same
    // bar (reversal) is charged. PT processes the reversal close+open
    // atomically, so the peak basis adds the open entry commissions back.
    // Verified against QA margin_calls xlsx (1% percent commission): TV's
    // peak was exactly closed-trades-cum (+148,279.33) while the reversal
    // trade opened on the peak bar had already cost 2,483.81 in entry
    // commission. The TROUGH basis keeps the commission deducted
    // (pessimistic on both sides — matches TV's run-up line exactly).
    const peakBasis = realizedEquity + openCommission;
    if (peakBasis > strategy.equity_peak) strategy.equity_peak = peakBasis;
    if (realizedEquity < strategy.equity_trough) strategy.equity_trough = realizedEquity;

    const posSize = strategy.position_size;
    const avgPrice = strategy.position_avg_price;

    let worstExcursion = 0;
    let bestExcursion = 0;
    if (posSize !== 0 && Number.isFinite(avgPrice)) {
        const worstPrice = posSize > 0 ? lowPrice : highPrice;
        const bestPrice = posSize > 0 ? highPrice : lowPrice;
        // posSize * (avg - worstPrice) is always >= 0 (a loss); same for gain.
        // Multiplied by pointValue to convert price units → account currency.
        worstExcursion = posSize * (avgPrice - worstPrice) * pointValue;
        bestExcursion = posSize * (bestPrice - avgPrice) * pointValue;
    }

    // Drawdown = realized gap from the high-water + the open position's
    // intra-bar adverse excursion. No commission correction here: the peak
    // basis already excludes open entry commissions (see above) while
    // realizedEquity includes them — the asymmetry IS TV's model.
    const drawDown = strategy.equity_peak - realizedEquity + worstExcursion;
    if (drawDown > strategy.max_drawdown) {
        strategy.max_drawdown = drawDown;
        // Snapshot Max_Equity (the realized high-water in force at this
        // moment) — denominator for max_drawdown_percent. Per TV's docs:
        //   ddpct = max_drawdown / Max_Equity-at-latch × 100
        strategy.equity_at_drawdown_peak = strategy.equity_peak;

        // TV's max_drawdown_percent is the RUNNING MAX of the per-latch
        // ratio, not (current_max_drawdown / current_equity_at_peak).
        // The two diverge when a later latch has a larger absolute
        // drawdown but a smaller percentage (equity grew faster). Track
        // the high-water ratio independently of the absolute peak.
        if (strategy.equity_peak > 0) {
            const ratio = (100 * drawDown) / strategy.equity_peak;
            if (ratio > strategy.max_drawdown_percent_value) {
                strategy.max_drawdown_percent_value = ratio;
            }
        }
    }

    const runUp = realizedEquity - strategy.equity_trough + bestExcursion;
    if (runUp > strategy.max_runup) {
        strategy.max_runup = runUp;
        // Snapshot the total equity at this peak — denominator for max_runup_percent.
        strategy.equity_at_runup_peak = realizedEquity + bestExcursion;

        // Symmetric running-max-of-ratio for max_runup_percent. See the
        // max_drawdown_percent comment above for the semantic reason.
        if (strategy.equity_at_runup_peak > 0) {
            const ratio = (100 * runUp) / strategy.equity_at_runup_peak;
            if (ratio > strategy.max_runup_percent_value) {
                strategy.max_runup_percent_value = ratio;
            }
        }
    }
}

interface ActivationSegment {
    qty: number;
    id: string;
    entryId: string;
    bracketEntry: number;
    entryBar: number;
    entryPathSegment?: number;
    entryPathDistance?: number;
}


function activationSegmentsOf(trade: Trade): ActivationSegment[] {
    if (trade._activation_segments !== undefined) {
        return trade._activation_segments.map((segment) => ({ ...segment }));
    }
    return [{
        qty: Math.abs(trade.size),
        id: trade._activation_id ?? trade.id,
        entryId: trade._activation_entry_id ?? trade.entry_id,
        bracketEntry: trade._activation_bracket_entry ?? trade._bracket_entry ?? trade.entry_price,
        entryBar: trade._activation_entry_bar_index ?? trade.entry_bar_index,
        entryPathSegment: trade._activation_entry_path_segment,
        entryPathDistance: trade._activation_entry_path_distance,
    }];
}


function activationSegmentsAfterClose(trades: readonly Trade[], activationIds: readonly string[], qty: number): ActivationSegment[] {
    const targetIds = new Set(activationIds);
    let remaining = qty;
    const segments: ActivationSegment[] = [];
    for (const trade of trades) {
        for (const segment of activationSegmentsOf(trade)) {
            const removed = targetIds.has(segment.id) ? Math.min(remaining, segment.qty) : 0;
            remaining -= removed;
            if (segment.qty - removed > 1e-9) segments.push({ ...segment, qty: segment.qty - removed });
        }
    }
    return segments;
}

function consumedActivationIds(trades: readonly Trade[], activationIds: readonly string[], qty: number): string[] {
    const targetIds = new Set(activationIds);
    const consumed: string[] = [];
    let remaining = qty;
    for (const trade of trades) {
        for (const segment of activationSegmentsOf(trade)) {
            if (remaining <= 1e-9) return consumed;
            if (!targetIds.has(segment.id)) continue;
            const take = Math.min(remaining, segment.qty);
            if (take > 1e-9 && !consumed.includes(segment.id)) consumed.push(segment.id);
            remaining -= take;
        }
    }
    return consumed;
}

function assignActivationSegments(strategy: StrategyState, segments: readonly ActivationSegment[]): void {
    let segmentIndex = 0;
    let segmentOffset = 0;
    for (const trade of strategy.opentrades) {
        const pieces: ActivationSegment[] = [];
        let assigned = 0;
        const tradeQty = Math.abs(trade.size);
        while (assigned < tradeQty - 1e-9 && segmentIndex < segments.length) {
            const segment = segments[segmentIndex];
            const available = segment.qty - segmentOffset;
            const take = Math.min(tradeQty - assigned, available);
            pieces.push({ ...segment, qty: take });
            assigned += take;
            segmentOffset += take;
            if (segmentOffset >= segment.qty - 1e-9) {
                segmentIndex += 1;
                segmentOffset = 0;
            }
        }
        trade._activation_segments = pieces;
        const first = pieces[0];
        if (first !== undefined) {
            trade._activation_id = first.id;
            trade._activation_entry_id = first.entryId;
            trade._activation_bracket_entry = first.bracketEntry;
            trade._activation_entry_bar_index = first.entryBar;
            trade._activation_entry_path_segment = first.entryPathSegment;
            trade._activation_entry_path_distance = first.entryPathDistance;
        }
    }
}
/**
 * Allocate a close against the canonical open-lot queue. `fromEntry` and
 * `specificTradeId` define activation scope only under the default FIFO
 * rule. The legacy ANY rule retains targeted physical allocation.
 */
export function closeMatching(
    context: any,
    fromEntry: string | undefined,
    qtyToClose: number,
    exitPrice: number,
    exitTime: number,
    closeInfo?: CloseInfo,
    specificTradeId?: string,
    excludedTradeIds?: readonly string[],
    activationTradeIds?: readonly string[],
): number {
    const strategy: StrategyState = context.strategy;
    const fifo = (strategy.config.close_entries_rule ?? 'FIFO').toUpperCase() !== 'ANY';
    const chronologicalIndex = fifo
        ? new Map(strategy.opentrades.map((trade, index) => [trade.id, index]))
        : null;
    const eligible: Trade[] = [];
    const others: Trade[] = [];
    for (const trade of strategy.opentrades) {
        const allowed = fifo
            ? !excludedTradeIds?.includes(trade.id)
            : specificTradeId !== undefined
              ? (trade._activation_id ?? trade.id) === specificTradeId && !excludedTradeIds?.includes(trade.id)
              : (!fromEntry || fromEntry === '' || (trade._activation_entry_id ?? trade.entry_id) === fromEntry)
                && !excludedTradeIds?.includes(trade.id);
        if (allowed) eligible.push(trade);
        else others.push(trade);
    }
    if (eligible.length === 0) return 0;
    const eligibleQty = eligible.reduce((sum, trade) => sum + Math.abs(trade.size), 0);
    const effectiveClose = Math.min(qtyToClose, eligibleQty);
    const remainingActivation = fifo && activationTradeIds !== undefined
        ? activationSegmentsAfterClose(strategy.opentrades, activationTradeIds, effectiveClose)
        : null;
    strategy.opentrades = [...eligible, ...others];
    closePartialPosition(context, effectiveClose, exitPrice, exitTime, closeInfo);
    if (chronologicalIndex !== null) {
        strategy.opentrades.sort(
            (left, right) => chronologicalIndex.get(left.id)! - chronologicalIndex.get(right.id)!,
        );
        if (strategy.opentrades.length > 0) {
            strategy.position_entry_name = strategy.opentrades[0].entry_id;
        }
    }
    if (remainingActivation !== null) assignActivationSegments(strategy, remainingActivation);
    return effectiveClose;
}

export function hasPendingMatchingEntry(strategy: StrategyState, fromEntry: string | undefined): boolean {
    return strategy.pending_orders.some(
        (order) =>
            order.status === 'pending'
            && (order.category ?? 'entry') === 'entry'
            && (!fromEntry || order.id === fromEntry),
    );
}

type ExitFillKind = 'profit' | 'loss' | 'trailing' | 'market';

interface ExitFillEvent {
    order: Order;
    orderSequence: number;
    qty: number;
    reservedQty: number;
    direction: number;
    price: number;
    kind: ExitFillKind;
    gap?: boolean;
    atClose?: boolean;
    tradeId?: string;
    activationTradeIds: string[];
    excludedConsumedTradeIds: readonly string[];
    pathSegment: number;
    distanceAlongSegment: number;
    fillCount: number;
}
/**
 * Process exit-category orders each bar (after entry-order fills, before the
 * user script runs). Handles:
 *   - Market exits from strategy.close() / strategy.close_all() (fill at the
 *     current bar's open if placed previously, or at the current close in
 *     the explicit process_orders_on_close phase).
 *   - Conditional exits from strategy.exit() — TP / SL / trailing-stop
 *     triggers evaluated against current bar's high/low. Trailing-stop
 *     peak (trade.trail_peak) is updated each bar even when not triggered.
 *
 * In the COF post-fill drain, `marketExitsOnly` restricts processing to pure
 * market exits emitted by the recalculation; those exits fill at the current
 * assumed tick before the path advances.
 */
export function processExitOrders(
    context: any,
    phase: 'open' | 'intrabar' | 'close' = 'intrabar',
    marketExitsOnly = false,
): number {
    if (!context.strategy) return 0;
    const strategy: StrategyState = context.strategy;
    if (strategy.pending_orders.length === 0) return 0;

    // calc_on_order_fills=true intrabar sequencing (see CofBarState): market
    // closes placed during a same-bar recalculation normally fill on the next
    // assumed intrabar tick. The explicit post-fill drain is the measured
    // exception for pure market exits: it fills them at the current tick.
    // The return value drives the execution loop's recalc decision.
    const cof = strategy.config.calc_on_order_fills === true;
    const cofState = cof ? (strategy._cof ?? null) : null;
    const processOnClose = strategy.config.process_orders_on_close === true;
    const closePhase = phase === 'close' && processOnClose;
    let fills = 0;
    const rawOhlc: OhlcPrices = {
        open: Series.from(context.data.open).get(0),
        high: Series.from(context.data.high).get(0),
        low: Series.from(context.data.low).get(0),
        close: Series.from(context.data.close).get(0),
    };
    const rawOpenPrice = rawOhlc.open;
    const rawClosePrice = rawOhlc.close;
    const currentTime = Series.from(context.data.openTime).get(0);
    const mintick = context.pine?.syminfo?.mintick ?? 0.01;
    const snapExecutionPrices = context.pine?.syminfo?.type === 'stock';
    const displayedOhlc = snapExecutionPrices ? snapDisplayOhlc(rawOhlc, mintick) : rawOhlc;
    const { open: openPrice, high: highPrice, low: lowPrice, close: closePrice } = displayedOhlc;
    const cofTickPrice = cofState
        ? cofState.ticks[Math.min(cofState.pass, cofState.ticks.length - 1)]
        : undefined;
    const atOpenTick = phase === 'open' || cofState === null || cofState.pass === 0;
    const cofPreviousPrice = cofState && cofState.pass > 0
        ? cofState.ticks[cofState.pass - 1]
        : undefined;
    const activationBook = strategy.opentrades.flatMap((trade) =>
        activationSegmentsOf(trade).map((segment) => ({
            ...trade,
            size: Math.sign(trade.size) * segment.qty,
            _activation_id: segment.id,
            _activation_entry_id: segment.entryId,
            _activation_bracket_entry: segment.bracketEntry,
            _activation_entry_bar_index: segment.entryBar,
            _activation_entry_path_segment: segment.entryPathSegment,
            _activation_entry_path_distance: segment.entryPathDistance,
            _activation_segments: undefined,
        })),
    );
    const globalEvents: ExitFillEvent[] = [];
    // VIN-132b: exact distance tie → LOW first (strict <), consistent with
    // assumedIntrabarPath. The old <= sent ties HIGH-first, which fired the
    // TP legs of 1781 bar 66 where TV fires the stops.
    const openCloserToHigh = Math.abs(highPrice - openPrice) < Math.abs(openPrice - lowPrice);
    const path = assumedIntrabarPath(openPrice, highPrice, lowPrice, closePrice);
    const rankEvent = (
        price: number,
        gap: boolean,
        forcedSegment?: number,
        atClose = false,
    ): { pathSegment: number; distanceAlongSegment: number } => {
        if (atClose) {
            return { pathSegment: Number.MAX_SAFE_INTEGER, distanceAlongSegment: 0 };
        }
        if (gap || phase === 'open' || (cofState !== null && cofState.pass === 0)) {
            return { pathSegment: -1, distanceAlongSegment: 0 };
        }
        if (cofState !== null) {
            return {
                pathSegment: cofState.pass,
                distanceAlongSegment: Math.abs(price - (cofPreviousPrice as number)),
            };
        }
        const start = forcedSegment ?? 0;
        const end = forcedSegment === undefined ? path.length - 1 : forcedSegment + 1;
        for (let segment = start; segment < end; segment++) {
            const lo = Math.min(path[segment], path[segment + 1]);
            const hi = Math.max(path[segment], path[segment + 1]);
            if (price >= lo - 1e-9 && price <= hi + 1e-9) {
                const length = Math.abs(path[segment + 1] - path[segment]);
                return {
                    pathSegment: segment,
                    distanceAlongSegment: length > 0 ? Math.abs(price - path[segment]) / length : 0,
                };
            }
        }
        return { pathSegment: Number.MAX_SAFE_INTEGER, distanceAlongSegment: 0 };
    };
    const forcedSegmentFor = (execution: PathTrigger | undefined): number | undefined => {
        if (execution === undefined || execution.position.pathSegment < 0) return undefined;
        return comparePathPositions(rankEvent(execution.fillPrice, false), execution.position) === 0
            ? undefined
            : execution.position.pathSegment;
    };

    // Two-phase evaluation (TV broker-emulator order precedence at the
    // bar's open):
    //   phase 'open'     — runs BEFORE entry fills. Only conditional-exit
    //                      GAP-FILLS execute (the bar opened already past a
    //                      bracket's trigger → fill at the open). Brackets
    //                      consumed here never extend to entries filling at
    //                      the same open.
    //   phase 'intrabar' — runs AFTER entry fills. Everything else:
    //                      market closes, intra-bar crossings, trail, and
    //                      gap-fills for trades that ATTACHED at this bar's
    //                      open (an exit order waiting on a not-yet-filled
    //                      entry brackets it at fill time — if the open is
    //                      already past the trigger it exits immediately).
    //
    // QA evidence (pyramiding avg_price xlsx, BTCUSDC 1D): a stop
    // gap-firing at the open closes ONLY the prior stack — the pyramid
    // entry filling at that same open survives (2024-03-21); while an exit
    // order surviving to intra-bar crossing closes same-bar entries too
    // (2020-12-17), and a waiting order attaches to a reversal entry and
    // gap-exits it at its own fill price (2021-09-08).
    for (const [orderSequence, order] of strategy.pending_orders.entries()) {
        if (order.status !== 'pending') continue;
        if ((order.category ?? 'entry') !== 'exit') continue;
        const isPureMarketExit =
            order.type === 'market' &&
            order.profit === undefined &&
            order.loss === undefined &&
            order.limit === undefined &&
            order.stop === undefined &&
            order.trail_price === undefined &&
            order.trail_points === undefined;
        // VIN-120: the same-tick drain also admits the exit bracket the
        // CURRENT recalculation created fresh — pass marker equals the
        // current COF pass and the order belongs to this bar. Only that one
        // conditional passes; pre-existing/refreshed brackets and pyramided
        // books keep their next-path semantics (1502 byte-identical).
        const cofMarkedThisPass = cofState !== null
            && order.bar === context.idx
            && order._cof_fresh_single_trade_exit_pass !== undefined
            && order._cof_fresh_single_trade_exit_pass === cofState.pass;
        if (marketExitsOnly && !isPureMarketExit && !cofMarkedThisPass) continue;

        // Gather matching open trades (from_entry filter; '' = all).
        // For market closes from strategy.close_all() / strategy.close(id),
        // additionally restrict to the trade IDs captured at QUEUE time —
        // these orders are bound to the position state at call time, not
        // fill time. If a reversal entry implicitly closed the snapshotted
        // trades before this order fires, the order has no target and gets
        // cancelled, mirroring TV's behavior of treating
        // strategy.close_all() as a no-op when its intended position is
        // already gone.
        const excludedActivationTradeIds = order._excluded_activation_trade_ids;
        const excludedConsumedTradeIds = order._excluded_consumed_trade_ids ?? [];
        const boundActivationIds = order.from_entry
            && (order._exit_bound_activation_ids?.length ?? 0) > 0
            ? undefined
            : order._exit_bound_activation_ids;
        const boundEntryIds = order.from_entry && (strategy.config.pyramiding ?? 1) > 1
            ? undefined
            : order._exit_bound_entry_ids;
        const boundDirection = order._exit_bound_direction;
        let matching = activationBook.filter(
            (t) => {
                const activationId = t._activation_id ?? t.id;
                const entryId = t._activation_entry_id ?? t.entry_id;
                const matchesCallBinding = boundActivationIds === undefined
                    || boundActivationIds.includes(activationId)
                    || boundEntryIds?.includes(entryId) === true
                    // Explicit from_entry brackets may continue across
                    // same-direction physical re-entries; the call-time
                    // direction still blocks a reversal activation.
                    || (
                        order.from_entry !== ''
                        && boundDirection !== undefined
                        && Math.sign(t.size) === boundDirection
                    );
                return (
                    (!order.from_entry || entryId === order.from_entry)
                    && (boundDirection === undefined || Math.sign(t.size) === boundDirection)
                    && matchesCallBinding
                    && !excludedActivationTradeIds?.includes(activationId)
                );
            },
        );
        if (order._intended_trade_ids) {
            const snapshot = new Set(order._intended_trade_ids);
            matching = matching.filter((t) => snapshot.has(t.id));
        }
        const waitingForBoundEntry = boundEntryIds !== undefined
            && boundEntryIds.some((entryId) =>
                strategy.pending_orders.some(
                    (candidate) =>
                        candidate.status === 'pending'
                        && (candidate.category ?? 'entry') === 'entry'
                        && candidate.id === entryId,
                ),
            );
        if (matching.length === 0) {
            // Exit orders placed before their matching entry wait for it,
            // including deferred entries captured at call time. Once the
            // captured entry is cancelled, the exit is dead; it must not
            // attach to a later opposite-direction activation.
            const waitingForEntry = waitingForBoundEntry
                || (
                    cof
                    && !order._intended_trade_ids
                    && hasPendingMatchingEntry(strategy, order.from_entry)
                );
            if ((phase === 'intrabar' || closePhase) && !waitingForEntry) {
                order.status = 'cancelled';
            }
            continue;
        }

        const matchingQty = matching.reduce((sum, t) => sum + Math.abs(t.size), 0);
        const matchingDir = Math.sign(matching[0].size); // direction of the position to close

        // ---- Market exits from close() / close_all() ----
        if (isPureMarketExit) {
            // Market closes fill in the intrabar phase (after entries) —
            // their interplay with reversal entries is governed by the
            // _intended_trade_ids snapshot above.
            if (phase === 'open') continue;
            // Current-bar market closes are eligible in the explicit
            // process_orders_on_close phase; otherwise they remain deferred
            // unless the existing COF same-bar path is active.
            if (order.bar >= context.idx && !cof && !closePhase) continue;

            // Determine fill price; immediately=true (when supported) would fire
            // at current close; default is current bar's open. In
            // calc_on_order_fills mode a same-bar close fills at the current
            // assumed intrabar tick's OHLC value. The process-on-close phase
            // overrides that only for a current-bar market close.
            let fillPrice = closePhase && order.bar === context.idx
                ? rawClosePrice
                : cofState && order.bar === context.idx
                  ? cofState.ticks[Math.min(cofState.pass, cofState.ticks.length - 1)]
                  : order.immediately
                    ? rawClosePrice
                    : rawOpenPrice;
            // Apply slippage against the close direction (opposite of position direction).
            fillPrice = applySlippage(context, -matchingDir, fillPrice);

            let qtyToClose = matchingQty;
            if (order._explicit_qty_cap || (order.qty && order.qty > 0)) qtyToClose = Math.min(order.qty, matchingQty);
            else if (order.qty_percent && order.qty_percent > 0) {
                qtyToClose = matchingQty * (order.qty_percent / 100);
            }

            globalEvents.push({
                order,
                orderSequence,
                qty: qtyToClose,
                reservedQty: qtyToClose,
                direction: matchingDir,
                price: fillPrice,
                kind: 'market',
                gap: true,
                activationTradeIds: matching.map((trade) => trade._activation_id ?? trade.id),
                excludedConsumedTradeIds,
                fillCount: 1,
                ...rankEvent(fillPrice, true),
            });
            continue;
        }
        // Current-bar conditionals are evaluated against the close only.
        // Older orders already had their full OHLC pass; future-dated
        // orders cannot execute in this phase.
        if (closePhase && order.bar > context.idx) continue;
        const closeOnly =
            closePhase
            && order.bar === context.idx
            && order._isPersistent === true
            && order._exit_refreshed !== true;
        if (closePhase && order.bar === context.idx && !closeOnly) continue;

        // ---- Conditional exits from exit() ----
        // PER-TRADE exit brackets (TV broker-emulator semantics): when a
        // strategy.exit matches multiple open trades (pyramiding), TV
        // creates an independent exit bracket for EACH trade:
        //   - profit / loss (tick) legs compute the trigger from THAT
        //     trade's own entry price;
        //   - limit / stop (absolute price) legs are shared by all trades.
        // When several brackets trigger inside one bar, the fills execute
        // in intra-bar crossing order and each fill closes the OLDEST
        // remaining trades first (FIFO) — NOT necessarily the trade whose
        // bracket computed the level. Verified against the QA pyramiding
        // xlsx (BTCUSDC 1D, 2020-03-12 crash bar: five short TPs filled
        // at five different prices, assigned to trades strictly
        // oldest-first).
        //
        // Trailing legs stay COMPOSITE (one armed peak per order, armed
        // against the weighted-avg entry) — no TV evidence for per-trade
        // trail under pyramiding yet; single-trade behavior is identical
        // either way.
        let totalCost = 0;
        for (const t of matching) {
            totalCost += Math.abs(t.size) * (t._activation_bracket_entry ?? t._bracket_entry ?? t.entry_price);
        }
        const avgEntry = totalCost / matchingQty;
        const isLong = matchingDir === 1;

        // Shared absolute legs (validated below); per-trade tick legs are
        // computed inside the bracket loop further down.
        let absTp: number | undefined = order.limit;
        let absSl: number | undefined = order.stop;

        // Validate trigger prices are on the correct side of avgEntry —
        // EPHEMERAL pattern only. A wrong-sided leg (e.g. SL below entry
        // for a short, TP above entry for a short) typically arises when
        // the user computes the price from strategy.position_avg_price
        // BEFORE a reversal fill — the value reflects the OUTGOING
        // position. For sparse/ephemeral exits (variable scoped inside
        // an if-block), TV's lazy series-eval gives NA on non-trigger
        // bars → no fire; PT mirrors that by dropping the wrong-sided
        // leg here.
        //
        // For PERSISTENT exits (every-bar refresh, main-scope variable),
        // TV trusts the captured value and lets gap-fill produce the
        // actual reachable price — a stale TP sitting on the wrong side
        // of entry will still fire at the bar's open via gap-fill when
        // the open is past the trigger. Dropping wrong-sided legs here
        // would miss that.
        if (!order._isPersistent && !cofMarkedThisPass) {
            if (absSl !== undefined) {
                const slValid = isLong ? absSl < avgEntry : absSl > avgEntry;
                if (!slValid) absSl = undefined;
            }
            if (absTp !== undefined) {
                const tpValid = isLong ? absTp > avgEntry : absTp < avgEntry;
                if (!tpValid) absTp = undefined;
            }
        }


        // Trailing-stop state.
        // Two arming modes:
        //   trail_price: armed when market reaches the absolute price level
        //   trail_points: armed when market moves N ticks in favor from entry
        // After arming, ride at trail_offset ticks behind the running peak.
        //
        // Pine semantic: the trail cannot arm and trigger on the same
        // bar. The arming bar establishes the running peak; the trigger
        // check is suppressed for that bar only. SL and TP triggers are
        // independent and still fire on the arming bar.
        // Trail arming + evaluation are intra-bar phenomena — they run in
        // the 'intrabar' phase only (arming twice per bar would corrupt
        // trailArmedThisBar, making the segment model treat the arming bar
        // as an armed-prior bar).
        let trailArmedThisBar = false;
        let trailArmPrice: number | undefined;
        let trailActivationPosition: IntrabarPathPosition | undefined;
        if (phase === 'intrabar' && !order.trail_armed && (order.trail_price !== undefined || order.trail_points !== undefined)) {
            let armPrice: number | undefined;
            if (order.trail_price !== undefined) armPrice = order.trail_price;
            else if (order.trail_points !== undefined) {
                armPrice = isLong ? avgEntry + order.trail_points * mintick : avgEntry - order.trail_points * mintick;
            }
            if (armPrice !== undefined) {
                const armed = isLong ? highPrice >= armPrice : lowPrice <= armPrice;
                if (armed) {
                    trailArmPrice = armPrice;
                    trailActivationPosition = firstTriggerAfter(
                        path,
                        armPrice,
                        isLong ? (price) => price >= armPrice! : (price) => price <= armPrice!,
                        { pathSegment: -1, distanceAlongSegment: 0 },
                        openPrice,
                    )?.position;
                    order.trail_armed = true;
                    order.trail_peak = isLong ? highPrice : lowPrice;
                    trailArmedThisBar = true;
                }
            }
        }
        // Peak update is now deferred to checkTrail so we can split it
        // around the intra-bar segment that TV's broker emulator assumes
        // (favorable-first: peak updates BEFORE trigger check;
        //  adverse-first: peak updates AFTER segment-1 check against the
        //  OLD peak's trigger). Eager peak update produced phantom early
        //  fires on adverse-first bars where the bar's high established
        //  the new peak only AFTER the low had already passed.

        // The trail trigger is now computed inside checkTrail's
        // segment branches (using OLD peak for segment 1, NEW peak for
        // segment 3 on adverse-first; new peak unconditionally on
        // favorable-first). See checkTrail below.

        // Evaluate TP/SL against the current COF path point. Outside COF the
        // existing full-bar path model remains in force.
        const favorableFirst = isLong ? openCloserToHigh : !openCloserToHigh;

        // Per-trade bracket evaluation. Each triggered bracket becomes a
        // fill EVENT; events execute in intra-bar crossing order, and each
        // closes the oldest remaining matching trades first (FIFO).
        //
        // Gap-fill rule: if the bar's OPEN is already past a trigger, the
        // fill price is the OPEN, not the literal trigger price. This
        // mirrors real broker behavior — if you'd planned a stop at $100
        // and the bar opens at $95, you fill at $95.
        type FillEvent = {
            qty: number;
            price: number;
            kind: 'profit' | 'loss' | 'trailing';
            tradeId?: string;
            gap?: boolean;
            atClose?: boolean;
            forcedSegment?: number;
            sourceCount?: number;
        };
        const tpEvents: FillEvent[] = [];
        const slEvents: FillEvent[] = [];

        // Margin-call bracket lock: after a same-bar margin call, only the
        // bracket of the lot the MC partially consumed stays working for
        // the rest of the bar — the other lots' brackets are canceled and
        // re-created by the next strategy.exit call (see processMarginCall
        // for the QA evidence).
        const mcLock = (strategy as any)._mc_exit_lock;
        const mcLocked = mcLock && mcLock.bar === context.idx;

        for (const t of matching) {
            const activationId = t._activation_id ?? t.id;
            if (mcLocked && activationId !== mcLock.tradeId) continue;
            const entry = t._activation_bracket_entry ?? t._bracket_entry ?? t.entry_price;
            const tQty = Math.abs(t.size);
            let tp = absTp;
            if (tp === undefined && order.profit !== undefined) {
                const derivedTp = isLong ? entry + order.profit * mintick : entry - order.profit * mintick;
                tp = roundToMintick(derivedTp, entry, mintick);
            }
            let sl = absSl;
            if (sl === undefined && order.loss !== undefined) {
                const derivedSl = isLong ? entry - order.loss * mintick : entry + order.loss * mintick;
                sl = roundToMintick(derivedSl, entry, mintick);
            }

            // A waiting bracket can attach to an entry filled on this bar,
            // but only the remaining path is executable. Prices visited
            // before that entry filled cannot retroactively trigger it.
            // TV 2257 proves both sides: Long2 enters at the open and its
            // bracket fills on the later rise, while Long5 enters during a
            // later down-segment and its already-marketable bracket does not
            // inherit the bar's earlier open/high.
            const entryBar = t._activation_entry_bar_index ?? t.entry_bar_index;
            const entryPathSegment = t._activation_entry_path_segment;
            const gateToActivation = phase === 'intrabar'
                && cofState === null
                && entryBar === context.idx
                && entryPathSegment !== undefined;
            const activationPosition: IntrabarPathPosition | undefined = gateToActivation
                ? {
                    pathSegment: entryPathSegment,
                    distanceAlongSegment: t._activation_entry_path_distance ?? 0,
                }
                : undefined;
            const activationPrice = entryPathSegment === -1 ? openPrice : entry;
            let tpExecution: PathTrigger | undefined;
            let slExecution: PathTrigger | undefined;
            let slHit = false;

            // During COF, price-based orders require a fresh crossing of
            // their level. A recalculation can refresh an order while price
            // is already beyond it; that order stays inert until the path
            // crosses again.
            let tpHit = false;
            if (tp !== undefined) {
                if (closeOnly) {
                    // process_orders_on_close evaluates a bracket placed on
                    // this bar against the close only. High/low values from
                    // the already-completed intrabar path are not replayed.
                    tpHit = isLong ? closePrice >= tp : closePrice <= tp;
                } else if (activationPosition !== undefined) {
                    tpExecution = firstTriggerAfter(
                        path,
                        tp,
                        isLong ? (price) => price >= tp! : (price) => price <= tp!,
                        activationPosition,
                        activationPrice,
                    );
                    tpHit = tpExecution !== undefined;
                } else if (phase === 'open' || (cofState !== null && cofState.pass === 0)) {
                    tpHit = isLong ? openPrice >= tp : openPrice <= tp;
                } else if (cofState !== null && cofMarkedThisPass) {
                    // A fresh bracket is marketable when the CURRENT tick is
                    // already past its level — no prior-tick crossing is
                    // required (the leg did not exist before this tick; the
                    // wrong-sided-but-marketable 2205 cases prove it).
                    tpHit = isLong ? cofTickPrice! >= tp : cofTickPrice! <= tp;
                } else if (cofState !== null) {
                    tpHit = isLong
                        ? cofPreviousPrice! < tp && cofTickPrice! >= tp
                        : cofPreviousPrice! > tp && cofTickPrice! <= tp;
                } else {
                    tpHit = isLong ? highPrice >= tp : lowPrice <= tp;
                }
            }
            if (sl !== undefined) {
                if (closeOnly) {
                    // A close-phase stop is marketable only when the close
                    // itself is beyond the current stop. Do not reuse a
                    // historical low/high crossing from the intrabar pass.
                    slHit = isLong ? closePrice <= sl : closePrice >= sl;
                } else if (activationPosition !== undefined) {
                    slExecution = firstTriggerAfter(
                        path,
                        sl,
                        isLong ? (price) => price <= sl! : (price) => price >= sl!,
                        activationPosition,
                        activationPrice,
                    );
                    slHit = slExecution !== undefined;
                } else if (phase === 'open' || (cofState !== null && cofState.pass === 0)) {
                    slHit = isLong ? openPrice <= sl : openPrice >= sl;
                } else if (cofState !== null && cofMarkedThisPass) {
                    slHit = isLong ? cofTickPrice! <= sl : cofTickPrice! >= sl;
                } else if (cofState !== null) {
                    slHit = isLong
                        ? cofPreviousPrice! > sl && cofTickPrice! <= sl
                        : cofPreviousPrice! < sl && cofTickPrice! >= sl;
                } else {
                    slHit = isLong ? lowPrice <= sl : highPrice >= sl;
                }
            }

            // OCO per trade: when both legs are reachable, the first one
            // along the executable portion of the assumed path wins.
            let kind: 'profit' | 'loss' | null = null;
            if (tpHit && slHit) {
                kind = tpExecution !== undefined && slExecution !== undefined
                    ? comparePathPositions(tpExecution.position, slExecution.position) <= 0
                        ? 'profit'
                        : 'loss'
                    : favorableFirst
                      ? 'profit'
                      : 'loss';
            } else if (tpHit) kind = 'profit';
            else if (slHit) kind = 'loss';

            if (kind === 'loss') {
                const openPastSl = cofMarkedThisPass
                    ? (isLong ? cofTickPrice! <= (sl as number) : cofTickPrice! >= (sl as number))
                    : !closeOnly && (
                        slExecution !== undefined
                            ? slExecution.position.pathSegment === -1
                            : atOpenTick && (isLong ? openPrice <= (sl as number) : openPrice >= (sl as number))
                    );
                // TV asymmetry (637-event census from the gap_precedence
                // probe, BTCUSDT 1D): a BUY-stop — the SL leg of a SHORT
                // position — that is already in-the-money at the open does
                // NOT catch a trade that entered at that same open
                // (spared 234/234), while sell-stops and both-side limits
                // always catch (403/403). Suppress the stop leg for
                // same-bar short entries gapped past at the open; the TP
                // leg (if also reachable) still applies.
                const buyStopSparesFreshEntry = !isLong && openPastSl && entryBar === context.idx;
                if (!buyStopSparesFreshEntry) {
                    slEvents.push({
                        qty: tQty,
                        price: cofMarkedThisPass
                            ? cofTickPrice!
                            : closeOnly
                              ? closePrice
                              : slExecution?.fillPrice ?? (openPastSl ? rawOpenPrice : (sl as number)),
                        kind: 'loss',
                        tradeId: activationId,
                        gap: openPastSl,
                        atClose: closeOnly,
                        forcedSegment: forcedSegmentFor(slExecution),
                    });
                } else if (tpHit) {
                    kind = 'profit';
                }
            }
            if (kind === 'profit') {
                const openPastTp = cofMarkedThisPass
                    ? (isLong ? cofTickPrice! >= (tp as number) : cofTickPrice! <= (tp as number))
                    : !closeOnly && (
                        tpExecution !== undefined
                            ? tpExecution.position.pathSegment === -1
                            : atOpenTick && (isLong ? openPrice >= (tp as number) : openPrice <= (tp as number))
                    );
                tpEvents.push({
                    qty: tQty,
                    price: cofMarkedThisPass
                        ? cofTickPrice!
                        : closeOnly
                          ? closePrice
                          : tpExecution?.fillPrice ?? (openPastTp ? rawOpenPrice : (tp as number)),
                    kind: 'profit',
                    tradeId: activationId,
                    gap: openPastTp,
                    atClose: closeOnly,
                    forcedSegment: forcedSegmentFor(tpExecution),
                });
            }
        }

        // Crossing order within each leg: the TP leg is crossed while
        // price travels toward the FAVORABLE extreme (ascending prices for
        // a long, descending for a short); the SL leg while traveling
        // toward the ADVERSE extreme (the reverse). Gap-fills carry
        // price = open and naturally sort to the front of their leg.
        tpEvents.sort((a, b) => (isLong ? a.price - b.price : b.price - a.price));
        slEvents.sort((a, b) => (isLong ? b.price - a.price : a.price - b.price));
        // Composite trailing leg — same intra-bar segment model as before
        // (TV broker emulator), emitting an event for the REMAINING qty
        // instead of firing directly:
        //
        // Favorable-first (open closer to high for long; open closer to
        // low for short):
        //   Phase 1: open → favorable extreme (price rides to bar H for
        //            long / bar L for short). Peak updates to that.
        //   Phase 2: favorable extreme → adverse extreme. Trigger
        //            (= NEW peak ± offset) may be crossed.
        //   Phase 3: adverse extreme → close. (Already covered.)
        //
        // Adverse-first (open closer to adverse extreme):
        //   Phase 1: open → adverse extreme. Peak is still PRIOR. Check
        //            trigger using OLD peak; if crossed, fire there.
        //   Phase 2: adverse → favorable extreme. Peak updates now.
        //   Phase 3: favorable → close. If close descends/rises
        //            through the NEW trigger, fire at the NEW trigger.
        //
        // Arming THIS bar is a sub-case: the peak was JUST established
        // at the arming moment (bar's H for long / L for short). The
        // segment-1 check with OLD peak doesn't apply (trail wasn't
        // armed yet). Only phase 2 (favorable-first) or phase 3
        // (adverse-first) can fire on the arming bar.
        //
        // The offset is truncated toward zero before the stop is computed.
        // The rounded stop is the level used for both crossing and
        // fill; a gap through an already-armed stop fills at the bar's open.
        let trailEvent: FillEvent | null = null;
        if (phase === 'intrabar' && !mcLocked && order.trail_armed && order.trail_offset !== undefined) {
            const updatePeak = () => {
                if (isLong) order.trail_peak = Math.max(order.trail_peak ?? -Infinity, highPrice);
                else order.trail_peak = Math.min(order.trail_peak ?? Infinity, lowPrice);
            };
            const whole = Math.trunc(order.trail_offset as number);
            const roundTrailLevel = (raw: number): number => {
                if (!mintick || mintick <= 0 || !Number.isFinite(raw)) return raw;
                const ticks = raw / mintick;
                const nearestTicks = Math.round(ticks);
                const nearestGrid = nearestTicks * mintick;
                // Snap only representation noise in price units. A genuine
                // sub-tick fraction remains visible to the per-side ceil or
                // floor below.
                const priceTolerance = 1e-12 * Math.max(1, Math.abs(raw));
                const roundedTicks = Math.abs(raw - nearestGrid) <= priceTolerance
                    ? nearestTicks
                    : isLong
                      ? Math.floor(ticks)
                      : Math.ceil(ticks);
                const mintickNotation = mintick.toString().toLowerCase();
                const [coefficient, exponentText] = mintickNotation.split('e');
                const exponent = exponentText === undefined ? 0 : Number(exponentText);
                const decimalPlaces = Math.max(0, (coefficient.split('.')[1]?.length ?? 0) - exponent);
                return Number((roundedTicks * mintick).toFixed(decimalPlaces));
            };
            const triggerFromPeak = (peak: number = order.trail_peak as number): number => {
                const raw = isLong
                    ? peak - whole * mintick
                    : peak + whole * mintick;
                return roundTrailLevel(raw);
            };
            const emitTrail = (price: number, forcedSegment?: number, gap = false) => {
                trailEvent = {
                    qty: Infinity,
                    price: gap ? rawOpenPrice : price,
                    kind: 'trailing',
                    gap,
                    forcedSegment,
                };
            };

            const priorPeak = order.trail_peak as number;
            const priorTrigger = Number.isFinite(priorPeak) ? triggerFromPeak(priorPeak) : undefined;
            const gapAtOpen = atOpenTick
                && !trailArmedThisBar
                && priorTrigger !== undefined
                && (isLong ? openPrice < priorTrigger : openPrice > priorTrigger);
            if (gapAtOpen) {
                emitTrail(openPrice, undefined, true);
            } else if (trailArmedThisBar) {
                // Peak is already the bar's favorable extreme (set by the
                // arming logic). A sub-tick offset fills at the activation
                // crossing using the away-rounded trail_price.
                if (whole === 0) {
                    const activationFillPrice = order.trail_price !== undefined
                        ? order.trail_price
                        : trailArmPrice !== undefined
                          ? roundToMintick(trailArmPrice, avgEntry, mintick)
                          : undefined;
                    if (activationFillPrice !== undefined) {
                        const activationSegment = trailActivationPosition?.pathSegment;
                        emitTrail(
                            activationFillPrice,
                            activationSegment !== undefined && activationSegment >= 0 ? activationSegment : undefined,
                        );
                    }
                } else {
                    const trig = triggerFromPeak();
                    if (favorableFirst) {
                        // Phase 2 (favorable extreme → adverse extreme): low for
                        // long / high for short crosses trigger.
                        const hit = isLong ? lowPrice <= trig : highPrice >= trig;
                        if (hit) emitTrail(trig, 1);
                    } else {
                        // Phase 3 (favorable extreme → close): close past trigger.
                        const seg3 = isLong ? closePrice <= trig : closePrice >= trig;
                        if (seg3) emitTrail(trig, 2);
                    }
                }
            } else if (favorableFirst) {
                // Already armed in a prior bar. Full segment model.
                updatePeak();
                const trig = triggerFromPeak();
                const hit = isLong ? lowPrice <= trig : highPrice >= trig;
                if (hit) emitTrail(trig, 1);
            } else {
                const oldTrig = triggerFromPeak();
                const seg1 = isLong ? lowPrice <= oldTrig : highPrice >= oldTrig;
                if (seg1) {
                    emitTrail(oldTrig, 0);
                } else {
                    updatePeak();
                    const newTrig = triggerFromPeak();
                    const seg3 = isLong ? closePrice <= newTrig : closePrice >= newTrig;
                    if (seg3) emitTrail(newTrig, 2);
                }
            }
        }

        // Path-ordered event list (mirrors the old checkTp/checkSl/
        // checkTrail priority: TP leg first on favorable-first bars;
        // SL then trail then TP on adverse-first bars).
        const events: FillEvent[] = favorableFirst
            ? [...tpEvents, ...slEvents, ...(trailEvent ? [trailEvent] : [])]
            : [...slEvents, ...(trailEvent ? [trailEvent] : []), ...tpEvents];

        if (events.length === 0) continue;

        let reservedQty = matchingQty;
        if (order._explicit_qty_cap || (order.qty && order.qty > 0)) reservedQty = Math.min(order.qty, matchingQty);
        else if (order.qty_percent && order.qty_percent > 0) {
            reservedQty = matchingQty * (order.qty_percent / 100);
        }

        const combinedEvents: FillEvent[] = [];
        for (const event of events) {
            const existing = combinedEvents.find(
                (candidate) =>
                    candidate.kind === event.kind
                    && candidate.price === event.price
                    && candidate.gap === event.gap
                    && candidate.atClose === event.atClose
                    && candidate.forcedSegment === event.forcedSegment,
            );
            if (existing === undefined) {
                combinedEvents.push({ ...event, sourceCount: 1 });
            } else {
                existing.qty = existing.qty === Infinity || event.qty === Infinity
                    ? Infinity
                    : existing.qty + event.qty;
                existing.tradeId = undefined;
                existing.sourceCount = (existing.sourceCount ?? 1) + 1;
            }
        }
        for (const event of combinedEvents) {
            globalEvents.push({
                order,
                orderSequence,
                qty: event.qty,
                reservedQty,
                direction: matchingDir,
                price: event.price,
                kind: event.kind,
                gap: event.gap === true,
                atClose: event.atClose === true,
                tradeId: event.tradeId,
                activationTradeIds: matching.map((trade) => trade._activation_id ?? trade.id),
                excludedConsumedTradeIds,
                fillCount: event.sourceCount ?? 1,
                ...rankEvent(event.price, event.gap === true, event.forcedSegment, event.atClose === true),
            });
        }
    }
    globalEvents.sort((left, right) =>
        left.pathSegment - right.pathSegment
        || left.distanceAlongSegment - right.distanceAlongSegment
        || left.orderSequence - right.orderSequence,
    );

    const capRemaining = new Map<Order, number>();
    const lastFillByOrder = new Map<Order, number>();
    for (const event of globalEvents) {
        const remainingCap = capRemaining.get(event.order) ?? event.reservedQty;
        if (remainingCap <= 1e-9 || event.order.status !== 'pending') continue;

        const liveQty = strategy.opentrades
            .filter((trade) =>
                Math.sign(trade.size) === event.direction
                && !event.excludedConsumedTradeIds.includes(trade.id),
            )
            .reduce((sum, trade) => sum + Math.abs(trade.size), 0);
        if (liveQty <= 1e-9) continue;
        const qtyThis = Math.min(event.qty === Infinity ? liveQty : event.qty, remainingCap, liveQty);
        // Profit events are limit take-profits and do not receive slippage.
        // Market, loss/stop, and trailing events retain the configured
        // strategy slippage.
        const nominalFillPrice = event.kind === 'market' || event.kind === 'profit'
            ? event.price
            : applySlippage(context, -event.direction, event.price);
        // Market, close-phase, and OHLC-gap executions on the proved stock
        // surface snap after slippage. Other asset classes retain their prior
        // execution representation until an equivalent oracle proves this
        // rule there.
        const fillPrice = snapExecutionPrices
            && (event.kind === 'market' || event.gap === true || event.atClose === true)
            ? snapExecutionPrice(nominalFillPrice, mintick)
            : nominalFillPrice;
        const sizesBefore = new Map(strategy.opentrades.map((trade) => [trade.id, Math.abs(trade.size)]));
        const exitComment = event.kind === 'profit'
            ? (event.order.comment_profit ?? event.order.comment)
            : event.kind === 'loss'
              ? (event.order.comment_loss ?? event.order.comment)
              : event.kind === 'trailing'
                ? (event.order.comment_trailing ?? event.order.comment)
                : event.order.comment;
        const closeInfo: CloseInfo = {
            exitId: event.order.id,
            exitComment,
        };
        if (event.kind !== 'market') closeInfo.triggerKind = event.kind;

        const eventActivationIds = event.tradeId !== undefined
            ? [event.tradeId]
            : event.kind === 'market'
              ? []
              : event.activationTradeIds;
        const activatedIds = consumedActivationIds(strategy.opentrades, eventActivationIds, qtyThis);
        const closedQty = closeMatching(
            context,
            event.order.from_entry,
            qtyThis,
            fillPrice,
            currentTime,
            closeInfo,
            event.tradeId,
            event.excludedConsumedTradeIds,
            event.tradeId !== undefined ? [event.tradeId] : event.activationTradeIds,
        );
        if (closedQty <= 1e-9) continue;

        const nextCap = remainingCap - closedQty;
        capRemaining.set(event.order, nextCap);
        lastFillByOrder.set(event.order, fillPrice);
        fills += event.fillCount;

        const excludedActivation = event.order._excluded_activation_trade_ids ??= [];
        for (const tradeId of activatedIds) {
            if (!excludedActivation.includes(tradeId)) excludedActivation.push(tradeId);
        }

        const partialExit = (event.order.qty ?? 0) > 0 || (event.order.qty_percent ?? 0) > 0;
        if ((cof || partialExit) && event.order._exit_lifecycle_key !== undefined) {
            const lifecycleMap = strategy._filled_exit_trade_ids ??= new Map();
            const previous = lifecycleMap.get(event.order._exit_lifecycle_key);
            const lifecycle = previous?.bar === context.idx
                ? previous
                : {
                    bar: context.idx,
                    activationTradeIds: partialExit ? [...(previous?.activationTradeIds ?? [])] : [],
                    consumedTradeIds: [],
                };
            for (const tradeId of activatedIds) {
                if (!lifecycle.activationTradeIds.includes(tradeId)) lifecycle.activationTradeIds.push(tradeId);
            }
            const sizesAfter = new Map(strategy.opentrades.map((trade) => [trade.id, Math.abs(trade.size)]));
            for (const [tradeId, sizeBefore] of sizesBefore) {
                const sizeAfter = sizesAfter.get(tradeId) ?? 0;
                if (sizeAfter < sizeBefore - 1e-9 && !lifecycle.consumedTradeIds.includes(tradeId)) {
                    lifecycle.consumedTradeIds.push(tradeId);
                }
            }
            lifecycleMap.set(event.order._exit_lifecycle_key, lifecycle);
        }

        // Keep the broker order alive until every crossed event collected
        // for this pass has executed, bounded by its reserved quantity.
    }

    for (const [order, fillPrice] of lastFillByOrder) {
        order.status = 'filled';
        order.fill_price = fillPrice;
        order.fill_bar = context.idx;
        order.fill_time = currentTime;
    }


    // Remove filled/cancelled exit orders.
    strategy.pending_orders = strategy.pending_orders.filter((o) => o.status === 'pending');
    if (Math.abs(strategy.position_size) < 1e-9) {
        strategy._filled_exit_trade_ids?.clear();
    }

    // Refresh equity for any caller reading metrics between processExitOrders
    // and the bar-finalize step. Peaks are latched in finalizeBar().
    markToMarket(context, closePrice);
    return fills;
}

/**
 * Apply a SECOND margin call scheduled by the phantom re-check (see
 * processMarginCall). TV books that fill at the PREVIOUS bar's close,
 * AFTER the script's on-close evaluation — so the script and any order
 * it queued saw the pre-MC#2 position. PineTS mirrors this by booking
 * the fill at the very start of the NEXT bar, before entries process:
 * a reversal queued at the MC bar's close (qty frozen at queue time)
 * then naturally overshoots by exactly q2, reproducing TV's phantom
 * opposite-side position (xlsx-confirmed: 2021-10-02 reversal long
 * 5.263108 = 5 + 0.263108).
 *
 * Same-direction (non-reversal) entries queued on the MC bar are
 * CANCELED — TV's transient post-MC state rejects them (2022-04-19: the
 * add queued at the 04-18 close never filled; the next add was accepted
 * a bar later). Opposite-direction reversals are unaffected (E1), and a
 * close-MC that flattens the position leaves nothing to gate (IC=900k
 * experiment: next-open entry from flat was admitted).
 */
export function applyPendingCloseMarginCall(context: any): void {
    const strategy: StrategyState = context.strategy;
    if (!strategy) return;
    const pending = (strategy as any)._pending_close_mc;
    if (!pending) return;
    (strategy as any)._pending_close_mc = null;

    if (strategy.opentrades.length === 0 || Math.sign(strategy.position_size) !== pending.dir) return;

    closePartialPosition(context, Math.min(pending.qty, Math.abs(strategy.position_size)), pending.price, pending.time, {
        exitId: 'Margin call',
        exitComment: 'Margin call',
    });

    if (Math.abs(strategy.position_size) > 1e-9) {
        for (const o of strategy.pending_orders) {
            if (o.status === 'pending' && (o.category ?? 'entry') === 'entry' && !o._isReversalEntry && parseDirection(o.direction) === pending.dir) {
                o.status = 'cancelled';
            }
        }
        strategy.pending_orders = strategy.pending_orders.filter((o) => o.status === 'pending');
    }
}

/**
 * True when the bar's first intra-bar move is ADVERSE for the current
 * position (TV broker-emulator path assumption: open closer to high →
 * open→high→low→close; open closer to low → open→low→high→close).
 * Used to path-order the margin-call checkpoint against exit fills.
 */
export function isAdverseFirstBar(context: any): boolean {
    const strategy: StrategyState = context.strategy;
    const dir = Math.sign(strategy?.position_size ?? 0);
    if (dir === 0) return false;
    const openPrice = Series.from(context.data.open).get(0);
    const highPrice = Series.from(context.data.high).get(0);
    const lowPrice = Series.from(context.data.low).get(0);
    const openCloserToHigh = Math.abs(highPrice - openPrice) < Math.abs(openPrice - lowPrice);
    return dir === 1 ? !openCloserToHigh : openCloserToHigh;
}

/**
 * Margin-call check (TV broker emulator) at one of two intra-bar
 * CHECKPOINTS along the assumed price path:
 *
 *   'open'    — right after entries fill at the bar's open: equity and
 *               required margin evaluated AT THE OPEN, liquidation fills
 *               at the open price.
 *   'extreme' — at the bar's adverse extreme (low for longs, high for
 *               shorts), liquidation fills at the extreme itself — the
 *               pessimistic broker model (intra-bar tick order unknown).
 *   'close'   — at the bar's close, after all exits: if the (possibly
 *               already-trimmed) position still breaches at the closing
 *               price, another partial liquidation fills at the close.
 *               Evidence: 2021-10-01 (profit QA) shows TWO same-bar MC
 *               prices — 4×cover at the high, then a further 0.263108
 *               at 48,147.38 (the close).
 *
 * TV checks margin along the path, interleaved with exit fills — proven
 * by the MC-ordering probe (BTCUSDT 1D, 2026-02-05): a 5-lot short
 * entered at the open was split within one bar into MC 0.00228 at the
 * OPEN price, MC 0.0888 at the high, then a TP fill of 4.90892 at the
 * lows. The caller orders the 'extreme' checkpoint BEFORE exit
 * processing on adverse-first bars and AFTER it on favorable-first bars
 * (favorable exits free margin before the adverse extreme is reached).
 *
 * Runs for ALL margin percentages including 100%. At 100% margin the
 * trader still needs full notional collateral; adverse price movement
 * that drops account equity below the position's current notional
 * triggers a margin call. This matches TV's broker-emulator behavior
 * (the "Margin calls" stat in the Strategy Tester is non-zero on 100%
 * margin runs whenever a position's mark-to-market loss exceeds equity).
 *
 * margin 0 (the Pine v5 default) imposes NO margin requirement — TV
 * never margin-calls such positions, whatever the equity (the broker
 * emulator "does not check available funds"). The check is skipped.
 */
export function processMarginCall(context: any, checkpoint: 'open' | 'extreme' | 'close' = 'extreme'): void {
    const strategy: StrategyState = context.strategy;
    if (!strategy || strategy.opentrades.length === 0) return;

    const positionDir = Math.sign(strategy.position_size);
    if (positionDir === 0) return;

    const marginPct = positionDir === 1 ? (strategy.config.margin_long ?? 0) : (strategy.config.margin_short ?? 0);
    if (marginPct <= 0) return; // v5 default: no margin requirement → no margin calls.

    const openPrice = Series.from(context.data.open).get(0);
    const highPrice = Series.from(context.data.high).get(0);
    const lowPrice = Series.from(context.data.low).get(0);
    const closePrice = Series.from(context.data.close).get(0);
    const currentTime = Series.from(context.data.openTime).get(0);
    const pointValue = context.pine?.syminfo?.pointvalue ?? 1;

    const adversePrice = checkpoint === 'open' ? openPrice : checkpoint === 'close' ? closePrice : positionDir === 1 ? lowPrice : highPrice;
    const totalQty = Math.abs(strategy.position_size);
    const equityAtAdverse = computeEquityAtPrice(context, adversePrice);
    const requiredMarginAtAdverse = computeRequiredMargin(totalQty, adversePrice, marginPct, pointValue);

    if (equityAtAdverse < requiredMarginAtAdverse) {
        // PARTIAL liquidation (TV broker-emulator rule): compute the margin
        // deficit at the adverse extreme, convert it to contracts at that
        // price, and liquidate 4× that amount — the 4× buffer prevents the
        // trimmed position from being immediately margin-called again on
        // the next tick. The remainder of the position stays open. Capped
        // at the full position size for catastrophic deficits.
        //
        // Verified against TV xlsx exports (MACD/BTCUSDT 1D, 100% margin):
        // TV liquidated 1.21312 of a 5-contract short (deficit $33,603.64
        // at price 110,797.38 → 4 × 0.30328) and 0.48244 of another
        // (deficit $10,924.98 at 90,574.00 → 4 × 0.12061).
        const deficit = requiredMarginAtAdverse - equityAtAdverse;
        // Full-precision cover — no truncation. Verified against the
        // commission-0 margin oracle (BTCUSDC weekly) where TV's
        // liquidation qty matches PT's untruncated 4× cover exactly, and
        // against the BTCUSDC avg_price QA xlsx (TV qty 3.602232 ≈ 7
        // significant digits). An earlier 5-decimal floor was overfit to
        // the BTCUSDT margin_calls xlsx where TV's exported quantities
        // (1.21312, 0.48244) are 7-significant-digit values with trailing
        // zeros trimmed; the residual there (~$1 equity-basis opacity
        // inside TV) is sub-dollar on a $530k net and accepted.
        //
        // The marginPct/100 divisor matters below 100%: TV liquidates
        // 4×deficit/(price·m) — verified exactly on fresh TV captures at
        // margin_long/short = 50 (close-MC investigation, 2026-06-12).
        const marginFrac = marginPct / 100;
        const coverQty = deficit / (adversePrice * pointValue * marginFrac);
        const qtyToLiquidate = Math.min(totalQty, 4 * coverQty);

        // Remember the FIFO order before the close so we can identify the
        // PARTIALLY-consumed lot afterwards (the liquidation eats whole
        // lots from the front; the first lot still open afterwards is the
        // one it bit into).
        const fifoBefore = [...strategy.opentrades];
        const frontPiece = fifoBefore[0];
        const frontQty = Math.abs(frontPiece.size);
        const frontEntry = frontPiece.entry_price;

        closePartialPosition(context, qtyToLiquidate, adversePrice, currentTime, {
            exitId: 'Margin call',
            exitComment: 'Margin call',
        });

        // ---- Phantom re-check → SECOND margin call at the bar's CLOSE ----
        // TV broker-emulator behavior (reverse-engineered 2026-06-12,
        // exact on 6 TV-captured events incl. margin=50% and full-cap
        // variants; 122+ negative controls): when the margin call closed
        // the FIRST (oldest) FIFO piece ENTIRELY, TV re-evaluates the
        // margin condition in a transient state where that piece's margin
        // is freed and its unrealized PnL removed from equity, but its
        // realized PnL has NOT yet been booked. The residual deficit is
        //   D2 = D1 − p1·(p·m·pv) + u1,   u1 = p1·(p − e1)·dir·pv
        // (p1/e1 = first piece qty/entry, p = the adverse checkpoint
        // price, dir = +1 long / −1 short). If D2 > 0, a second margin
        // call q2 = min(remaining, 4·trunc6(D2/(p·m·pv))) fires — FILLED
        // AT THE BAR'S CLOSE and booked AFTER the script's on-close
        // evaluation, so the script (and any order it queues this bar)
        // still sees the pre-MC#2 position. A reversal queued at that
        // close therefore overshoots by exactly q2 on the next bar (TV
        // xlsx 2021-10-02: reversal long 5.263108 = 5 + q2). Application
        // is deferred to the start of the next bar via
        // `_pending_close_mc` (see applyPendingCloseMarginCall).
        //
        // Single-piece margin calls can never fire this (D2 < 0
        // algebraically) — only calls that consume the whole front piece
        // and span into deeper lots qualify, and even then rarely.
        if (checkpoint === 'extreme' && qtyToLiquidate >= frontQty - 1e-9 && Math.abs(strategy.position_size) > 1e-9) {
            const freedMargin = computeRequiredMargin(frontQty, adversePrice, marginPct, pointValue);
            const u1 = frontQty * (adversePrice - frontEntry) * positionDir * pointValue;
            const d2 = deficit - freedMargin + u1;
            if (d2 > 0) {
                const closeP = Series.from(context.data.close).get(0);
                const trunc6 = (x: number) => Math.trunc(x * 1e6) / 1e6;
                const cover2 = trunc6(d2 / (adversePrice * pointValue * marginFrac));
                const q2 = Math.min(Math.abs(strategy.position_size), 4 * cover2);
                if (q2 > 1e-9) {
                    (strategy as any)._pending_close_mc = {
                        qty: q2,
                        price: closeP,
                        time: currentTime,
                        dir: positionDir,
                    };
                }
            }
        }

        // TV broker-emulator rule (QA evidence): a margin call CANCELS all
        // working exit brackets for the rest of the bar EXCEPT the bracket
        // of the lot it partially consumed. The canceled lots get fresh
        // brackets from the next strategy.exit call (next bar).
        // Evidence: 2024-08-03 (avg_price QA) — after MC 0.59552 at the
        // high, the shared TP at 59,954 filled ONLY the touched lot's
        // remainder 4.40448; the other covered lot exited next day at the
        // refreshed level. Same split on 2021-05-16 (profit QA: only the
        // MC-touched lot's TP filled same-bar, untouched lots filled next
        // day at their own levels) and on the MC-probe triple bar
        // 2026-02-05 (the only lot was the touched one → its TP filled).
        const survivor = fifoBefore.find((t) => t.status === 'open');
        (strategy as any)._mc_exit_lock = { bar: context.idx, tradeId: survivor?.id ?? null };
    }
}

/**
 * End-of-bar finalize: refresh equity at CLOSE and latch
 * `strategy.max_drawdown` / `strategy.max_runup` using the bar's H/L. Runs
 * UNCONDITIONALLY once per bar (after entry+exit fills are done), regardless
 * of whether the strategy uses exit orders.
 */
export function finalizeStrategyBar(context: any): void {
    if (!context.strategy) return;
    const strategy: StrategyState = context.strategy;
    const highPrice = Series.from(context.data.high).get(0);
    const lowPrice = Series.from(context.data.low).get(0);
    const closePrice = Series.from(context.data.close).get(0);
    markToMarket(context, closePrice);
    updateEquityPeaks(context, highPrice, lowPrice);

    // Record the MARK-TO-MARKET equity at each calendar month's last bar,
    // for the end-of-run Sharpe / Sortino ratios (see
    // finalizeStrategyRun). TV samples the equity curve monthly regardless
    // of the chart timeframe; we keep the last bar's equity per UTC
    // calendar month (overwrite within a month, append on rollover).
    const barTime = Series.from(context.data.openTime).get(0);
    if (Number.isFinite(barTime)) {
        const d = new Date(barTime);
        const monthKey = d.getUTCFullYear() * 12 + d.getUTCMonth();
        const series = (strategy._monthly_equity ??= []);
        if (strategy._last_month_key === monthKey && series.length > 0) {
            series[series.length - 1] = strategy.equity;
        } else {
            series.push(strategy.equity);
            strategy._last_month_key = monthKey;
        }
    }
}

/**
 * End-of-run finalize: compute the risk-adjusted performance ratios
 * (Sharpe / Sortino) from the monthly equity curve captured during the
 * run. Called ONCE after the last bar (see PineTS.class.ts).
 *
 * TV broker-emulator formula (confirmed against the Help Center docs and
 * reverse-engineered to the third decimal across 7 QA datasets,
 * 2026-06-15):
 *   - Sample the MARK-TO-MARKET equity at each calendar month's close.
 *   - Monthly simple returns rᵢ = Eᵢ / Eᵢ₋₁ − 1, anchored at the initial
 *     capital (the first return runs from initial_capital to month 1).
 *   - MR = mean(rᵢ);  RFR = risk_free_rate / 100 / 12 (annual % → monthly).
 *   - Sharpe  = (MR − RFR) / SD,  SD = √(Σ(rᵢ − MR)² / N)   (population).
 *   - Sortino = (MR − RFR) / DD,  DD = √(Σ min(0, rᵢ − RFR)² / N)
 *     (downside deviation over ALL N returns, target = RFR — per TV's
 *     documented DD = sqrt(sum(min(0, Xᵢ − T))² / N)).
 *   - No annualization.
 *
 * Note: the ratios are only as accurate as the bar-by-bar equity path;
 * they ride on the strategy engine's mark-to-market fidelity. With < 2
 * monthly returns (very short backtests) they are left at 0.
 */
export function finalizeStrategyRun(context: any): void {
    const strategy: StrategyState = context?.strategy;
    if (!strategy) return;

    // CAGR is independent of the monthly equity curve (it only needs the
    // first/last bar times and the realized P&L), so compute it before the
    // Sharpe / Sortino short-circuit below.
    strategy.cagr = computeCagr(context);

    // Buy-and-hold benchmark (independent of the monthly equity curve too).
    computeBuyAndHold(context);

    const series = strategy._monthly_equity ?? [];
    const equities = [strategy.initial_capital, ...series];
    const returns: number[] = [];
    for (let i = 1; i < equities.length; i++) {
        const prev = equities[i - 1];
        if (prev !== 0 && Number.isFinite(prev) && Number.isFinite(equities[i])) {
            returns.push(equities[i] / prev - 1);
        }
    }

    if (returns.length < 2) {
        strategy.sharpe_ratio = 0;
        strategy.sortino_ratio = 0;
        return;
    }

    const rfrMonthly = (strategy.config.risk_free_rate ?? 2) / 100 / 12;
    const n = returns.length;
    const mean = returns.reduce((s, r) => s + r, 0) / n;
    const excess = mean - rfrMonthly;

    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
    const sd = Math.sqrt(variance);

    const downsideSq = returns.reduce((s, r) => s + Math.min(0, r - rfrMonthly) ** 2, 0) / n;
    const dd = Math.sqrt(downsideSq);

    strategy.sharpe_ratio = sd > 0 ? excess / sd : 0;
    strategy.sortino_ratio = dd > 0 ? excess / dd : 0;
}

/**
 * Compound Annual Growth Rate (%) of strategy equity over the full backtest
 * window. Mirrors the LuxAlgo `cagr()` Pine helper applied to the strategy
 * leg: entry = (firstBarTime, initial_capital), exit = (lastBarTime,
 * initial_capital + netprofit).
*
*   daysBetween = (lastBarTime − firstBarTime) / MS_IN_ONE_DAY
*   years       = daysBetween / 365
*   CAGR%       = 100 × ((exit / entry) ^ (1 / years) − 1)
*
* The window spans the FIRST to the LAST loaded bar's open time (Pine's
* `var int firstTime = time` latched on bar 0, and `last_bar_time`). With a
* span under one day, or non-finite capital figures, the result is NaN —
* matching the Pine helper's `na` branch.
*/
const MS_IN_ONE_DAY = 24 * 60 * 60 * 1000;

function computeCagr(context: any): number {
    const strategy: StrategyState = context?.strategy;
    if (!strategy) return NaN;

    const candles = context?.marketData;
    if (!Array.isArray(candles) || candles.length === 0) return NaN;

    const firstTime = candles[0]?.openTime;
    const lastTime = candles[candles.length - 1]?.openTime;
    if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime)) return NaN;

    const entryPrice = strategy.initial_capital ?? 0;
    const exitPrice = entryPrice + (strategy.netprofit ?? 0);
    const daysBetween = (lastTime - firstTime) / MS_IN_ONE_DAY;
    if (daysBetween < 1 || !Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || entryPrice === 0) {
        return NaN;
    }

    const years = daysBetween / 365;
    return 100 * (Math.pow(exitPrice / entryPrice, 1 / years) - 1);
}

/**
 * Buy-and-hold benchmark statistics (TV's "Buy & Hold Return" report).
 *
 * Models a single long position bought with the ENTIRE initial capital at the
 * FIRST trade's entry price and held open through the last bar:
 *   - The anchor (price_start) is strategy._first_entry_price — the first
 *     trade's fill price, with slippage ALREADY applied by the engine. This
 *     is why the benchmark is affected by the slippage property.
 *   - The position is never sold (always open), so there is no exit leg:
 *     commissions never apply and price_end carries no slippage.
 *   - price_end is the last bar's close.
 *
 *   qty                     = initial_capital / price_start
 *   buy_and_hold_pnl        = qty × (price_end − price_start)
 *                           = initial_capital × (price_end − price_start) / price_start
 *   buy_and_hold_per_gain   = (price_end − price_start) / price_start × 100
 *   strategy_outperformance = netprofit − buy_and_hold_pnl
 *
 * Left at NaN when no trade ever opened (no entry price to anchor on) or the
 * figures are non-finite.
 */
function computeBuyAndHold(context: any): void {
    const strategy: StrategyState = context?.strategy;
    if (!strategy) return;

    const priceStart = strategy._first_entry_price;
    const candles = context?.marketData;
    const priceEnd = Array.isArray(candles) && candles.length > 0 ? candles[candles.length - 1]?.close : NaN;

    if (!Number.isFinite(priceStart) || !Number.isFinite(priceEnd) || (priceStart as number) === 0) {
        strategy.buy_and_hold_pnl = NaN;
        strategy.buy_and_hold_per_gain = NaN;
        strategy.strategy_outperformance = NaN;
        return;
    }

    const start = priceStart as number;
    const ratio = (priceEnd - start) / start;
    strategy.buy_and_hold_per_gain = ratio * 100;
    strategy.buy_and_hold_pnl = (strategy.initial_capital ?? 0) * ratio;
    strategy.strategy_outperformance = (strategy.netprofit ?? 0) - strategy.buy_and_hold_pnl;
}

/**
 * Update strategy metrics
 */
function updateStrategyMetrics(context: any): void {
    const strategy: StrategyState = context.strategy;

    // Net profit is already calculated when trades close.
    // Equity is updated with unrealized P&L.
    // Equity-curve peaks (max_drawdown / max_runup) and aggregate
    // win/loss stats are deferred to a later pass when those scalar
    // getters are implemented.
    void strategy;
}

/**
 * Normalize a strategy config object: unwrap Pine Series values to their
 * CURRENT value. strategy() declaration parameters are Pine series — a
 * variable passed by name (e.g. `default_qty_value=v` with `v` reassigned
 * each bar) arrives as a Series wrapper. Numeric config must drive the
 * engine numerically — without this, equity becomes "[object Object]00"
 * (string concat), percent_of_equity sizing collapses to NaN (2059:
 * zero-size trades) and `commission_value` → Number(Series) yields NaN P&L
 * (2133/2135). Function-valued config (default_qty_type/value) is left
 * intact — the sizing paths already call those per evaluation.
 *
 * Applied at EVERY merge into config — initializeStrategy (bar 0) and the
 * per-bar re-merge in any() — so the unwrapped value is the Series' value
 * at the CURRENT merge bar (a live, per-bar-recalculated variable keeps
 * config numeric instead of re-polling it with a fresh Series object).
 */
export function unwrapSeriesConfig<T extends object>(config: T): T {
    const record = config as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        const value = record[key];
        if (value instanceof Series) record[key] = value.get(0);
    }
    return config;
}

/**
 * Initialize strategy state
 */
export function initializeStrategy(context: any, config: any): void {
    const defaultMargin = defaultStrategyMargin(context.pineVersion);
    const defaults = {
        title: '',
        shorttitle: '',
        overlay: false,
        format: 'inherit',
        precision: 10,
        scale: 'right',
        pyramiding: 1,
        calc_on_order_fills: false,
        process_orders_on_close: false,
        close_entries_rule: 'FIFO',
        calc_on_every_tick: false,
        max_bars_back: 0,
        backtest_fill_limits_assumption: 0,
        default_qty_type: 'fixed',
        default_qty_value: 1,
        initial_capital: 1000000,
        currency: 'USD',
        slippage: 0,
        commission_type: 'percent',
        commission_value: 0,
        // Pine v5 defaults margin_long/margin_short to 0 (no funds check);
        // Pine v6 defaults both to 100 (1:1 leverage). The transpiler carries
        // the source version onto the execution context so omitted arguments
        // keep their version-specific TradingView meaning. Explicit arguments
        // still win when config is merged below.
        margin_long: defaultMargin,
        margin_short: defaultMargin,
        explicit_plot_zorder: false,
        max_lines_count: 50,
        max_labels_count: 50,
        max_boxes_count: 50,
        max_polylines_count: 50,
        risk_free_rate: 2,
        use_bar_magnifier: false,
        fill_orders_on_standard_ohlc: false,
    };

    // Layer order: spec defaults ← source call args ← user .prop overrides (latest wins).
    // strategy() declaration parameters are Pine series: a variable passed by
    // name (e.g. `initial_capital=capital` with `capital = 1000.0`) arrives
    // as a Series wrapper. unwrapSeriesConfig replaces each Series with its
    // CURRENT value so numeric config drives the engine numerically — without
    // this, equity becomes "[object Object]00" (string concat) and
    // percent_of_equity sizing collapses to NaN (2059: zero-size trades).
    const finalConfig = unwrapSeriesConfig({ ...defaults, ...config, ...(context._propOverrides ?? {}) });
    const initialCapital = finalConfig.initial_capital;

    context.strategy = {
        config: finalConfig,

        // Trade collections
        opentrades: [],
        closedtrades: [],
        pending_orders: [],

        // Flat position scalars
        position_size: 0,
        position_avg_price: NaN, // Pine returns NaN when flat
        position_entry_name: '',

        // Account info
        initial_capital: initialCapital,
        account_currency: finalConfig.currency || 'USD',
        equity: initialCapital,
        netprofit: 0,
        grossprofit: 0,
        grossloss: 0,
        openprofit: 0,

        // Peaks
        max_drawdown: 0,
        max_runup: 0,
        equity_peak: initialCapital,
        equity_trough: initialCapital,
        equity_at_runup_peak: initialCapital,
        equity_at_drawdown_peak: initialCapital,
        max_drawdown_percent_value: 0,
        max_runup_percent_value: 0,

        // Risk-adjusted ratios (computed at end-of-run) + their internal
        // monthly-equity accumulator.
        sharpe_ratio: 0,
        sortino_ratio: 0,
        cagr: NaN,

        // Buy-and-hold benchmark (computed at end-of-run; NaN until then).
        buy_and_hold_pnl: NaN,
        buy_and_hold_per_gain: NaN,
        strategy_outperformance: NaN,
        _first_entry_price: undefined,

        _monthly_equity: [],
        _last_month_key: -1,

        // Trade-stat counters
        wintrades: 0,
        losstrades: 0,
        eventrades: 0,
        wintrades_total_profit: 0,
        losstrades_total_loss: 0,

        // Position-size peaks
        max_contracts_held_all: 0,
        max_contracts_held_long: 0,
        max_contracts_held_short: 0,

        // Risk-management rules (configured via strategy.risk.*)
        risk_rules: {},
        risk_halted: false,

        // Cadence tracking for strategy.exit (see types.ts).
        _exit_call_history: new Map<string, number>(),
        _exit_fallback_counter: 0,
        _exit_fallback_last_bar: -1,
        _filled_exit_trade_ids: new Map<string, { bar: number; activationTradeIds: string[]; consumedTradeIds: string[] }>(),
    };
}

/**
 * Deep-clone a plain-data value (primitives, arrays, plain objects, Map).
 * Strategy state holds only plain data, so this covers every field without a
 * structuredClone dependency.
 */
function clonePlainValue<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map(clonePlainValue) as unknown as T;
    }
    if (value instanceof Map) {
        const copy = new Map();
        value.forEach((v, k) => copy.set(k, clonePlainValue(v)));
        return copy as unknown as T;
    }
    if (value !== null && typeof value === 'object') {
        const copy: any = {};
        for (const key of Object.keys(value)) {
            copy[key] = clonePlainValue((value as any)[key]);
        }
        return copy;
    }
    return value;
}

/**
 * Snapshot the full strategy ledger for streaming rollback.
 *
 * Iterates the ACTUAL own keys of the state object instead of a hand-kept
 * field list, so internal broker-emulator fields are covered even when they
 * are absent from the StrategyState type.
 *
 * Two fields get special treatment:
 *   - `config`: skipped — rebuilt by `strategy.any()` on every script
 *     evaluation, so the live value is always current.
 *   - `closedtrades`: length-only. The array is append-only (single write
 *     site: the `push` in closePartialPosition) and rows are fresh literals
 *     never mutated afterwards, so truncation restores it exactly. This
 *     keeps the snapshot O(open state), not O(backtest length).
 *
 * Returns null for indicator contexts (no strategy declared).
 */
export function snapshotStrategyState(strategy: StrategyState | undefined): any | null {
    if (!strategy) return null;
    const fields: Record<string, any> = {};
    for (const key of Object.keys(strategy)) {
        if (key === 'config' || key === 'closedtrades') continue;
        fields[key] = clonePlainValue((strategy as any)[key]);
    }
    return { fields, closedtradesLength: strategy.closedtrades.length };
}

/**
 * Restore the strategy ledger from a snapshotStrategyState() snapshot.
 *
 * MUTATES the existing state object in place — `Context.strategy` is public
 * and documented as "the same object every getter reads from", so its
 * identity must never change. The snapshot may be applied many times (once
 * per streaming tick), so values are cloned OUT of it: handing the live
 * state the snapshot's own arrays would let the next re-execution corrupt
 * the restore point.
 *
 * Keys added to the state after the snapshot was taken (i.e. during a
 * discarded execution of the forming bar) are deleted.
 */
export function restoreStrategyState(strategy: StrategyState | undefined, snapshot: any | null): void {
    if (!strategy || !snapshot) return;

    for (const key of Object.keys(strategy)) {
        if (key === 'config' || key === 'closedtrades') continue;
        if (!Object.prototype.hasOwnProperty.call(snapshot.fields, key)) {
            delete (strategy as any)[key];
        }
    }

    if (strategy.closedtrades.length > snapshot.closedtradesLength) {
        strategy.closedtrades.length = snapshot.closedtradesLength;
    }

    for (const key of Object.keys(snapshot.fields)) {
        (strategy as any)[key] = clonePlainValue(snapshot.fields[key]);
    }
}
