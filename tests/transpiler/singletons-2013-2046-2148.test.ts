// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Famille « singletons 2013/2046/2148 » (FAMILLES.md) — trois racines parser
// distinctes, fixées ensemble par le commit fork cee1244 (JOURNAL.md:189-194),
// toutes communes à l'amont 0.9.31 :
//   2013 — le rename `name→name_var` (variable shadowant une fonction)
//          s'appliquait à TOUT identifiant non-appel, y compris les racines
//          de membre de namespace (`position.top_right` → `position_var.
//          top_right` fantôme → ReferenceError) ; 'position' est désormais
//          dans NAMESPACE_COLLISION_NAMES et seules les déclarations réelles
//          sont renommées (`varShadowNames`).
//   2046 — après une expression-bloc (switch clos par DEDENT sans NEWLINE),
//          parsePostfix avalait le `[` de la statement suivante comme index ;
//          garde `isOnNewLine()` : un token de continuation en début de ligne
//          ouvre la statement suivante.
//   2148 — une variable déclarée AVANT une fonction du même nom échappait au
//          rename `_var` (enregistrement séquentiel) → collision JS à acorn ;
//          pré-scan des déclarations de fonctions.
//
// RED-PROOF : chaque assertion a été prouvée rouge sur le worktree parent
// `cee1244^` (2013 : ReferenceError `position_var` ; 2046 : crash transpile
// « Expected RBRACKET but got COMMA » ; 2148 : « Identifier already
// declared »).
//
// Contrat observable : une source Pine donnée transpile et plot la valeur
// attendue — jamais le texte du JS généré.

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

interface Candle {
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

function candles(closeValues: number[]): Candle[] {
    return closeValues.map((close, bar) => ({
        openTime: bar * 86_400_000,
        closeTime: bar * 86_400_000 + 86_399_999,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1000,
    }));
}

function lastPlotValue(context: { plots: Record<string, { data: Array<{ value: number | null }> }> }, key: string): number | null {
    const data = context.plots[key]?.data ?? [];
    const v = data[data.length - 1]?.value;
    return v == null || Number.isNaN(v) ? null : v;
}

describe('singletons 2013/2046/2148 — regroupements parser (commit cee1244)', () => {
    it('2013 : une fonction utilisateur nommée `position` ne casse pas la racine de membre de namespace `position.top_right`', async () => {
        const source = `
//@version=5
indicator("singletons 2013", overlay=true)
position() => close
ok = position.top_right == 'top_right' ? 1.0 : 0.0
plot(ok, "ok")`;
        // Avant cee1244 : `position.top_right` était renommé en
        // `position_var.top_right` → ReferenceError au run (ou crash
        // transpile) ; après : la racine de membre résout vers le namespace
        // injecté et vaut l'enum `'top_right'` (valeur TradingView, cf.
        // tests/namespaces/constants.test.ts).
        const engine = new PineTS(candles([100, 101, 102]), 'TEST', 'D');
        const context = await engine.run(source);
        expect(lastPlotValue(context, 'ok')).toBe(1.0);
    });

    it('2046 : un return tuple débutant par `[` APRÈS une expression switch n\'est pas avalé comme index', async () => {
        // Le switch est clos par un DEDENT sans NEWLINE ; la statement
        // suivante commence par un token de continuation `[` (tuple nu).
        // Avant cee1244 : parsePostfix l'avalait comme index de la boule
        // switch → « Expected RBRACKET but got COMMA » → crash transpile.
        const source = `
//@version=5
indicator("singletons 2046", overlay=true)
f() =>
    x = switch
        close > open => 10.0
        => 0.0
    [x, close[1]]
[out, prev] = f()
plot(out, "o")
plot(prev, "p")`;
        const upCandles = candles([100, 101, 102]).map((c) => ({
            ...c,
            open: c.close - 1,
            high: c.close,
            low: c.close - 2,
        }));
        const engine = new PineTS(upCandles, 'TEST', 'D');
        const context = await engine.run(source);
        // Dernière barre : close > open → x = 10.0 ; prev = close[1] = 101.
        expect(lastPlotValue(context, 'o')).toBe(10);
        expect(lastPlotValue(context, 'p')).toBe(101);
    });

    it('2148 : une variable déclarée AVANT la fonction du même nom ne déclenche plus la collision JS', async () => {
        const source = `
//@version=5
indicator("singletons 2148", overlay=true)
a = 1.0
a(x) => x + 1.0
plot(a(2.0), "p")`;
        // Avant cee1244 : la variable `a` (déclarée avant la fonction `a()`)
        // échappait au rename `_var` → « Identifier 'a' has already been
        // declared » côté acorn → crash transpile. Après : `a` → `a_var`,
        // appel `a(2.0)` → 3.0.
        const engine = new PineTS(candles([100, 101, 102]), 'TEST', 'D');
        const context = await engine.run(source);
        expect(lastPlotValue(context, 'p')).toBe(3.0);
    });
});