// SPDX-License-Identifier: AGPL-3.0-only
//
// Famille : tolérance relationnelle magnitude-relative (FAMILLES.md) — id
// révélateur 2470 (BINANCE:BONKUSDT 60m, « Mean Reversion and
// Trendfollowing »).
//
// Bug (itération moteur n°2, 2026-09-03) : les six helpers relationnels
// (__lt/__le/__gt/__ge/__eq/__neq) traitaient comme égales les valeurs à
// moins d'une TOLÉRANCE ABSOLUE 1e-10. À BONK (prix ≈ 6e-6), 1e-10 absolu
// ≈ 1/100 de tick ≈ 1.7e-5 relatif : la différence réelle 7e-11 (close
// 0.0000059 vs 0.95 × sma200 quantifiée 0.0000062106, barre 19407) était
// avalée → ordre posé une barre trop tard, exécuté au prix inférieur, et le
// trade 19409→19412 jamais pris. Contre-oracle (Part 1 de la lane) : rejeu
// indépendant en COMPARAISONS EXACTES → 749/749 clés structurelles TV
// (dont la sortie 19408 @0.00000591 et le trade 19409→19412), vs 747/749
// moteur.
//
// Nouvelle formule (bornée, jamais plus lâche que l'ancienne) :
//   tol = min(1e-10, 1e-10 × max(|a|, |b|))
// — RELATIVE 1e-10 (10 chiffres significatifs) sous la magnitude 1 : à
// BONK, tol ≈ 6e-16 ≪ 7e-11 → différence RÉELLE ; — CAPÉE à la tolérance
// historique 1e-10 pour les magnitudes ≥ 1 : comportement strictement
// identique à l'ancien moteur (aucun nouveau masquage, « jamais plus lâche
// qu'aujourd'hui »).
//
// Pourquoi pas min(1e-10, 1e-12 × max(1, |a|, |b|)) (recommandation du
// brief) : elle contredit les sondes TV RÉELLES à magnitude 1 —
// `1.0 + 5e-11 == 1.0` → true, probé 2026-06-19 BTCUSDC 1W (exige une
// tolérance ≥ 5e-11 à 1.0, or 1e-12 < 5e-11) — et casserait
// na-comparison.test.ts dont les attentes viennent de ces sondes. La forme
// retenue satisfait toutes les sondes connues : mag 1 → 5e-11 égale /
// 5e-10 réelle (tol 1e-10) ; mag 6e-6 → 7e-11 réelle (tol ≈ 6e-16) ;
// mag ≥ 1 → identique à l'ancien moteur (cap 1e-10).
//
// Bord de tol = 0 : aux opérandes ±0, la tolérance vaut 0 — l'égalité
// exacte (a === b) est traitée comme égale, et la sémantique stricte des
// opérateurs relationnels la préserve naturellement (0 < 0 est false).
//
// Bloc ROUGE sur parent (tolérance absolue 1e-10) : « 2470 — 7e-11 à
// magnitude ≈ 6e-6 » (6 opérateurs) et « fraction réelle sous l'ancien
// 1e-10 absolu à magnitude 0.01 » (2e-11 avalée par le parent).
//
// Ces scripts passent par le chemin transpiler Pine complet (les rewrites
// d'opérateurs `==`/`!=`/`<`/`<=`/`>`/`>=` vers les helpers sont exercés).
// Les littéraux sont tous ≤ 10 décimales (la quantification moteur à 10
// décimales les préserve) ; les fractions sub-décimales (5e-11, 7e-11,
// 2e-11) sont construites par MULTIPLICATION de littéraux sûrs pour rester
// exactes à l'exécution.
//
// Run : npx vitest run tests/namespaces/math/relational-tolerance-magnitude-relative-2470.test.ts

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

async function runPine(src: string) {
    const pine = new PineTS(makeBars(20), 'TEST', 'D');
    return pine.run(dedent(src));
}

// last finite plotted value for a title
function val(ctx: any, title: string): number {
    const data = ctx.plots[title]?.data ?? [];
    for (let i = data.length - 1; i >= 0; i--) {
        const v = data[i]?.value;
        if (v != null && !Number.isNaN(v)) return v;
    }
    return NaN;
}

describe('tolérance relationnelle magnitude-relative (2470)', () => {
    it('2470 — 7e-11 à magnitude ≈ 6e-6 est une différence RÉELLE pour les six opérateurs (rouge sur parent)', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            // Barre 19407 de 2470 : close 0.0000059 vs 0.95 × sma200 quantifiée
            // (0.0000062106) → écart réel 7e-11. TV : ordre posé (vrai).
            sma = 0.0000062106
            thr = 0.95 * sma
            c = 0.0000059
            plot(c < thr ? 1 : 0, "lt")
            plot(c == thr ? 1 : 0, "eq")
            plot(c != thr ? 1 : 0, "neq")
            plot(c >= thr ? 1 : 0, "ge")
            plot(thr > c ? 1 : 0, "gt")
            plot(thr <= c ? 1 : 0, "le")
        `);
        expect(val(ctx, 'lt')).toBe(1);  // c < thr : vrai (l'écart n'est pas avalé)
        expect(val(ctx, 'eq')).toBe(0);  // c == thr : faux (7e-11 est réel)
        expect(val(ctx, 'neq')).toBe(1); // c != thr : vrai
        expect(val(ctx, 'ge')).toBe(0);  // c >= thr : faux
        expect(val(ctx, 'gt')).toBe(1);  // thr > c : vrai
        expect(val(ctx, 'le')).toBe(0);  // thr <= c : faux
    });

    it('bornes — cap 1e-10 aux grandes magnitudes : identique à l\'ancien moteur', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            // À 50000, tol = min(1e-10, 1e-10 × 50000) = 1e-10 : 5e-11 avalé,
            // 5e-7 réel — strictement le comportement d'avant le fix.
            plot(50000.0 == 50000.0 + 0.00000005 * 0.001 ? 1 : 0, "capIn")
            plot(50000.0 == 50000.0 + 0.0005 * 0.001 ? 1 : 0, "capOut")
            plot(50000.0 < 50000.0 + 0.0005 * 0.001 ? 1 : 0, "capLt")
        `);
        expect(val(ctx, 'capIn')).toBe(1);  // +5e-11 : égal (comme avant)
        expect(val(ctx, 'capOut')).toBe(0); // +5e-7 : réel (comme avant)
        expect(val(ctx, 'capLt')).toBe(1);  // +5e-7 : strictement plus grand
    });

    it('bornes — fraction réelle sous l\'ancien 1e-10 absolu à magnitude 0.01 (rouge sur parent)', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            // À 0.01, tol = 1e-12 : l'écart 2e-11 (construit par 0.00000002 × 0.001)
            // est 20× au-dessus de la nouvelle tolérance mais 5× sous l'ancien
            // 1e-10 absolu → le parent l'avalait, le fork corrigé le voit réel.
            plot(0.01 == 0.01 + 0.00000002 * 0.001 ? 1 : 0, "realEq")
            plot(0.01 < 0.01 + 0.00000002 * 0.001 ? 1 : 0, "realLt")
        `);
        expect(val(ctx, 'realEq')).toBe(0);
        expect(val(ctx, 'realLt')).toBe(1);
    });

    it('bornes — bruit machine avalé comme avant (0.1 − 9×0.01 == 0.01, 0.1/0.01 == 10)', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            // Bruit de soustraction amont : 0.1 − 9×0.01 = 0.010000000000000009
            // (écart 8.7e-18 ≪ tol 1e-12) ; division : 0.1/0.01 = 9.999999999999998
            // (écart 2.2e-15 ≪ tol 1e-10). Les deux restent égaux.
            plot(0.1 - 9 * 0.01 == 0.01 ? 1 : 0, "noiseSub")
            plot(0.1 / 0.01 == 10.0 ? 1 : 0, "noiseDiv")
        `);
        expect(val(ctx, 'noiseSub')).toBe(1);
        expect(val(ctx, 'noiseDiv')).toBe(1);
    });

    it('bornes — sondes TV magnitude 1 inchangées (5e-11 égale, 5e-10 réelle)', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            // Sondes TradingView (2026-06-19, BTCUSDC 1W) : à 1.0 la tolérance TV
            // vaut 1e-10 (cap) — 5e-11 égal, 5e-10 réel. Identique à l'ancien
            // moteur ET aux sondes.
            plot(1.0 + 0.00000005 * 0.001 == 1.0 ? 1 : 0, "probeEqIn")
            plot(1.0 + 0.0000005 * 0.001 == 1.0 ? 1 : 0, "probeEqOut")
            plot(1.0 + 0.00000005 * 0.001 > 1.0 ? 1 : 0, "probeGtIn")
            plot(1.0 <= 1.0 + 0.00000005 * 0.001 ? 1 : 0, "probeLeIn")
            plot(1.0 + 0.0000005 * 0.001 > 1.0 ? 1 : 0, "probeGtOut")
        `);
        expect(val(ctx, 'probeEqIn')).toBe(1);  // +5e-11 : égal
        expect(val(ctx, 'probeEqOut')).toBe(0); // +5e-10 : différent
        expect(val(ctx, 'probeGtIn')).toBe(0);  // +5e-11 : pas strictement supérieur
        expect(val(ctx, 'probeLeIn')).toBe(1);  // <= englobe l'égalité dans la tolérance
        expect(val(ctx, 'probeGtOut')).toBe(1); // +5e-10 : strictement supérieur
    });

    it('bornes — zéros et égalité exacte (tol = 0 aux ±0)', async () => {
        const ctx = await runPine(`
            //@version=6
            indicator("t")
            plot(0.0 == -0.0 ? 1 : 0, "zEq")
            plot(0.0 != 0.0 ? 1 : 0, "zNe")
            plot(0.0 <= 0.0 ? 1 : 0, "zLe")
            plot(0.0 >= 0.0 ? 1 : 0, "zGe")
            plot(0.0 < 0.0 ? 1 : 0, "zLt")
            plot(0.0 > 0.0 ? 1 : 0, "zGt")
        `);
        expect(val(ctx, 'zEq')).toBe(1);
        expect(val(ctx, 'zNe')).toBe(0);
        expect(val(ctx, 'zLe')).toBe(1);
        expect(val(ctx, 'zGe')).toBe(1);
        expect(val(ctx, 'zLt')).toBe(0);
        expect(val(ctx, 'zGt')).toBe(0);
    });
});