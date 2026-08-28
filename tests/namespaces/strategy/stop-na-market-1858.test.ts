import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

/**
 * Famille : stop=na/limit=na explicite → ordre marché (script révélateur 1858).
 *
 * The transpiler emits a named-argument object whose `na` value is the
 * NAHelper (`__value` = NaN). An omitted level remains absent from that
 * object, so it must keep the historical market-order behavior.
 */
const CANDLES = [
    {
        openTime: 0,
        open: 99,
        high: 101,
        low: 98,
        close: 100,
        volume: 1,
        closeTime: 86_399_999,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    },
    {
        openTime: 86_400_000,
        open: 101,
        high: 106,
        low: 99,
        close: 104,
        volume: 1,
        closeTime: 172_799_999,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    },
];

async function runEntry(call: string) {
    const source = `
//@version=5
strategy('stop-na-market-1858', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    ${call}`;
    const context = await new PineTS(CANDLES).run(source);
    if (!context.strategy) throw new Error('strategy state was not initialized');
    return context.strategy;
}

describe('strategy explicit na order levels — market execution (1858)', () => {
    it('executes entry(stop=na) alone at the next market open', async () => {
        const strategy = await runEntry("strategy.entry('stop-na', strategy.long, stop=na)");

        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_price).toBe(101);
        expect(strategy.pending_orders).toHaveLength(0);
    });

    it('executes entry(limit=na) alone at the next market open', async () => {
        const strategy = await runEntry("strategy.entry('limit-na', strategy.long, limit=na)");

        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_price).toBe(101);
        expect(strategy.pending_orders).toHaveLength(0);
    });

    it('keeps explicit entry(limit=na, stop=na) market execution', async () => {
        const strategy = await runEntry("strategy.entry('both-na', strategy.long, limit=na, stop=na)");

        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_price).toBe(101);
        expect(strategy.pending_orders).toHaveLength(0);
    });

    it('keeps a real stop level as a stop order instead of converting it to market', async () => {
        const strategy = await runEntry("strategy.entry('real-stop', strategy.long, stop=105)");

        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_price).toBe(105);
        expect(strategy.pending_orders).toHaveLength(0);
    });

    it('keeps an entry with no level as the historical market order', async () => {
        const strategy = await runEntry("strategy.entry('no-level', strategy.long)");

        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_price).toBe(101);
        expect(strategy.pending_orders).toHaveLength(0);
    });
});
