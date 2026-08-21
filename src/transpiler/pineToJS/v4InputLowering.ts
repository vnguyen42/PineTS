// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// V4 → V5 legacy `input(...)` lowering (Pine Script version 4).
//
// Pine v4 exposes the single auto-typed `input(defval, title, type, ...)`
// builtin; Pine v5 split it into typed namespace methods (`input.int`,
// `input.float`, `input.bool`, `input.string`, `input.symbol`,
// `input.timeframe`, `input.session`, `input.source`, `input.time`,
// `input.color`). Without this pass, a v4 `input(...)` call reaches the
// runtime as a bare call to the non-callable `Input` class instance:
//   - `type=input.integer` / `type=input.resolution` crash with
//     "input.integer is not a function" (no such v5 method),
//   - the other `type=` families survive by ACCIDENT: the transpiler
//     evaluates `input.session`/`input.float`/… as a ZERO-ARGUMENT CALL
//     (resolving to `undefined`) and passes that `undefined` back into the
//     options bag under the key `type` — a silent semantic hazard, not a
//     feature (the v4 type selector must be CONSUMED by the lowering, never
//     transported as a value).
//
// This pass runs on the pineToJS AST, right after lowerV4LegacyBuiltins,
// strictly gated on `//@version=4` (see pineToJS.index.ts) — v5/v6 and
// version-less sources never reach it. It rewrites the bare callee
// `input` into the mapped v5 namespace method and drops the `type=` selector
// (named `type` property, or the 3rd POSITIONAL argument — the v4 signature
// is `input(defval, title, type, ...)`, exercised by corpus scripts).
//
// Mapping table — DERIVED FROM THE CORPUS (190 real v4 sources, DB
// TradeSearcher read-only, same selection as the /tmp/v4-probe scan).
// Counts = calls / distinct scripts (call position, token-level analysis):
//
//   type=input.integer  → input.int        419/74
//   type=input.bool     → input.bool       293/58
//   type=input.float    → input.float      190/65
//   type=input.symbol   → input.symbol      84/5
//   type=input.source   → input.source      47/32
//   type=input.string   → input.string      42/13
//   type=input.time     → input.time        28/15
//   type=input.resolution → input.timeframe 13/13
//   type=input.session  → input.session      7/5
//   type=input.color    → input.color        5/4
//   SANS type=          → inférence v4 par le TYPE LEXICAL du defval
//     (même discipline que le fix RSI V4-1 : littéral int sans ./e → int ;
//     float → float ; bool → bool ; string → string — y compris les
//     littéraux '#RRGGBB(AA)', qui sont des STRINGS en v4, jamais color ;
//     identifiant source (close, hl2, hlc3…) → source ; const résolvable
//     → type de sa valeur ; sinon → input.any générique — le runtime du
//     fork l'expose (methods/any.ts) et résout le defval à l'identique) :
//     no-type/int 1042/160, no-type/bool 249/73, no-type/string 160/57,
//     no-type/float 141/59, no-type/source 69/48. Le fallback générique
//     input.any ne couvre que 2 appels RÉELS : 1764 (size.normal) et 1767
//     (alert.freq_once_per_bar_close).
//
// Args nommés v4 conservés : defval, title, minval, maxval, step, options,
// tooltip, inline, group, confirm. Le RUNTIME du fork (parseInputOptions,
// src/namespaces/input/utils.ts) les accepte tous via ses signatures 1-5
// (title/tooltip/inline/group/confirm/display et options/minval/maxval/step)
// mais ne les utilise que pour la résolution override→defval : minval/maxval/
// step/options n'ont AUCUN effet numérique (pas de clamp runtime) — ils sont
// transmis quand même (fidèle au guide de migration v4→v5, et inoffensif :
// parseArgsForPineParams ignore les clés du bag sans validation de signature).
// L'arg `type` est CONSOMMÉ : jamais émis dans le code compilé.
//
// Shadowing : une variable OU fonction utilisateur nommée `input` désactive
// le mapping (même mécanisme que V4-1 : collectUserVariables/
// collectUserFunctions).
//
// Cas non résolvable : `type=input.<fn>` dont le fn n'existe pas dans le
// runtime du fork → erreur de transpilation EXPLICITE (pas de valeur
// inventée, pas de pass-through silencieux). Defval non résolvable
// statiquement → input.any (générique, supporté par le runtime).

import { CallExpression, Identifier, MemberExpression, ObjectExpression, Program } from './ast';

// v4 `type=` family name → v5 input method name (corpus-derived, see header).
const V4_INPUT_TYPE_MAP: Record<string, string> = {
    integer: 'int',
    float: 'float',
    bool: 'bool',
    string: 'string',
    symbol: 'symbol',
    resolution: 'timeframe',
    session: 'session',
    source: 'source',
    time: 'time',
    color: 'color',
};

// Builtin source-series names (v4 `input(close, ...)` defvals). Identical to
// the runtime's SOURCE_BUILTINS in src/namespaces/input/utils.ts plus the
// non-price builtins Pine accepts as input.source defaults.
const SOURCE_BUILTINS: Record<string, true> = {
    open: true,
    high: true,
    low: true,
    close: true,
    volume: true,
    hl2: true,
    hlc3: true,
    ohlc4: true,
    hlcc4: true,
    bar_index: true,
    time: true,
    time_close: true,
};

type InputType = string;

function isPineNode(value: unknown): value is { type: string } {
    return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}

function childField(node: { type: string }, key: string): unknown {
    return (node as unknown as Record<string, unknown>)[key];
}

function identifierName(node: unknown): string | null {
    if (!isPineNode(node) || node.type !== 'Identifier' || !('name' in node) || typeof node.name !== 'string') return null;
    return node.name;
}

/**
 * Collect user-declared functions AND variables so a script that shadows the
 * `input` builtin keeps its own binding (same mechanism as V4-1).
 */
function collectUserBindings(node: unknown, functions: Set<string>, variables: Set<string>): void {
    if (!isPineNode(node)) return;
    if (node.type === 'FunctionDeclaration' && 'id' in node) {
        const id = node.id;
        if (isPineNode(id) && id.type === 'Identifier' && 'name' in id && typeof id.name === 'string') {
            functions.add(id.name);
        }
        if ('params' in node && Array.isArray(node.params)) {
            for (const param of node.params) {
                const candidate = isPineNode(param) && param.type === 'AssignmentPattern' && 'left' in param ? param.left : param;
                const name = identifierName(candidate);
                if (name) variables.add(name);
            }
        }
    }
    if (node.type === 'VariableDeclarator' && 'id' in node) {
        const name = identifierName(node.id);
        if (name) variables.add(name);
    }
    if ((node.type === 'AssignmentExpression' || node.type === 'ReassignmentExpression') && 'left' in node) {
        const name = identifierName(node.left);
        if (name) variables.add(name);
    }
    for (const key of Object.keys(node)) {
        if (key === 'type') continue;
        const val = childField(node, key);
        if (Array.isArray(val)) {
            for (const child of val) if (isPineNode(child)) collectUserBindings(child, functions, variables);
        } else if (isPineNode(val)) {
            collectUserBindings(val, functions, variables);
        }
    }
}

/**
 * Collect top-level const declarations (identifier → init AST) for the
 * defval-type inference. Pine v4 hoists declarations, so the table is built
 * over the WHOLE program before any rewrite; first declaration wins.
 */
function collectConstTable(node: unknown, out: Map<string, unknown>): void {
    if (!isPineNode(node)) return;
    if (node.type === 'VariableDeclarator' && 'id' in node && 'init' in node) {
        const name = identifierName(node.id);
        if (name && !out.has(name) && node.init != null) out.set(name, node.init);
    }
    for (const key of Object.keys(node)) {
        if (key === 'type') continue;
        const val = childField(node, key);
        if (Array.isArray(val)) {
            for (const child of val) if (isPineNode(child)) collectConstTable(child, out);
        } else if (isPineNode(val)) {
            collectConstTable(val, out);
        }
    }
}

function isIntegerLiteral(node: unknown): boolean {
    if (!isPineNode(node) || node.type !== 'Literal' || !('value' in node) || typeof node.value !== 'number') return false;
    if (!('raw' in node) || typeof node.raw !== 'string') return false;
    return !/[.eE]/.test(node.raw);
}

/**
 * Infer the v5 input method for a v4 defval node — lexical discipline: the
 * RAW literal text decides int vs float (V4-1's RSI rule), not the JS
 * number. Identifiers resolve through the const table (recursively); a
 * source builtin is a `source` input; anything else falls back to the
 * generic `input.any` (runtime-supported).
 */
function inferDefvalType(node: unknown, constTable: ReadonlyMap<string, unknown>, seen: Set<string> = new Set()): InputType {
    if (!isPineNode(node)) return 'any';
    if (node.type === 'Literal' && 'value' in node) {
        if (typeof node.value === 'number') return isIntegerLiteral(node) ? 'int' : 'float';
        if (typeof node.value === 'boolean') return 'bool';
        // v4 auto-detection : TOUT littéral chaîne (y compris '#RRGGBB(AA)')
        // est un input STRING — le type color n'existe qu'avec
        // type=input.color explicite (guide de migration v4→v5).
        if (typeof node.value === 'string') return 'string';
        return 'any';
    }
    if (node.type === 'Identifier') {
        const name = identifierName(node);
        if (!name) return 'any';
        if (name in SOURCE_BUILTINS) return 'source';
        if (constTable.has(name) && !seen.has(name)) {
            seen.add(name);
            const resolved = inferDefvalType(constTable.get(name), constTable, seen);
            seen.delete(name);
            return resolved;
        }
        return 'any';
    }
    if (node.type === 'UnaryExpression' && 'operator' in node && node.operator === '-' && 'argument' in node) {
        return inferDefvalType(node.argument, constTable, seen);
    }
    if (node.type === 'MemberExpression' && 'object' in node && 'property' in node) {
        // `color.black`, `color.yellow`… — color input. Other namespace enums
        // (`size.normal`, `alert.freq_*`, …) are string-typed in this runtime
        // but deliberately NOT claimed here: input.any resolves them identically.
        if (identifierName(node.object) === 'color') return 'color';
        return 'any';
    }
    if (node.type === 'CallExpression' && 'callee' in node) {
        const callee = node.callee;
        if (isPineNode(callee) && callee.type === 'MemberExpression') {
            const member = callee as MemberExpression;
            const fn = identifierName(member.property);
            if (identifierName(member.object) === 'color' && (fn === 'new' || fn === 'rgb')) return 'color';
            if (identifierName(member.object) === 'timestamp') return 'time';
        }
        return 'any';
    }
    return 'any';
}

/**
 * Extract the v4 type selector from an `input(...)` call:
 *   1. named `type` property of the options bag (MemberExpression input.<fn>);
 *   2. 3rd positional argument (v4 signature input(defval, title, type, …)),
 *      only when it is an `input.<fn>` member expression;
 *   3. absent → defval-lexical inference.
 * The call is MUTATED: the named `type` property / positional type arg is
 * removed (consumed), and the bag/positional lists returned for the callee
 * rewrite. An unknown `type=input.<fn>` raises an explicit transpile error.
 */
function decodeInputCall(call: CallExpression, constTable: ReadonlyMap<string, unknown>): { fn: string } {
    const args = (call.arguments ?? []) as unknown[];
    const bagIndex = args.findIndex((arg) => isPineNode(arg) && arg.type === 'ObjectExpression');
    const bag = bagIndex >= 0 ? (args[bagIndex] as unknown as ObjectExpression) : null;
    const positionals = bagIndex >= 0 ? args.slice(0, bagIndex) : args.slice();

    // 1. named `type` in the bag — consumed here.
    if (bag) {
        const properties = (bag.properties ?? []) as unknown[];
        for (let p = 0; p < properties.length; p++) {
            const property = properties[p];
            if (!isPineNode(property) || property.type !== 'Property' || !('key' in property) || !('value' in property)) continue;
            if (identifierName(property.key) !== 'type') continue;
            const fn = inputTypeMemberName(property.value);
            if (fn === null) {
                throw new Error(`v4 input(): type= doit être une famille input.* (reçu une valeur non input.*) — transpilation refusée plutôt qu'une valeur inventée`);
            }
            properties.splice(p, 1);
            // Un bag vidé de sa seule propriété type= ne transporte plus rien :
            // le retirer des arguments (sinon il arrive comme options vide au runtime).
            if (properties.length === 0) {
                const args = (call.arguments ?? []) as unknown[];
                args.splice(bagIndex, 1);
                call.arguments = args;
            }
            return { fn };
        }
    }

    // 2. 3rd positional type (v4 input(defval, title, type, …)) — consumed.
    if (positionals.length >= 3) {
        const fn = inputTypeMemberName(positionals[2]);
        if (fn !== null) {
            positionals.splice(2, 1);
            if (bagIndex >= 0) {
                call.arguments = [...positionals, bag];
            } else {
                call.arguments = positionals;
            }
            return { fn };
        }
    }

    // 3. No type selector → v4 auto-detection from the defval (named `defval`
    //    in the bag, sinon premier positionnel).
    const bagDefval = bag ? bagPropertyValue(bag, 'defval') : null;
    const defval = bagDefval ?? positionals[0] ?? null;
    return { fn: inferDefvalType(defval, constTable) };
}

/**
 * A value node used as the type selector must be `input.<family>` (member
 * expression on the input namespace). Returns the mapped v5 method name, or
 * null when the node is not an input.* member. Throws when it IS an input.*
 * member whose family the runtime does not implement (explicit error, never
 * a silent pass-through).
 */
function inputTypeMemberName(node: unknown): string | null {
    if (!isPineNode(node) || node.type !== 'MemberExpression') return null;
    const member = node as MemberExpression;
    if (identifierName(member.object) !== 'input') return null;
    const family = identifierName(member.property);
    if (family === null) return null;
    const mapped = V4_INPUT_TYPE_MAP[family];
    if (mapped === undefined) {
        throw new Error(
            `v4 input(): type=input.${family} n'a pas d'équivalent dans le runtime PineTS (familles supportées: ${Object.keys(V4_INPUT_TYPE_MAP).join(', ')})`
        );
    }
    return mapped;
}

function bagPropertyValue(bag: ObjectExpression, name: string): unknown {
    for (const property of bag.properties ?? []) {
        if (!isPineNode(property) || property.type !== 'Property' || !('key' in property) || !('value' in property)) continue;
        if (identifierName(property.key) === name) return property.value;
    }
    return null;
}

/**
 * Lower v4 `input(...)` calls to their v5 namespace methods. In-place AST
 * rewrite, call position only, user-shadowing respected.
 */
export function lowerV4InputCalls(ast: Program): void {
    const userFunctions = new Set<string>();
    const userVariables = new Set<string>();
    const constTable = new Map<string, unknown>();
    collectUserBindings(ast, userFunctions, userVariables);
    collectConstTable(ast, constTable);

    const rewrite = (node: unknown): void => {
        if (!isPineNode(node)) return;
        if (node.type === 'CallExpression') {
            const call = node as CallExpression;
            const callee = call.callee;
            if (isPineNode(callee) && callee.type === 'Identifier' && identifierName(callee) === 'input') {
                if (!userFunctions.has('input') && !userVariables.has('input')) {
                    const { fn } = decodeInputCall(call, constTable);
                    call.callee = new MemberExpression(new Identifier('input'), new Identifier(fn), false);
                }
            }
        }
        for (const key of Object.keys(node)) {
            if (key === 'type') continue;
            const val = childField(node, key);
            if (Array.isArray(val)) {
                for (const child of val) if (isPineNode(child)) rewrite(child);
            } else if (isPineNode(val)) {
                rewrite(val);
            }
        }
    };
    rewrite(ast);
}

// Exported for tests/audits (v4 family → v5 input method).
export const V4_INPUT_TYPE_MAP_READONLY: Readonly<Record<string, string>> = V4_INPUT_TYPE_MAP;
