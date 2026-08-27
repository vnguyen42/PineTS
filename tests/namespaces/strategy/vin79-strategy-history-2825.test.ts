import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Context } from '../../../src/Context.class';
import { StrategyState } from '../../../src/namespaces/strategy/types';

// Famille : historique [1] des séries strategy — VIN-79, révélateur 2825,
// fixes 5f156b4 + 7aabd18. strategy.position_size[1] must observe the prior
// finalized bar, so a just-entered position can initialize its two-risk-unit
// bracket on the next evaluation and produce the expected trade.

const candles = [
    {
        openTime: 0, open: 100, high: 101, low: 99, close: 100, volume: 1,
        closeTime: 86_399_999, quoteAssetVolume: 0, numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0,
    },
    {
        openTime: 86_400_000, open: 100, high: 103, low: 99, close: 102, volume: 1,
        closeTime: 172_799_999, quoteAssetVolume: 0, numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0,
    },
    {
        openTime: 172_800_000, open: 101, high: 103, low: 100, close: 102, volume: 1,
        closeTime: 259_199_999, quoteAssetVolume: 0, numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0,
    },
];

const source = `
//@version=5
strategy('VIN-79 history', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
justEntered = strategy.position_size > 0 and strategy.position_size[1] == 0
if justEntered
    strategy.exit('TP', 'L', limit=strategy.position_avg_price + 2)
plot(strategy.position_size[1], 'previous_position')
plot(strategy.position_avg_price[1], 'previous_average')
plot(strategy.opentrades[1], 'previous_open_trades')
`;

function strategyOf(context: Context): StrategyState {
    if (!context.strategy) throw new Error('strategy state was not initialized');
    return context.strategy;
}

function plotValues(context: Context, name: string): unknown[] {
    const plot = context.plots[name] as { data?: unknown[] } | undefined;
    if (!plot || !Array.isArray(plot.data)) throw new Error(`missing plot ${name}`);
    return plot.data.map((point) => {
        if (!point || typeof point !== 'object' || !('value' in point)) {
            throw new Error(`plot ${name} has an invalid point`);
        }
        return point.value;
    });
}

describe('VIN-79 strategy history [1] (2825, 5f156b4 + 7aabd18)', () => {
    it('uses the prior finalized position to place and fill the just-entered bracket', async () => {
        const context = await new PineTS(candles).run(source);
        const strategy = strategyOf(context);

        expect(plotValues(context, 'previous_position')).toEqual([NaN, 0, 1]);
        expect(plotValues(context, 'previous_average')).toEqual([NaN, NaN, 100]);
        expect(plotValues(context, 'previous_open_trades')).toEqual([NaN, 0, 1]);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0]).toMatchObject({
            entry_id: 'L',
            entry_price: 100,
            exit_id: 'TP',
            exit_price: 102,
            size: 1,
        });
    });
});
