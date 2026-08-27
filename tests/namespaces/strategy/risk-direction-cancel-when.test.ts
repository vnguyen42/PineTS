// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import type { Context } from '../../../src/Context.class';

const BARS = [
    { openTime: 0, closeTime: 60_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 60_000, closeTime: 120_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 120_000, closeTime: 180_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 180_000, closeTime: 240_000, open: 100, high: 120, low: 99, close: 100, volume: 1 },
    { openTime: 240_000, closeTime: 300_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { openTime: 300_000, closeTime: 360_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
];

async function run(source: string): Promise<Context> {
    const pineTS = new PineTS(BARS, 'TEST', '1');
    return pineTS.run(source);
}

describe('risk direction: allow_entry_in close-leg semantics', () => {
    it('blocks a prohibited entry from flat (no position → no-op)', async () => {
        const context = await run(`
//@version=5
strategy('flat block', default_qty_type=strategy.fixed, default_qty_value=1)
strategy.risk.allow_entry_in('long')
if bar_index == 2
    strategy.entry('S', strategy.short, qty=1)
if bar_index == 4
    strategy.close_all('final')
`);

        expect(context.strategy?.closedtrades).toHaveLength(0);
        expect(context.strategy?.opentrades).toHaveLength(0);
        expect(context.strategy?.position_size).toBe(0);
    });

    it('a prohibited short reversal closes the whole long and opens no short', async () => {
        const context = await run(`
//@version=5
strategy('reversal close', pyramiding=3, default_qty_type=strategy.fixed, default_qty_value=1)
strategy.risk.allow_entry_in('long')
if bar_index == 0
    strategy.entry('L', strategy.long, qty=10)
if bar_index == 2
    strategy.entry('S', strategy.short, qty=4)
`);

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'L', size: 10, exit_id: 'S' });
        expect(context.strategy?.opentrades).toHaveLength(0);
        expect(context.strategy?.position_size).toBe(0);
    });

    it('a prohibited short partial close respects the requested qty', async () => {
        const context = await run(`
//@version=5
strategy('partial close', default_qty_type=strategy.fixed, default_qty_value=1)
strategy.risk.allow_entry_in('long')
if bar_index == 0
    strategy.entry('L', strategy.long, qty=10)
if bar_index == 2
    strategy.order('S', strategy.short, qty=4)
`);

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'L', size: 4, exit_id: 'S' });
        expect(context.strategy?.opentrades).toHaveLength(1);
        expect(context.strategy?.position_size).toBe(6);
    });

    it('a prohibited short reversal closes multiple lots FIFO without opening a short', async () => {
        const context = await run(`
//@version=5
strategy('lots full', pyramiding=3, default_qty_type=strategy.fixed, default_qty_value=1)
strategy.risk.allow_entry_in('long')
if bar_index == 0
    strategy.entry('L1', strategy.long, qty=7)
if bar_index == 1
    strategy.entry('L2', strategy.long, qty=3)
if bar_index == 3
    strategy.entry('S', strategy.short, qty=10)
`);

        expect(context.strategy?.closedtrades.map((t) => [t.entry_id, t.size, t.exit_id])).toEqual([
            ['L1', 7, 'S'],
            ['L2', 3, 'S'],
        ]);
        expect(context.strategy?.opentrades).toHaveLength(0);
        expect(context.strategy?.position_size).toBe(0);
    });

    it('a prohibited short partial close bites the oldest lot first (FIFO)', async () => {
        const context = await run(`
//@version=5
strategy('lots partial', pyramiding=3, default_qty_type=strategy.fixed, default_qty_value=1)
strategy.risk.allow_entry_in('long')
if bar_index == 0
    strategy.entry('L1', strategy.long, qty=7)
if bar_index == 1
    strategy.entry('L2', strategy.long, qty=3)
if bar_index == 3
    strategy.order('S', strategy.short, qty=4)
`);

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'L1', size: 4, exit_id: 'S' });
        expect(context.strategy?.opentrades.map((t) => [t.entry_id, t.size])).toEqual([
            ['L1', 3],
            ['L2', 3],
        ]);
        expect(context.strategy?.position_size).toBe(6);
    });

    it('rule short is symmetric: a prohibited long closes the short position', async () => {
        const context = await run(`
//@version=5
strategy('rule short', default_qty_type=strategy.fixed, default_qty_value=1)
strategy.risk.allow_entry_in('short')
if bar_index == 0
    strategy.entry('S', strategy.short, qty=10)
if bar_index == 2
    strategy.entry('L', strategy.long, qty=3)
`);

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'S', size: -10, exit_id: 'L' });
        expect(context.strategy?.opentrades).toHaveLength(0);
        expect(context.strategy?.position_size).toBe(0);
    });

    it('blocks a same-side prohibited add (short position + short order under long-only rule)', async () => {
        const context = await run(`
//@version=5
strategy('same side block', pyramiding=3, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.risk.allow_entry_in('all')
    strategy.order('S1', strategy.short, qty=5)
if bar_index == 2
    strategy.risk.allow_entry_in('long')
if bar_index == 3
    strategy.order('S2', strategy.short, qty=3)
`);

        expect(context.strategy?.closedtrades).toHaveLength(0);
        expect(context.strategy?.opentrades).toHaveLength(1);
        expect(context.strategy?.opentrades[0]).toMatchObject({ entry_id: 'S1', size: -5 });
        expect(context.strategy?.position_size).toBe(-5);
    });

    it('v4 form (1719 shape): allow_entry_in(strategy.direction.long), sell entry closes the long', async () => {
        const context = await run(`
//@version=4
strategy('v4 form', pyramiding=1, initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
strategy.risk.allow_entry_in(strategy.direction.long)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=10)
if bar_index == 2
    strategy.entry('S', strategy.short)
if bar_index == 4
    strategy.close_all('final')
`);

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'L', size: 10, exit_id: 'S' });
        expect(context.strategy?.position_size).toBe(0);
    });
});

// Famille : gating `when=` — VIN-31 (ids 2490/2401) : slot when en fin de signature, garde
// avant tout push d'ordre/mutation d'état, falsy explicite → no-op complet
// (ici sur cancel_all : when=false/na laisse les pending intacts et les fills suivre).
describe('cancel_all when-gating', () => {
    it('no-arg cancels pending entries and exits unconditionally', async () => {
        const context = await run(`
//@version=5
strategy('cancel noarg', pyramiding=2, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('L2', strategy.long, qty=1)
    strategy.exit('X', from_entry='L', qty=1, limit=110)
if bar_index == 2
    strategy.cancel_all()
if bar_index == 4
    strategy.close_all('final')
`);

        // X (the pending conditional exit) was cancelled at bar 2 — bar 3's
        // high 120 never closes L. The final close_all books both lots.
        expect(context.strategy?.closedtrades).toHaveLength(2);
        expect(context.strategy?.closedtrades.map((t) => t.exit_comment)).toEqual(['final', 'final']);
        expect(context.strategy?.pending_orders).toHaveLength(0);
    });

    it('no-arg cancels a pending entry placed the same bar (2121 mechanism)', async () => {
        const context = await run(`
//@version=5
strategy('cancel entry', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
    strategy.cancel_all()
if bar_index == 4
    strategy.close_all('final')
`);

        expect(context.strategy?.closedtrades).toHaveLength(0);
        expect(context.strategy?.position_size).toBe(0);
    });

    it('positional when=true cancels unconditionally', async () => {
        const context = await run(`
//@version=5
strategy('cancel true pos', pyramiding=2, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('L2', strategy.long, qty=1)
    strategy.exit('X', from_entry='L', qty=1, limit=110)
if bar_index == 2
    strategy.cancel_all(true)
if bar_index == 4
    strategy.close_all('final')
`);

        expect(context.strategy?.closedtrades.map((t) => t.exit_comment)).toEqual(['final', 'final']);
    });

    it('named when=true cancels unconditionally', async () => {
        const context = await run(`
//@version=5
strategy('cancel true named', pyramiding=2, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('L2', strategy.long, qty=1)
    strategy.exit('X', from_entry='L', qty=1, limit=110)
if bar_index == 2
    strategy.cancel_all(when=true)
if bar_index == 4
    strategy.close_all('final')
`);

        expect(context.strategy?.closedtrades.map((t) => t.exit_comment)).toEqual(['final', 'final']);
    });

    it('positional when=false is a complete no-op: pending entry fills and exit fires', async () => {
        const context = await run(`
//@version=5
strategy('cancel false pos', pyramiding=2, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('L2', strategy.long, qty=1)
    strategy.exit('X', from_entry='L', qty=1, limit=110)
if bar_index == 2
    strategy.cancel_all(false)
if bar_index == 4
    strategy.close_all('final')
`);

        // L2 filled at bar 2 open, X survived → L closed at 110 on bar 3.
        expect(context.strategy?.closedtrades).toHaveLength(2);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'L', exit_id: 'X', exit_price: 110, size: 1 });
        expect(context.strategy?.closedtrades[1]).toMatchObject({ entry_id: 'L2', exit_comment: 'final', size: 1 });
    });

    it('named when=false (transpiled bag, 2121 shape) is a complete no-op', async () => {
        const context = await run(`
//@version=5
strategy('cancel false named', pyramiding=2, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('L2', strategy.long, qty=1)
    strategy.exit('X', from_entry='L', qty=1, limit=110)
if bar_index == 2
    strategy.cancel_all(when=false)
if bar_index == 4
    strategy.close_all('final')
`);

        expect(context.strategy?.closedtrades).toHaveLength(2);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'L', exit_id: 'X', exit_price: 110 });
        expect(context.strategy?.closedtrades[1]).toMatchObject({ entry_id: 'L2', exit_comment: 'final' });
    });

    it('positional when=na is a complete no-op', async () => {
        const context = await run(`
//@version=5
strategy('cancel na pos', pyramiding=2, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('L2', strategy.long, qty=1)
    strategy.exit('X', from_entry='L', qty=1, limit=110)
if bar_index == 2
    strategy.cancel_all(na)
if bar_index == 4
    strategy.close_all('final')
`);

        expect(context.strategy?.closedtrades).toHaveLength(2);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'L', exit_id: 'X', exit_price: 110 });
    });

    it('named when=na is a complete no-op', async () => {
        const context = await run(`
//@version=5
strategy('cancel na named', pyramiding=2, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('L2', strategy.long, qty=1)
    strategy.exit('X', from_entry='L', qty=1, limit=110)
if bar_index == 2
    strategy.cancel_all(when=na)
if bar_index == 4
    strategy.close_all('final')
`);

        expect(context.strategy?.closedtrades).toHaveLength(2);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'L', exit_id: 'X', exit_price: 110 });
    });
});
