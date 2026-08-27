// Famille : drop wrong-side des exits absolus (FAMILLES.md #71)
// Ids révélateurs : 2028 1514 — suppression du drop 'wrong-side vs avgEntry'
// (GÉNÉRAL : avg-entry n'est pas un critère broker).
// Fix : fork 2b6305d — preuve TV 2444 (tv-vin95-b) : un stop placé SOUS le
// close courant mais AU-DESSUS de la moyenne pyramidée (avg 102,93 < stop
// 104,53) est rempli au cross b363 @104,53. Le broker emulator remplit tout
// niveau absolu croisé par le chemin, persisté ou non.

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { initializeStrategy, openTrade, processExitOrders } from '../../../src/namespaces/strategy/utils';

function makeContext() {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'NASDAQ:TEST',
        timeframe: 'D',
    });
    context.pine = { syminfo: { type: 'stock', mintick: 0.01, pointvalue: 1 } };
    context.pineVersion = 4;
    initializeStrategy(context, { default_qty_type: 'fixed', default_qty_value: 1 });
    setBar(context, 0, 100, 101, 99, 100);
    return context;
}

function setBar(context: Context, idx: number, open: number, high: number, low: number, close: number) {
    context.idx = idx;
    context.data.open = new Series([open]);
    context.data.high = new Series([high]);
    context.data.low = new Series([low]);
    context.data.close = new Series([close]);
    context.data.openTime = new Series([idx * 86_400_000]);
}

// Sparse call (unique callsite → non-persistent pattern), like the exit call
// gated inside an if-block in 2444.
function sparseExit(context: Context, id: string, params: Record<string, unknown>, callsiteId: string) {
    exit(context)(id, params, { __callsiteId: callsiteId });
}

describe('drop wrong-side des exits absolus (2028/1514)', () => {
    it('a long stop above the average entry fills at its level on the crossing bar', () => {
        const context = makeContext();
        openTrade(context, 'L', 1, 1, 100, 0); // avg entry 100
        // 2444 shape: price rises to 110, the exit places stop 104.53 — below
        // the current close (not immediately marketable) but ABOVE the average
        // entry (wrong side under the legacy heuristic slValid = absSl <
        // avgEntry, which dropped the leg before 2b6305d).
        setBar(context, 1, 105, 112, 105, 110);
        sparseExit(context, 'x', { stop: 104.53 }, 'wrong-side-site');
        expect(processExitOrders(context)).toBe(0);
        // Next bar dips through 104.53 → the live order fills at the stop.
        setBar(context, 2, 109, 111, 104, 105);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades).toHaveLength(1);
        expect(context.strategy!.closedtrades[0].exit_price).toBe(104.53);
    });

    it('a short stop below the average entry is a live order and fills at its level', () => {
        const context = makeContext();
        openTrade(context, 'S', -1, 1, 100, 0); // avg entry 100
        // Mirror case: a short's stop BELOW the average entry (slValid =
        // absSl > avgEntry) was dropped before 2b6305d; the order stays live
        // and fills when the path rises through 95.45.
        setBar(context, 1, 93, 94, 90, 92);
        sparseExit(context, 'x', { stop: 95.45 }, 'wrong-side-site');
        expect(processExitOrders(context)).toBe(0);
        setBar(context, 2, 94, 97, 93, 95);
        expect(processExitOrders(context)).toBe(1);
        expect(context.strategy!.closedtrades).toHaveLength(1);
        expect(context.strategy!.closedtrades[0].exit_price).toBe(95.45);
    });
});