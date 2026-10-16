// Famille : flat-wildcard-exit-waits-next-activation — target 2120
// (NASDAQ:DOCU, 60m, process_orders_on_close). A strategy.exit without
// from_entry placed while flat, with an entry pending, is not tied to that
// entry: TradingView keeps it after the entry is cancelled and attaches it to
// the next position of either direction. TV ledger evidence (capture
// symboles-manquants-lot2 run-20260827T174414Z-2120):
//   - bar 9922: a long stop left by the cancelled long signal of bar 9901
//     closes the short at its own fill price (59.76 → 59.76, profit 0);
//   - bar 14106: the short stop left on bar 14056 closes the long at its
//     fill price (46.77 → 46.77) although the long stop is called earlier in
//     the script: an exit created on an earlier bar reserves first;
//   - bar 12383: once attached, the exit lives and dies with that position;
//   - bar 10602: a long filled at the close (59.52) meets such an exit at the
//     close only, not at the bar's open (58.13).
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Kline } from '../../../src/marketData/types';

const HOUR = 3_600_000;

function candle(index: number, open: number, high: number, low: number, close: number): Kline {
    return {
        openTime: index * HOUR,
        open,
        high,
        low,
        close,
        volume: 1000,
        closeTime: (index + 1) * HOUR - 1,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

const flat = (index: number) => candle(index, 100, 101, 99, 100);

// The 2120 call layout: the long block (entry, cancel, exit) precedes the
// short block. Signals are driven by bar index; levels are literals.
function script(longBars: number[], shortBars: number[], levels: { longEntry: number; longExit: number; shortEntry: number; shortExit: number }) {
    return `
//@version=5
strategy('2120 flat wildcard exit', process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
longSignal = ${longBars.map((bar) => `bar_index == ${bar}`).join(' or ') || 'false'}
shortSignal = ${shortBars.map((bar) => `bar_index == ${bar}`).join(' or ') || 'false'}
if longSignal
    strategy.entry('Long Entry', strategy.long, stop=${levels.longEntry})
if not longSignal
    strategy.cancel('Long Entry')
if longSignal or strategy.position_size > 0
    strategy.exit('Long Exit', stop=${levels.longExit})
if shortSignal
    strategy.entry('Short Entry', strategy.short, stop=${levels.shortEntry})
if not shortSignal
    strategy.cancel('Short Entry')
if shortSignal or strategy.position_size < 0
    strategy.exit('Short Exit', stop=${levels.shortExit})`;
}

describe('2120 — wildcard exit placed while flat', () => {
    it('survives the cancelled entry and closes a later opposite position at its fill price (bar 9922)', async () => {
        const candles = [
            flat(0),
            flat(1), // long signal: Long Entry stop 110, Long Exit stop 95
            flat(2), // long entry cancelled
            flat(3), // short signal: Short Entry stop 99
            candle(4, 100, 100.5, 98, 98.5), // short fills at 99
            flat(5),
        ];
        const context = await new PineTS(candles).run(script([1], [3], { longEntry: 110, longExit: 95, shortEntry: 99, shortExit: 130 }));
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        expect(strategy.closedtrades).toHaveLength(1);
        const trade = strategy.closedtrades[0];
        expect(trade.size).toBe(-1);
        expect([trade.entry_bar_index, trade.entry_price]).toEqual([4, 99]);
        expect([trade.exit_bar_index, trade.exit_price]).toEqual([4, 99]);
    });

    it('lets the exit created on the earlier bar reserve first, whatever its call site (bar 14106)', async () => {
        const candles = [
            flat(0),
            flat(1), // short signal: Short Entry stop 95, Short Exit stop 110
            flat(2), // short entry cancelled
            flat(3), // long signal: Long Entry stop 105, Long Exit stop 90
            candle(4, 100, 106, 99.5, 105.5), // long fills at 105
            candle(5, 105.5, 106, 105, 105.5),
        ];
        const context = await new PineTS(candles).run(script([3], [1], { longEntry: 105, longExit: 90, shortEntry: 95, shortExit: 110 }));
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        expect(strategy.closedtrades).toHaveLength(1);
        const trade = strategy.closedtrades[0];
        expect(trade.size).toBe(1);
        expect([trade.entry_bar_index, trade.entry_price]).toEqual([4, 105]);
        expect([trade.exit_bar_index, trade.exit_price]).toEqual([4, 105]);
        expect(strategy.opentrades).toHaveLength(0);
    });

    it('dies with the position it attached to (bar 12383)', async () => {
        const candles = [
            flat(0),
            flat(1), // short A pending, wildcard exit XA (stop 80) placed flat
            flat(2), // A cancelled
            flat(3), // long B pending
            candle(4, 100, 102, 99.5, 101.5), // B fills at 101; XA attaches, not hit
            flat(5), // short C pending
            candle(6, 100, 100.5, 98, 98.5), // C fills at 99, reversing B
            flat(7),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('2120 attached exit lifetime', process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 1
    strategy.entry('A', strategy.short, stop=95)
    strategy.exit('XA', stop=80)
if bar_index == 2
    strategy.cancel('A')
if bar_index == 3
    strategy.entry('B', strategy.long, stop=101)
if bar_index == 5
    strategy.entry('C', strategy.short, stop=99)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        // XA closed with B; it does not catch C (as a buy stop at 80 it would
        // close C at its 99 fill).
        expect(strategy.closedtrades).toHaveLength(1);
        expect(strategy.closedtrades[0].entry_id).toBe('B');
        expect([strategy.closedtrades[0].exit_bar_index, strategy.closedtrades[0].exit_price]).toEqual([6, 99]);
        expect(strategy.opentrades).toHaveLength(1);
        expect(strategy.opentrades[0].entry_id).toBe('C');
    });

    it('meets a position filled at the close only at that close (bar 10602)', async () => {
        const candles = [
            flat(0),
            flat(1), // short signal: Short Entry stop 95, Short Exit stop 99.5
            flat(2), // short entry cancelled
            candle(3, 98, 101, 98, 101), // long signal, close == stop: long fills at the close 101
            candle(4, 101, 102, 100.5, 101.5),
        ];
        const context = await new PineTS(candles).run(script([3], [1], { longEntry: 101, longExit: 90, shortEntry: 95, shortExit: 99.5 }));
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        // The open 98 lies below the stale sell stop 99.5 but predates the
        // close fill; the close 101 and the next bar stay above it.
        expect(strategy.closedtrades).toHaveLength(0);
        expect(strategy.opentrades).toHaveLength(1);
        expect([strategy.opentrades[0].entry_bar_index, strategy.opentrades[0].entry_price]).toEqual([3, 101]);
    });

    it('does not keep the queue place of an exit whose position closed (1596 bar 935)', async () => {
        // Boundary of the creation-bar queue (FX:EURJPY 1596, TV 6536/6536):
        // the 50% sibling closes the last half of the first trade, the full
        // stop stays pending on the closed trade and is refreshed on bar 2.
        // For TV it is a new order there, so the 50% sibling keeps its
        // call-site priority on the second trade.
        const candles = [
            flat(0),
            candle(1, 100, 101, 94, 96), // L fills 2 at 100; XFull closes its 1 at 95
            candle(2, 100, 111, 99, 105), // XPart closes the other 1 at 110
            candle(3, 100, 111, 99, 105), // L fills 2 at 100; XPart closes 1 at 110
            flat(4),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('1596 sibling queue', default_qty_type=strategy.fixed, default_qty_value=2)
if bar_index == 0 or bar_index == 2
    strategy.entry('L', strategy.long)
strategy.exit('XPart', 'L', qty_percent=50, limit=110)
strategy.exit('XFull', 'L', stop=95)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');

        const exits = strategy.closedtrades.map((trade: { exit_bar_index: number; exit_price: number; size: number }) => [trade.exit_bar_index, trade.exit_price, trade.size]);
        expect(exits).toEqual([[1, 95, 1], [2, 110, 1], [3, 110, 1]]);
    });

    // Review guards: exits that never waited flat keep the call-site queue of
    // the parent build (byte-identical ledgers on these random walks).
    function walk(seed: number) {
        let state = seed * 9301 + 49297;
        const rnd = () => { state = (state * 9301 + 49297) % 233280; return state / 233280; };
        let price = 100;
        return Array.from({ length: 300 }, (_, i) => {
            const open = price;
            const close = open * (1 + (rnd() - 0.5) * 0.04);
            const high = Math.max(open, close) * (1 + rnd() * 0.01);
            const low = Math.min(open, close) * (1 - rnd() * 0.01);
            price = close;
            return candle(i, open, high, low, close);
        });
    }

    it('keeps the call-site queue for from_entry exits refreshed after their entry filled', async () => {
        const context = await new PineTS(walk(4)).run(`
//@version=5
strategy('review guard from_entry', pyramiding=1, default_qty_type=strategy.fixed, default_qty_value=1)
lg = ta.crossover(ta.sma(close,3), ta.sma(close,8))
inL = strategy.position_size > 0
if lg
    strategy.entry('L', strategy.long, stop=high)
if lg or inL
    strategy.exit('X2', 'L', stop=close*0.99)
if lg
    strategy.exit('X1', 'L', stop=close*0.90)`);
        const trades = context.strategy!.closedtrades;
        expect(trades).toHaveLength(15);
        expect([trades[6].entry_bar_index, trades[6].exit_bar_index, trades[6].exit_id]).toEqual([101, 103, 'X2']);
    });

    it('keeps the call-site queue for a wildcard exit placed before its entry each bar', async () => {
        const context = await new PineTS(walk(1)).run(`
//@version=5
strategy('review guard wildcard', default_qty_type=strategy.fixed, default_qty_value=1)
lg = ta.crossover(ta.sma(close,3), ta.sma(close,8))
strategy.exit('A', stop=close*0.99)
if lg
    strategy.entry('L', strategy.long)
if lg
    strategy.exit('B', 'L', stop=close*0.90)`);
        const trades = context.strategy!.closedtrades;
        expect(trades).toHaveLength(19);
        expect([trades[0].entry_bar_index, trades[0].exit_bar_index, trades[0].exit_id]).toEqual([17, 22, 'A']);
    });
});
