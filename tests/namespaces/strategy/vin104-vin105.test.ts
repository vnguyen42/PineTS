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

describe('VIN-104/105 strategy risk and cancellation parity', () => {
    it('cancel_all removes a pending conditional exit before its trigger', async () => {
        const context = await run(`
//@version=5
strategy('cancel exit', pyramiding=2, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.exit('X', from_entry='L', qty=1, limit=110)
if bar_index == 2
    strategy.cancel_all()
if bar_index == 4
    strategy.close_all('final')
`);

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({
            entry_id: 'L',
            size: 1,
            exit_comment: 'final',
            exit_price: 100,
        });
        expect(context.strategy?.pending_orders).toHaveLength(0);
    });

    it('truncates an oversized entry to max_position_size at fill time', async () => {
        const context = await run(`
//@version=5
strategy('max position', default_qty_type=strategy.fixed, default_qty_value=1)
strategy.risk.max_position_size(15)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=20)
if bar_index == 2
    strategy.close_all('cleanup')
`);

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'L', size: 15 });
    });

    it('truncates a pyramiding add to the remaining max-position margin', async () => {
        const context = await run(`
//@version=5
strategy('max position pyramid', pyramiding=3, default_qty_type=strategy.fixed, default_qty_value=1)
strategy.risk.max_position_size(15)
if bar_index == 0
    strategy.entry('L1', strategy.long, qty=10)
if bar_index == 1
    strategy.entry('L2', strategy.long, qty=10)
if bar_index == 2
    strategy.close_all('cleanup')
`);

        expect(context.strategy?.closedtrades).toHaveLength(2);
        expect(context.strategy?.closedtrades.map((trade) => [trade.entry_id, trade.size])).toEqual([
            ['L1', 10],
            ['L2', 5],
        ]);
    });

    it('rejects a new entry when the remaining max-position margin is zero', async () => {
        const context = await run(`
//@version=5
strategy('max position full', pyramiding=3, default_qty_type=strategy.fixed, default_qty_value=1)
strategy.risk.max_position_size(15)
if bar_index == 0
    strategy.entry('L1', strategy.long, qty=10)
if bar_index == 1
    strategy.entry('L2', strategy.long, qty=10)
if bar_index == 2
    strategy.entry('L3', strategy.long, qty=10)
if bar_index == 3
    strategy.close_all('cleanup')
`);

        expect(context.strategy?.closedtrades).toHaveLength(2);
        expect(context.strategy?.closedtrades.map((trade) => trade.entry_id)).toEqual(['L1', 'L2']);
        expect(context.strategy?.closedtrades.map((trade) => trade.size)).toEqual([10, 5]);
    });

    it('leaves a reducing order at its requested quantity', async () => {
        const context = await run(`
//@version=5
strategy('reducing order', default_qty_type=strategy.fixed, default_qty_value=1)
strategy.risk.max_position_size(15)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=10)
if bar_index == 1
    strategy.order('reduce', strategy.short, qty=5)
`);

        expect(context.strategy?.closedtrades).toHaveLength(1);
        expect(context.strategy?.closedtrades[0]).toMatchObject({ entry_id: 'L', size: 5, exit_id: 'reduce' });
        expect(context.strategy?.position_size).toBe(5);
    });
});
