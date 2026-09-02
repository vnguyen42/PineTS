// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille : gating `when=` — VIN-31 (ids 2490/2401), fix fork b1421b7.
// Contrat : `when` est le slot terminal des signatures strategy.entry/order/
// close/exit. Une valeur falsy explicitement fournie est un no-op complet,
// avant toute mutation ou insertion dans pending_orders ; l'absence du slot et
// une valeur truthy conservent le comportement normal.

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { close } from '../../../src/namespaces/strategy/methods/close';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { exit } from '../../../src/namespaces/strategy/methods/exit';
import { order } from '../../../src/namespaces/strategy/methods/order';
import { initializeStrategy } from '../../../src/namespaces/strategy/utils';
import type { Trade } from '../../../src/namespaces/strategy/types';

function makeContext(): Context {
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'TEST',
        timeframe: '1',
    });
    context.pineVersion = 5;
    context.pine = {
        qtyStep: 1,
        syminfo: { mintick: 0.01, pointvalue: 1, type: 'stock' },
    } as any;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    initializeStrategy(context, {
        default_qty_type: 'fixed',
        default_qty_value: 1,
        pyramiding: 10,
    });
    return context;
}

function seedOpenLong(context: Context): void {
    const trade: Trade = {
        id: 'trade-0',
        entry_id: 'L',
        entry_price: 100,
        entry_bar_index: 0,
        entry_time: 0,
        size: 1,
        status: 'open',
    };
    context.strategy!.opentrades = [trade];
    context.strategy!.position_size = 1;
    context.strategy!.position_avg_price = 100;
    context.strategy!.position_entry_name = 'L';
}

function strategySnapshot(context: Context) {
    const strategy = context.strategy as any;
    return {
        pending_orders: strategy.pending_orders.map((order: any) => ({ ...order })),
        opentrades: strategy.opentrades.map((trade: any) => ({ ...trade })),
        closedtrades: strategy.closedtrades.map((trade: any) => ({ ...trade })),
        position_size: strategy.position_size,
        position_avg_price: strategy.position_avg_price,
        position_entry_name: strategy.position_entry_name,
        equity: strategy.equity,
        netprofit: strategy.netprofit,
        grossprofit: strategy.grossprofit,
        grossloss: strategy.grossloss,
        openprofit: strategy.openprofit,
        exit_call_history: Array.from(strategy._exit_call_history.entries()),
        exit_fallback_counter: strategy._exit_fallback_counter,
        exit_fallback_last_bar: strategy._exit_fallback_last_bar,
    };
}

function expectEntryQueued(context: Context, id: string): void {
    expect(context.strategy?.pending_orders).toHaveLength(1);
    expect(context.strategy?.pending_orders[0]).toMatchObject({
        id,
        direction: 1,
        qty: 1,
        type: 'market',
        status: 'pending',
        category: 'entry',
    });
}

function expectOrderQueued(context: Context, id: string): void {
    expect(context.strategy?.pending_orders).toHaveLength(1);
    expect(context.strategy?.pending_orders[0]).toMatchObject({
        id,
        direction: 1,
        qty: 1,
        type: 'market',
        status: 'pending',
    });
}

function expectCloseQueued(context: Context): void {
    expect(context.strategy?.pending_orders).toHaveLength(1);
    expect(context.strategy?.pending_orders[0]).toMatchObject({
        id: 'close_L',
        type: 'market',
        status: 'pending',
        category: 'exit',
        from_entry: 'L',
    });
}

function expectExitQueued(context: Context): void {
    expect(context.strategy?.pending_orders).toHaveLength(1);
    expect(context.strategy?.pending_orders[0]).toMatchObject({
        id: 'X',
        type: 'market',
        status: 'pending',
        category: 'exit',
        from_entry: 'L',
        limit: 110,
    });
}

function positionalEntryArgs(when: boolean): any[] {
    return ['entry-positional', 'long', 1, NaN, NaN, '', '', '', '', false, when];
}

function positionalOrderArgs(when: boolean): any[] {
    return ['order-positional', 'long', 1, NaN, NaN, '', '', '', '', false, when];
}

function positionalCloseArgs(when: boolean): any[] {
    return ['L', '', NaN, NaN, '', false, false, when];
}

function positionalExitArgs(when: boolean, callsiteId: string): any[] {
    return [
        'X', 'L', NaN, NaN, NaN, 110, NaN, NaN, NaN, NaN, NaN,
        '', '', '', '', '', '', '', '', '', false, when,
        { __callsiteId: callsiteId },
    ];
}

describe('VIN-31 gating when= (2490/2401, fix b1421b7)', () => {
    it('strategy.entry: named and terminal positional falsy when are complete no-ops, truthy queues', () => {
        const namedFalse = makeContext();
        const namedFalseBefore = strategySnapshot(namedFalse);
        entry(namedFalse)('entry-named', 'long', { qty: 1, when: false });
        expect(strategySnapshot(namedFalse)).toEqual(namedFalseBefore);

        const positionalFalse = makeContext();
        const positionalFalseBefore = strategySnapshot(positionalFalse);
        entry(positionalFalse)(...positionalEntryArgs(false));
        expect(strategySnapshot(positionalFalse)).toEqual(positionalFalseBefore);

        const namedTrue = makeContext();
        entry(namedTrue)('entry-named', 'long', { qty: 1, when: true });
        expectEntryQueued(namedTrue, 'entry-named');

        const positionalTrue = makeContext();
        entry(positionalTrue)(...positionalEntryArgs(true));
        expectEntryQueued(positionalTrue, 'entry-positional');
    });

    it('strategy.order: named and terminal positional falsy when are complete no-ops, truthy queues', () => {
        const namedFalse = makeContext();
        const namedFalseBefore = strategySnapshot(namedFalse);
        order(namedFalse)('order-named', 'long', { qty: 1, when: false });
        expect(strategySnapshot(namedFalse)).toEqual(namedFalseBefore);

        const positionalFalse = makeContext();
        const positionalFalseBefore = strategySnapshot(positionalFalse);
        order(positionalFalse)(...positionalOrderArgs(false));
        expect(strategySnapshot(positionalFalse)).toEqual(positionalFalseBefore);

        const namedTrue = makeContext();
        order(namedTrue)('order-named', 'long', { qty: 1, when: true });
        expectOrderQueued(namedTrue, 'order-named');

        const positionalTrue = makeContext();
        order(positionalTrue)(...positionalOrderArgs(true));
        expectOrderQueued(positionalTrue, 'order-positional');
    });

    it('strategy.close: named and terminal positional falsy when preserve the open state, truthy queues', () => {
        const namedFalse = makeContext();
        seedOpenLong(namedFalse);
        const namedFalseBefore = strategySnapshot(namedFalse);
        close(namedFalse)('L', { when: false });
        expect(strategySnapshot(namedFalse)).toEqual(namedFalseBefore);

        const positionalFalse = makeContext();
        seedOpenLong(positionalFalse);
        const positionalFalseBefore = strategySnapshot(positionalFalse);
        close(positionalFalse)(...positionalCloseArgs(false));
        expect(strategySnapshot(positionalFalse)).toEqual(positionalFalseBefore);

        const namedTrue = makeContext();
        seedOpenLong(namedTrue);
        close(namedTrue)('L', { when: true });
        expectCloseQueued(namedTrue);

        const positionalTrue = makeContext();
        seedOpenLong(positionalTrue);
        close(positionalTrue)(...positionalCloseArgs(true));
        expectCloseQueued(positionalTrue);
    });

    it('strategy.exit: named and terminal positional falsy when preserve state before exit bookkeeping, truthy queues', () => {
        const namedFalse = makeContext();
        const namedFalseBefore = strategySnapshot(namedFalse);
        exit(namedFalse)('X', 'L', { limit: 110, when: false }, { __callsiteId: 'exit-named-false' });
        expect(strategySnapshot(namedFalse)).toEqual(namedFalseBefore);

        const positionalFalse = makeContext();
        const positionalFalseBefore = strategySnapshot(positionalFalse);
        exit(positionalFalse)(...positionalExitArgs(false, 'exit-positional-false'));
        expect(strategySnapshot(positionalFalse)).toEqual(positionalFalseBefore);

        const namedTrue = makeContext();
        exit(namedTrue)('X', 'L', { limit: 110, when: true }, { __callsiteId: 'exit-named-true' });
        expectExitQueued(namedTrue);

        const positionalTrue = makeContext();
        exit(positionalTrue)(...positionalExitArgs(true, 'exit-positional-true'));
        expectExitQueued(positionalTrue);
    });
});
