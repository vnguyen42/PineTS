// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille : `bool==int` (FAMILLES.md) — ids révélateurs 1559 1808,
// fix fork `4352ea8` (math: Pine bool<->int equality in __eq/__neq).
// JOURNAL.md:440-443,455-458.
//
// Contrat observable : Pine compare un booléen à un nombre fini après
// coercion bool→int (false=0, true=1), dans les deux ordres d'opérandes —
// `true == 1`, `false == 0`, `1 == true` sont vrais ; `true == 0`,
// `false == 1` sont faux ; `!=` est la négation. Avant le fix, les opérandes
// booléen/number n'étaient jamais coercés → `true == 1` valait toujours
// false.
//
// Run : npx vitest run tests/namespaces/math/bool-eq-int-1559.test.ts

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

describe('bool==int — coercion bool↔0/1 dans __eq/__neq (1559 1808, fix 4352ea8)', () => {
    it('true==1, false==0, 1==true sont vrais ; true==0, false==1, true!=1, false!=0 sont faux', async () => {
        const pine = new PineTS(makeBars(20), 'TEST', 'D');
        const ctx = await pine.run(dedent(`
//@version=5
indicator("repro")
plot(true == 1 ? 1 : 0, "a")
plot(false == 0 ? 1 : 0, "b")
plot(1 == true ? 1 : 0, "c")
plot(true == 0 ? 1 : 0, "d")
plot(false == 1 ? 1 : 0, "e")
plot(true != 1 ? 1 : 0, "f")
plot(false != 0 ? 1 : 0, "g")
plot(2 == false ? 1 : 0, "h")
`));
        const v = (title: string) => ctx.plots[title].data[0].value;
        expect(v('a')).toBe(1); // true  == 1
        expect(v('b')).toBe(1); // false == 0
        expect(v('c')).toBe(1); // 1 == true  (ordre inversé)
        expect(v('d')).toBe(0); // true  == 0
        expect(v('e')).toBe(0); // false == 1
        expect(v('f')).toBe(0); // true  != 1
        expect(v('g')).toBe(0); // false != 0
        expect(v('h')).toBe(0); // 2 == false
    });
});