import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

/**
 * Margin checkpoints follow the broker emulator's assumed intrabar path
 * (open → nearer extreme → farther extreme → close). A position opened or
 * reversed by a stop/limit filling INSIDE the bar did not exist at the open
 * nor at an extreme reached before that fill: it is admitted on the account
 * valued at its own fill level, and margin-called only at path points after
 * it. Witness: ETHUSD 1D 2017-05-07 (open 95.28, high 100.78, low 30.015),
 * a Donchian sell-stop reversal filled at 45 used to be liquidated at the
 * 95.28 open it followed, ending the run at −490 % equity.
 */

const DAY = 86_400_000;

function candles(bars: Array<[number, number, number, number]>) {
    return bars.map(([open, high, low, close], i) => ({
        openTime: i * DAY,
        open,
        high,
        low,
        close,
        volume: 1000,
        closeTime: (i + 1) * DAY - 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    }));
}

async function run(source: string, bars: Array<[number, number, number, number]>) {
    const { strategy } = await new PineTS(candles(bars)).run(source);
    return strategy;
}

// Bar 2 of the reversal cases: open 95 is nearer the 100 high, so the path is
// 95 → 100 → 30 → close and the sell stop at 45 fills on the way down.
const FLASH_CRASH: Array<[number, number, number, number]> = [
    [100, 101, 99, 100],
    [100, 101, 99, 100],
    [95, 100, 30, 55],
];

describe('margin calls around an entry filled inside the bar', () => {
    it('margin-calls a reversal stop fill at the worst price after it, never at the open it followed', async () => {
        const strategy = await run(`
//@version=6
strategy('reversal', initial_capital=1000, margin_long=50, margin_short=50)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('S', strategy.short, qty=30, stop=45)`, FLASH_CRASH);

        // Long 1 @ 100 closed at 45: equity 945. Short 30 @ 45, worst later
        // path point = close 55: equity 645 < margin 30 × 55 × 50 % = 825,
        // deficit 180 → 4 × 180 / (55 × 0.5) contracts liquidated at 55.
        const marginCalls = strategy.closedtrades.filter((trade) => trade.exit_id === 'Margin call');
        expect(marginCalls).toHaveLength(1);
        expect(marginCalls[0].exit_price).toBe(55);
        expect(Math.abs(marginCalls[0].size)).toBeCloseTo((4 * 180) / 27.5, 9);
        expect(strategy.position_size).toBeCloseTo(-(30 - (4 * 180) / 27.5), 9);
        expect(strategy.equity).toBeCloseTo(645, 9);
    });

    it('keeps a reversal stop fill whose later path stays within margin', async () => {
        const bars = FLASH_CRASH.slice(0, 2).concat([[95, 100, 30, 50]]);
        const strategy = await run(`
//@version=6
strategy('reversal', initial_capital=1000, margin_long=50, margin_short=50)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('S', strategy.short, qty=30, stop=45)`, bars);

        // At the 95 open the short would be worth −555; after its fill the
        // path only reaches 30 and the 50 close (equity 795 ≥ margin 750).
        expect(strategy.closedtrades.filter((trade) => trade.exit_id === 'Margin call')).toHaveLength(0);
        expect(strategy.position_size).toBe(-30);
        expect(strategy.equity).toBeCloseTo(795, 9);
    });

    it('admits a reversal open leg on the equity at its fill level, not at the open', async () => {
        const strategy = await run(`
//@version=6
strategy('reversal', initial_capital=200, margin_long=50, margin_short=50)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=2)
if bar_index == 1
    strategy.entry('S', strategy.short, qty=5, stop=45)`, FLASH_CRASH.slice(0, 2).concat([[95, 100, 30, 99]]));

        // Valued at the open (190) or the 99 close (198) the account covers
        // the 5-short's 112.5 margin; at the 45 fill the long's loss leaves
        // 90: only the close leg executes.
        expect(strategy.opentrades).toHaveLength(0);
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].exit_id).toBe('S');
        expect(strategy.closedtrades[0].exit_price).toBe(45);
        expect(strategy.equity).toBeCloseTo(90, 9);
    });

    it('never margin-calls a buy stop at the open or low that preceded its fill', async () => {
        const strategy = await run(`
//@version=6
strategy('breakout', initial_capital=1000, margin_long=50, margin_short=50)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=19, stop=105)`, [
            [100, 101, 99, 100],
            // Open 100 is nearer the 99.5 low: 100 → 99.5 → 110 → 108.
            [100, 110, 99.5, 108],
        ]);

        // Valued at the 100 open, 19 @ 105 would leave 905 < margin 950.
        expect(strategy.closedtrades).toHaveLength(0);
        expect(strategy.position_size).toBe(19);
        expect(strategy.opentrades[0].entry_price).toBe(105);
    });

    it('still margin-calls the position held before the fill at the open', async () => {
        const strategy = await run(`
//@version=6
strategy('gap', initial_capital=110, margin_long=50, margin_short=50)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=2)
if bar_index == 1
    strategy.entry('S', strategy.short, qty=1, stop=20)`, [
            [100, 101, 99, 100],
            [100, 101, 99, 100],
            // Gap down to 60 (path 60 → 62 → 10 → 15): the long is checked at
            // the open before the stop at 20 fills on the way down.
            [60, 62, 10, 15],
        ]);

        // Long 2 @ 100 at 60: equity 30 < margin 60, deficit 30 → 4 × 30 / 30
        // exceeds the position: the whole long is liquidated at the open.
        const first = strategy.closedtrades[0];
        expect(first.exit_id).toBe('Margin call');
        expect(first.exit_price).toBe(60);
        expect(Math.abs(first.size)).toBe(2);
    });
});
