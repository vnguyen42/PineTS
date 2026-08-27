// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// V4 comma statement sequence (VIN-42 iteration 3) — Pine v4 allows a
// statement sequence spanning a var declaration: `var x = label(na), stmt2,
// stmt3` (corpus 1547 L300 / 1633 L307 — the f_printscr pattern, which failed
// with "Unexpected token COMMA ','" before the fix). parseVarDeclaration only
// absorbs `, var y = ...` multi-declarations; a trailing comma with a NON-var
// continuation now falls through into the shared statement-sequence loop.
// Convention: same as the other v4-*.test.ts transpiler suites.
// Famille (condition 2) : `séquences comma multi-lignes (1816)` — fix fork
// 42689cf, ids révélateurs 1816/2270 : la séquence à cheval sur plusieurs
// lignes (chaque statement du f_printscr est sur sa propre ligne) ne plantait
// plus sur `peek().line === startLine`.

import { describe, it, expect } from 'vitest';
import { pineToJS } from '../../src/transpiler/pineToJS/pineToJS.index';

const v4 = (body: string) => `//@version=4\n${body}`;

function codeOf(body: string): string {
    const result = pineToJS(v4(body));
    if (!result.success) throw new Error(result.error);
    return result.code;
}

describe('V4 comma statement sequence (var declaration fall-through)', () => {
    it('parses the corpus 1547/1633 f_printscr form: `var _lblscr = label(na), <suite>`', () => {
        const code = codeOf(`
posX = 5
posY = 3
col = color.red
showscr = true
f_colorscr(_valscr) =>
    _valscr ? #00000000 : na
f_printscr(_txtscr) =>
    var _lblscr = label(na),
    label.delete(_lblscr),
    _lblscr := label.new(
        time + (time - time[1]) * posX,
        ohlc4[posY],
        _txtscr,
        xloc.bar_time,
        yloc.price,
        f_colorscr(showscr),
        textcolor = showscr ? col : na,
        size = size.normal,
        style = label.style_label_center
    )
f_printscr('hello')
plot(close)`);
        // The var declaration is emitted first, then the continuation items
        // as their own statements — no COMMA survives into the JS.
        expect(code).toContain('var _lblscr = label(na);');
        expect(code).toContain('label.delete(_lblscr);');
        expect(code).toContain('label.new(');
        expect(code).not.toContain('label(na),');
        expect(code).not.toContain(',\n');
        expect(() => new Function(code)).not.toThrow();
    });

    it('keeps the v4 multi-var declaration form intact (`var a = 1, b = 2, c = 3`)', () => {
        // A comma here is a multi-DECLARATOR, not a sequence continuation:
        // parseVarDeclaration must keep absorbing it (byte-identical to the
        // pre-fix output).
        const code = codeOf('var a = 1, b = 2, c = 3\nplot(a + b + c)');
        expect(code).toContain('var a = 1;');
        expect(code).toContain('let b = 2;');
        expect(code).toContain('let c = 3;');
        expect(code).not.toContain('let a = 1;');
        expect(() => new Function(code)).not.toThrow();
    });

    it('keeps the top-level comma sequence form intact (`a = 1, b = 2, c = 3`)', () => {
        // Top-level statement sequences were already handled by the shared
        // sequence loop; the fix must not disturb them (byte-identical).
        const code = codeOf('a = 1, b = 2, c = 3\nplot(a)');
        expect(code).toContain('let a = 1;');
        expect(code).toContain('let b = 2;');
        expect(code).toContain('let c = 3;');
        expect(() => new Function(code)).not.toThrow();
    });

    it('varip declarations get the same comma-sequence fall-through', () => {
        const code = codeOf(`
f() =>
    varip _lblscr = label(na),
    label.delete(_lblscr),
    _lblscr := label.new(time, ohlc4[3], 'x')
f('hello')
plot(close)`);
        expect(code).toContain('var _lblscr = label(na);');
        expect(code).toContain('label.delete(_lblscr);');
        expect(code).not.toContain('label(na),');
        expect(() => new Function(code)).not.toThrow();
    });

    it('v5 with the same var-comma sequence FAILS as before (Unexpected token COMMA)', () => {
        // The fall-through is STRICTLY gated on version 4: a v5 source must
        // keep its pre-fix rejection, byte-identical to HEAD pristine.
        const result = pineToJS(`//@version=5
f() =>
    var x = label(na), label.delete(x)
f('hello')
plot(close)`);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Unexpected token COMMA ',' at 3:23/);
    });
});
