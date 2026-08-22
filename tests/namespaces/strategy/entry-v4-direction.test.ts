// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { initializeStrategy, processStrategyOrders, processExitOrders } from '../../../src/namespaces/strategy/utils';
import { entry } from '../../../src/namespaces/strategy/methods/entry';
import { close_all } from '../../../src/namespaces/strategy/methods/close_all';
import { close } from '../../../src/namespaces/strategy/methods/close';
import { Series } from '../../../src/Series';

type StrategyContext = Context & { strategy: NonNullable<Context['strategy']> };

function assertStrategy(context: Context): asserts context is StrategyContext {
    if (!context.strategy) throw new Error('strategy test context was not initialized');
}

/**
 * VIN-91 — v4 `strategy.entry(id, long=true/false)` (et forme positionnelle
 * bool/int) non traduits : `long=` n'était jamais lu et un booléen en slot 2
 * donnait dir=0 → ordres direction 0 → trades fantômes de taille 0 accumulés
 * (processExitOrders O(n²) → TIMEOUT sur les scripts corpus 1546/2672).
 *
 * Formes couvertes (types vérifiés, corpus analysé par statique 2026-08-22) :
 *   - nommée v4 `long=true` / `long=false` — arrive via le bag d'options
 *     (le transpileur collecte les args nommés en objet final), ici invoqué
 *     directement comme `entry(ctx)('id', { long: <bool>, when: … })`.
 *   - positionnelle v4 bool `true`/`false` et int `1`/`0`.
 *   - v4 `long=strategy.long` / `long=strategy.short` (bool-like en v4,
 *     valeurs 'long'/'short' côté moteur).
 *   - v5 direction inchangée : 'long'/'short' en slot 2 (constantes) ;
 *     les formes legacy bool/long ne sont pas réinterprétées en v5.
 *   - absence de direction → erreur explicite (paramètre requis en v4 et v5).
 *   - `short=` (n'existe pas en v4, non exercé) et direction intraduisible →
 *     erreur explicite, aucun ordre poussé.
 */

function makeContext(config: Record<string, unknown> = {}): StrategyContext {
    const { pineVersion = 4, ...strategyConfig } = config;
    const context = new Context({
        marketData: [],
        source: [],
        tickerId: 'BTCUSDT',
        timeframe: 'D',
    });
    context.pineVersion = typeof pineVersion === 'number' ? pineVersion : 4;
    context.idx = 0;
    context.data.open = new Series([100]);
    context.data.high = new Series([101]);
    context.data.low = new Series([99]);
    context.data.close = new Series([100]);
    context.data.openTime = new Series([0]);
    context.pine.syminfo = { mintick: 0.01, pointvalue: 1 };
    initializeStrategy(context, { pyramiding: 3, ...strategyConfig });
    assertStrategy(context);
    return context;
}

/** Advance one bar so queued market orders fill at the next open. */
function advanceBar(context: StrategyContext, open = 100, high = 101, low = 99, close = 100) {
    context.idx += 1;
    context.data.open = new Series([100, open]);
    context.data.high = new Series([101, high]);
    context.data.low = new Series([99, low]);
    context.data.close = new Series([100, close]);
    context.data.openTime = new Series([0, context.idx * 86_400_000]);
}

describe('strategy.entry — v4 direction translation (VIN-91)', () => {
    it('named v4 `long=true` queues a LONG entry (dir=+1, qty>0), no ghost', () => {
        const context = makeContext();
        const e = entry(context);
        e('buy', { long: true });
        const o = context.strategy.pending_orders;
        expect(o).toHaveLength(1);
        expect(o[0].direction).toBe(1);
        expect(o[0].qty).toBe(1);
        expect(o[0].category).toBe('entry');
    });

    it('named v4 `long=false` queues a SHORT entry (dir=-1)', () => {
        const context = makeContext();
        entry(context)('sell', { long: false });
        expect(context.strategy.pending_orders[0].direction).toBe(-1);
        expect(context.strategy.pending_orders[0].qty).toBe(1);
    });

    it('named v4 `long=strategy.long` / `long=strategy.short` (string values) translate', () => {
        const context = makeContext();
        const e = entry(context);
        e('L', { long: 'long' });
        e('S', { long: 'short' });
        expect(context.strategy.pending_orders[0].direction).toBe(1);
        expect(context.strategy.pending_orders[1].direction).toBe(-1);
    });

    it('positional v4 bool: true → long, false → short', () => {
        const context = makeContext();
        const e = entry(context);
        e('L', true);
        e('S', false);
        expect(context.strategy.pending_orders[0].direction).toBe(1);
        expect(context.strategy.pending_orders[1].direction).toBe(-1);
    });

    it('positional v4 legacy int idiom: 1 → long, 0 → short', () => {
        const context = makeContext();
        const e = entry(context);
        e('L', 1);
        e('S', 0);
        expect(context.strategy.pending_orders[0].direction).toBe(1);
        expect(context.strategy.pending_orders[1].direction).toBe(-1);
    });

    it('v5 direction constants unchanged: positional "long"/"short" strings', () => {
        const context = makeContext({ pineVersion: 5 });
        const e = entry(context);
        e('L', 'long');
        e('S', 'short');
        expect(context.strategy.pending_orders[0].direction).toBe(1);
        expect(context.strategy.pending_orders[1].direction).toBe(-1);
        expect(context.strategy.pending_orders.every((o) => o.qty > 0)).toBe(true);
    });

    it('v5 does not reinterpret legacy bool/long forms as direction constants', () => {
        const context = makeContext({ pineVersion: 5 });
        expect(() => entry(context)('bool', true)).toThrow(/direction non traduisible/);
        expect(() => entry(context)('named', { long: true })).toThrow(/direction is required/);
        expect(context.strategy.pending_orders).toHaveLength(0);
    });

    it('direction is required in both v4 and v5', () => {
        expect(() => entry(makeContext({ pineVersion: 4 }))('v4')).toThrow('strategy.entry: direction is required');
        expect(() => entry(makeContext({ pineVersion: 5 }))('v5')).toThrow('strategy.entry: direction is required');
    });

    it('named `long=` wins over a positional direction (parseArgs precedence)', () => {
        const context = makeContext();
        entry(context)('L', true, { long: false });
        expect(context.strategy.pending_orders[0].direction).toBe(-1);
    });

    it('when=false in the named bag gates the entry (no order queued)', () => {
        const context = makeContext();
        entry(context)('L', { long: true, when: false });
        expect(context.strategy.pending_orders).toHaveLength(0);
        entry(context)('L', { long: true, when: true });
        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0].direction).toBe(1);
    });

    it('`short=` bag key is rejected explicitly (not a v4 parameter, unexercised)', () => {
        const context = makeContext();
        expect(() => entry(context)('S', { short: true })).toThrow(/short=/);
        expect(context.strategy.pending_orders).toHaveLength(0);
    });

    it('unparseable direction (na / "all") throws explicitly and pushes no order', () => {
        const context = makeContext();
        expect(() => entry(context)('L', NaN)).toThrow(/direction non traduisible/);
        expect(() => entry(context)('L', 'all')).toThrow(/direction non traduisible/);
        expect(context.strategy.pending_orders).toHaveLength(0);
    });

    it('minimal repro (V4Residuals) : long=true + close — real trades, no size-0 ghost', () => {
        const context = makeContext({ default_qty_type: 'fixed', default_qty_value: 1 });
        const e = entry(context);
        // v4 `strategy.entry("Long", long=true, when=c)` — c vrai ici.
        e('Long', { long: true, when: true });
        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0].direction).toBe(1);
        expect(context.strategy.pending_orders[0].qty).toBe(1);

        advanceBar(context);
        expect(processStrategyOrders(context)).toBe(1); // entry fills
        expect(context.strategy.position_size).toBe(1);
        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0].size).toBe(1); // NOT 0 (avant fix : taille 0)

        // v4 `strategy.close("Long", when=not c)` — position ouverte → no-op
        // de garde levé, l'ordre de sortie est mis en file.
        close(context)('Long', { when: true });
        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0].category).toBe('exit');

        // La sortie market remplit à la barre suivante et clôt le trade.
        advanceBar(context);
        expect(processStrategyOrders(context)).toBe(0); // pas d'entrée en file
        expect(processExitOrders(context)).toBe(1); // close remplit à l'open
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0].size).toBe(1);
    });

    it('v4 reversal: long=false reverses a long position (qty = |pos| + base)', () => {
        const context = makeContext();
        const e = entry(context);
        e('L', { long: true });
        advanceBar(context);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.position_size).toBe(1);

        e('S', { long: false });
        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0].direction).toBe(-1);
        expect(context.strategy.pending_orders[0].qty).toBe(2); // close 1 + open 1
        expect(context.strategy.pending_orders[0]._isReversalEntry).toBe(true);

        advanceBar(context);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.position_size).toBe(-1);
        expect(context.strategy.closedtrades).toHaveLength(1); // le long fermé
        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0].size).toBe(-1);
    });

    it('close_all after v4 long=true entries exits real positions', () => {
        const context = makeContext();
        const e = entry(context);
        e('buy', { long: true });
        advanceBar(context);
        expect(processStrategyOrders(context)).toBe(1);
        expect(context.strategy.position_size).toBe(1);

        close_all(context)();
        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0].category).toBe('exit');

        advanceBar(context);
        expect(processStrategyOrders(context)).toBe(0); // pas d'entrée en file
        expect(processExitOrders(context)).toBe(1); // close_all remplit à l'open
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.opentrades).toHaveLength(0);
    });
});
