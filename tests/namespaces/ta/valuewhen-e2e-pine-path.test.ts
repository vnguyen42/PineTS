// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * VALUEWHEN_SOURCE_ROUNDED_10DP — preuve END-TO-END sur le vrai chemin
 * PineTS (Pine v5 → transpile → moteur), calquée sur la frontière réelle
 * b499/b500→b501 de 2014 (report-trace-PVT.md).
 *
 * Le motif reproduit le mécanisme de 2014 sans PVT : un `valuewhen`
 * mémorise un close brut à 16 décimales lors d'un croisement, puis
 * `ta.crossunder(close, VTY)` compare le close suivant à cette valeur.
 *
 *   - SANS fix : VTY = context.precision(1.3088899999999999) = 1.30889
 *     → le close brut 1.3088899999999999 est inférieur au niveau arrondi
 *       sur b500, donc le faux crossunder déclenche trop tôt.
 *   - AVEC fix : VTY = 1.3088899999999999 brut → close == VTY sur b500,
 *     donc pas de crossunder ; il est déclenché uniquement par le vrai
 *     passage sous le niveau sur b501.
 *
 * Les barres 0..4 sont des barres de chauffe ; la capture a lieu sur la
 * barre 5, l'égalité sur la barre 6 (b500) et le passage sous le niveau sur
 * la barre 7 (b501).
 */

import { describe, it, expect } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const T0 = Date.parse('2024-01-01T00:00:00Z');
const HOUR = 3_600_000;

function kline(openTime: number, close: number) {
    return {
        openTime,
        open: close, high: close, low: close, close,
        closeTime: openTime + HOUR, volume: 1000,
    };
}

// Closes bruts à 16 décimales, reproduisant la frontière du report PVT :
// barre 5 = 1.3088899999999999 (la valeur mémorisée), barre 6 = même valeur
// (égalité), barre 7 = 1.3088 (passage réel sous le niveau).
const RAW_CAPTURE = 1.3088899999999999;
const ROUNDED_CAPTURE = 1.30889;
const CLOSES = [1.31, 1.3095, 1.3092, 1.309, 1.30895, RAW_CAPTURE, RAW_CAPTURE, 1.3088, 1.309];

// Condition de capture : vraie à la barre 5 uniquement — valeur mémorisée =
// close[5] = 1.3088899999999999 (calquée sur la frontière b499/b500 : le
// report PVT utilise la même forme valuewhen(cond, close, 0)).
function sourcePine(): string {
    return `//@version=5
indicator("2014-frontier-repro")

VTY = ta.valuewhen(bar_index == 5, close, 0)
cond = ta.crossunder(close, VTY)

plot(VTY, title="vty")
plot(cond ? 1 : 0, title="cond")
plot(close, title="c")
`;
}

async function runEngine() {
    const candles = CLOSES.map((c, i) => kline(T0 + i * HOUR, c));
    const engine = new PineTS(candles, 'TEST', '60', null, T0, T0 + (CLOSES.length - 1) * HOUR);
    return engine.run(sourcePine());
}

function bars(plots: Record<string, { data: Array<{ value: unknown }> }>, name: string): unknown[] {
    return plots[name]?.data.map((p) => p.value) ?? [];
}

function firstCondBar(values: unknown[]): number {
    return values.findIndex((v) => Number(v) === 1);
}

describe('ta.valuewhen end-to-end Pine path (FIX-2, 2014 frontière b499/b500→b501)', () => {
    it('E2E : sans arrondi, le crossunder ne part PAS sur la barre d’égalité mais quand le prix passe réellement dessous', async () => {
        const { plots } = await runEngine();
        const vty = bars(plots, 'vty');
        const cond = bars(plots, 'cond');

        // Le plot a des barres de warmup NaN en tête.
        const firstFinite = vty.findIndex((v) => Number.isFinite(Number(v)));
        expect(firstFinite).toBe(5);
        // Assertion structurelle : la valeur mémorisée reste exactement la
        // source brute, au lieu de devenir 1.30889 (preuve rouge pré-fix).
        expect(Object.is(vty[firstFinite], RAW_CAPTURE)).toBe(true);
        expect(Number(vty[firstFinite])).toBe(RAW_CAPTURE);
        expect(Number(vty[firstFinite])).not.toBe(ROUNDED_CAPTURE);

        // À la barre 6 (close == VTY brut, b500) : égalité, PAS de crossunder.
        expect(Number(cond[6])).toBe(0);
        // À la barre 7 (close < VTY brut, b501) : crossunder vrai.
        expect(Number(cond[7])).toBe(1);
        // Aucun crossunder avant la barre 7.
        expect(firstCondBar(cond)).toBe(7);
    });

    it('E2E : le collector de plots stocke la valeur brute (pas de formateur aval)', async () => {
        const { plots } = await runEngine();
        const vty = bars(plots, 'vty');
        const captured = vty.find((v) => Number.isFinite(Number(v)));
        // Invariant documenté par Plots.ts:258-276 : plot() lit la valeur
        // de série et la stocke telle quelle. L’affichage TV à 10 décimales
        // est un formateur AVAL ; le moteur ne doit pas le simuler.
        expect(Number(captured)).toBe(RAW_CAPTURE);
        expect(Number(captured)).not.toBe(ROUNDED_CAPTURE);
    });
});