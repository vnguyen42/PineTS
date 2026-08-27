// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille : `args nommés des builtins positionnels (2110)` (FAMILLES.md) —
// ids révélateurs 1505 2105 2110 2284, fix fork `75e7e91` (transpiler:
// expand named arguments of positional-runtime builtins).
// JOURNAL.md:73,121-127.
//
// Contrat observable : les builtins à closures purement positionnelles
// (ta.*) acceptent les arguments nommés Pine : `ta.sma(source = close,
// length = 14)` et `ta.rsi(close, length = 14)` (mixage positionnel+nommé)
// doivent produire exactement la même série que leur jumeau 100 %
// positionnel. Avant le fix, le sac d'arguments nommés atterrissait dans le
// premier slot positionnel → na silencieux partout (oracle 2110 nommé ==
// jumeau positionnel byte-identique, JOURNAL.md:121-127).
//
// Run : npx vitest run tests/namespaces/ta/args-nommes-builtins-positionnels-2110.test.ts

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

function makeBars(n: number) {
    const DAY = 86_400_000;
    const t0 = Date.UTC(2020, 0, 1);
    const bars = [];
    for (let i = 0; i < n; i++) {
        const base = 100 + 10 * Math.sin(i / 2) + i * 0.7;
        const close = base + Math.cos(i / 3) * 3;
        const open = base;
        bars.push({ openTime: t0 + i * DAY, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 + i });
    }
    return bars;
}

function dedent(s: string): string {
    const lines = s.replace(/^\n/, '').replace(/\n\s*$/, '').split('\n');
    const widths = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length);
    const indent = Math.min(...widths);
    return lines.map((l) => l.slice(indent)).join('\n');
}

// dernière valeur finie d'un plot
function val(ctx: any, title: string): number {
    const data = ctx.plots[title]?.data ?? [];
    for (let i = data.length - 1; i >= 0; i--) {
        const v = data[i]?.value;
        if (v != null && !Number.isNaN(v)) return v;
    }
    return NaN;
}

describe('args nommés des builtins positionnels (1505 2105 2110 2284, fix 75e7e91)', () => {
    it('ta.sma(source = close, length = 14) == ta.sma(close, 14) sur toute la série', async () => {
        const pine = new PineTS(makeBars(20), 'TEST', 'D');
        const ctx = await pine.run(dedent(`
//@version=5
indicator("repro")
s = ta.sma(source = close, length = 14)
r = ta.sma(close, 14)
plot(s == r ? 1 : 0, "v")
`));
        // Warmup na inclus : la dernière valeur finie doit être 1
        // (nommé == positionnel). Avant le fix, s était na → 0.
        expect(val(ctx, 'v')).toBe(1);
    });

    it('ta.rsi(close, length = 14) (mixage positionnel + nommé) == ta.rsi(close, 14)', async () => {
        const pine = new PineTS(makeBars(20), 'TEST', 'D');
        const ctx = await pine.run(dedent(`
//@version=5
indicator("repro")
m = ta.rsi(close, length = 14)
n = ta.rsi(close, 14)
plot(m == n ? 1 : 0, "v")
`));
        expect(val(ctx, 'v')).toBe(1);
    });
});