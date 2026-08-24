// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// V4 → V5 legacy builtin lowering (Pine Script version 4).
//
// Pine v4 exposes a flat builtin namespace: `rsi(...)`, `sma(...)`,
// `tostring(...)`, `security(...)`… Pine v5 moved these into namespaces
// (`ta.rsi`, `math.abs`, `str.tostring`, `request.security`…). This pass
// rewrites bare IDENTIFIER callees in CALL POSITION into their v5 namespace
// equivalents, on the pineToJS AST, BEFORE codegen — so every downstream
// pass (context-bound renaming, implicit pine destructuring, callsite-ID
// injection) treats them exactly like a v5 namespaced call.
//
// Scope discipline:
//   - Runs for explicit `//@version=4` and version-less sources that reach
//     `pineToJS` through the forced-v5 retry path. v5/v6 sources keep their
//     existing byte-identical output.
//   - Call-position only. A v4-legal `rsi = rsi(close, 14)` keeps its
//     separate function/variable namespaces, so the callee must resolve the
//     builtin, not the variable (that is the "e is not a function" family
//     of the corpus probe: the main transpiler used to bind the bare callee
//     to the same-named user variable).
//   - User FUNCTION shadowing: `myFn(a, b) => …` then `myFn(...)` resolves
//     the user function — bare calls to a user-function name are left alone.
//     (Pine v4 has no user-variable shadowing of builtin calls.)
//
// Mapping table — DERIVED FROM THE CORPUS (190 real v4 sources, DB
// TradeSearcher read-only, same selection as the /tmp/v4-probe scan).
// Counts = calls / distinct scripts (call position, token-level analysis):
//
//   ta.*          : sma 283/91, ema 374/82, wma 105/29, vwma 13/12, rma 47/20,
//                   cci 7/7, roc 2/2, linreg 32/18, stoch 22/17, change 72/30,
//                   cum 7/5, highest 84/48, lowest 85/48, crossover 182/88,
//                   crossunder 149/72, cross 36/15, rsi 54/43, atr 95/51,
//                   barssince 82/27, valuewhen 161/22, stdev 61/39, hma 21/8,
//                   pivothigh 16/7, pivotlow 16/7, tr 10/6, macd 6/6, sar 6/5,
//                   mom 6/4, dmi 4/4, supertrend 4/2, dev 2/2, falling 2/2,
//                   rising 2/2, alma 2/2, percentrank 2/1, mfi 1/1, wpr 1/1,
//                   bb 1/1
//   math.*        : max 175/71, min 157/65, abs 103/47, round 62/30, sum 51/24,
//                   sqrt 32/20, avg 33/19, floor 28/16, pow 46/14, log 16/9,
//                   ceil 9/8, exp 7/6, sign 6/5, cos 3/2, round_to_mintick 4/1,
//                   asin 2/1, log10 2/1, acos 1/1, atan 1/1
//
// Value-position builtins: tr 26/20, obv 4/2, vwap 3/2.
//   str.*         : tostring 337/25, tonumber 1/1
//   request.*     : security 241/41
//   ticker.*      : heikinashi 35/12
// Version-less retry path ONLY (absent from the explicit-v4 corpus counts,
// so they must not change versioned output): `swma` in call position,
// bare `tickerid`, and the bare color constants.
//   runtime iff   : iff 102/28 — NOT rewritten here. v4 `iff(cond, a, b)`
//                   evaluates BOTH branches; the runtime helper added to
//                   `context.pine.iff` (Core.iff) receives already-evaluated
//                   arguments and only picks one (with na propagation). The
//                   CONTEXT_PINE_VARS entry makes the implicit destructure
//                   emit `const { iff } = $.pine`, so bare `iff(...)` calls
//                   resolve to the helper like `nz`/`na` do.
// NOT mapped (engine target absent — left to crash with today's
// ReferenceError, per contract "ne pas inventer") :
//   renko 5/4 — v5 equivalent `ticker.renko` is not implemented in the
//   PineTS runtime.
//
// Arity notes (engine already accepts the v4 forms; no argument rewrite):
//   - ta.highest/ta.lowest/ta.change support the v4 single-argument forms
//     (`highest(len)` = `ta.highest(high, len)`, `change(src)` = length 1)
//     via the transpiler-injected callsite-ID swap in the runtime methods.
//   - math.max/min/avg are variadic; ta.pivothigh/pivotlow accept a missing
//     source; ta.tr takes an optional handle_na.
//
// [HYPOTHÈSE] v4 `iff` na-condition semantics: the TV v4 reference does not
// document the na case; the helper propagates na (matches the v5 ternary
// `cond ? a : b` behavior, which is the documented v4→v5 migration path for
// `iff`). Corpus usage (comparison conditions) does not exercise the na case.

import { CallExpression, Identifier, MemberExpression, Program, UnaryExpression } from './ast';

interface NamespaceTarget {
    ns: string;
    name: string;
}

// Legacy v4 flat builtin → v5 namespace member (corpus-derived, see header).
const LEGACY_CALL_TARGETS: Record<string, NamespaceTarget> = {
    // ta.* indicators / series functions
    sma: { ns: 'ta', name: 'sma' },
    ema: { ns: 'ta', name: 'ema' },
    wma: { ns: 'ta', name: 'wma' },
    vwma: { ns: 'ta', name: 'vwma' },
    rma: { ns: 'ta', name: 'rma' },
    cci: { ns: 'ta', name: 'cci' },
    roc: { ns: 'ta', name: 'roc' },
    linreg: { ns: 'ta', name: 'linreg' },
    stoch: { ns: 'ta', name: 'stoch' },
    change: { ns: 'ta', name: 'change' },
    cum: { ns: 'ta', name: 'cum' },
    highest: { ns: 'ta', name: 'highest' },
    lowest: { ns: 'ta', name: 'lowest' },
    crossover: { ns: 'ta', name: 'crossover' },
    crossunder: { ns: 'ta', name: 'crossunder' },
    cross: { ns: 'ta', name: 'cross' },
    rsi: { ns: 'ta', name: 'rsi' },
    atr: { ns: 'ta', name: 'atr' },
    barssince: { ns: 'ta', name: 'barssince' },
    valuewhen: { ns: 'ta', name: 'valuewhen' },
    stdev: { ns: 'ta', name: 'stdev' },
    hma: { ns: 'ta', name: 'hma' },
    pivothigh: { ns: 'ta', name: 'pivothigh' },
    pivotlow: { ns: 'ta', name: 'pivotlow' },
    tr: { ns: 'ta', name: 'tr' },
    macd: { ns: 'ta', name: 'macd' },
    sar: { ns: 'ta', name: 'sar' },
    mom: { ns: 'ta', name: 'mom' },
    dmi: { ns: 'ta', name: 'dmi' },
    supertrend: { ns: 'ta', name: 'supertrend' },
    dev: { ns: 'ta', name: 'dev' },
    falling: { ns: 'ta', name: 'falling' },
    rising: { ns: 'ta', name: 'rising' },
    alma: { ns: 'ta', name: 'alma' },
    percentrank: { ns: 'ta', name: 'percentrank' },
    mfi: { ns: 'ta', name: 'mfi' },
    wpr: { ns: 'ta', name: 'wpr' },
    bb: { ns: 'ta', name: 'bb' },
    // math.* scalar/rounding helpers
    max: { ns: 'math', name: 'max' },
    min: { ns: 'math', name: 'min' },
    abs: { ns: 'math', name: 'abs' },
    round: { ns: 'math', name: 'round' },
    sum: { ns: 'math', name: 'sum' },
    sqrt: { ns: 'math', name: 'sqrt' },
    avg: { ns: 'math', name: 'avg' },
    floor: { ns: 'math', name: 'floor' },
    pow: { ns: 'math', name: 'pow' },
    log: { ns: 'math', name: 'log' },
    ceil: { ns: 'math', name: 'ceil' },
    exp: { ns: 'math', name: 'exp' },
    sign: { ns: 'math', name: 'sign' },
    cos: { ns: 'math', name: 'cos' },
    asin: { ns: 'math', name: 'asin' },
    log10: { ns: 'math', name: 'log10' },
    acos: { ns: 'math', name: 'acos' },
    atan: { ns: 'math', name: 'atan' },
    round_to_mintick: { ns: 'math', name: 'round_to_mintick' },
    // str.* formatting
    tostring: { ns: 'str', name: 'tostring' },
    tonumber: { ns: 'str', name: 'tonumber' },
    // v4 natural-log alias exercised with a user variable of the same name.
    // Function and variable namespaces are separate in Pine v4.
    ln: { ns: 'math', name: 'log' },
    // request.* data requests
    // ticker.* chart-type modifiers
    heikinashi: { ns: 'ticker', name: 'heikinashi' },
    security: { ns: 'request', name: 'security' },
};
// V4 built-ins also used as bare values in this corpus. Callable values are
// lowered to zero/one-argument v5 calls only when no user variable declares
// the same name. Counts from the 190-source token scan: tr 26/20, obv 4/2,
// vwap 3/2. [HYPOTHÈSE] v4's bare `vwap` default source is hlc3 in the
// v4→v5 migration.
const LEGACY_VALUE_TARGETS: Record<string, NamespaceTarget> = {
    tr: { ns: 'ta', name: 'tr' },
    obv: { ns: 'ta', name: 'obv' },
    vwap: { ns: 'ta', name: 'vwap' },
};
// Builtins needed ONLY by the version-less forced-v5 retry path: `swma` is
// absent from the explicit-v4 corpus counts above, and bare `tickerid` is
// only exercised by header-less corpus scripts. They are deliberately
// separate from the explicit-v4 maps (which must stay byte-identical to the
// V4-1 baseline for versioned sources) — the `versionless` flag selects
// them, mirroring the color-constant separation below.
const VERSIONLESS_CALL_TARGETS: Record<string, NamespaceTarget> = {
    swma: { ns: 'ta', name: 'swma' },
};
// Bare color constants and `tickerid` are needed by the version-less retry
// path. They are deliberately separate from the explicit-v4 maps so
// versioned output stays byte-identical to the V4-1 baseline.
const VERSIONLESS_VALUE_MEMBER_TARGETS: Record<string, NamespaceTarget> = {
    aqua: { ns: 'color', name: 'aqua' },
    black: { ns: 'color', name: 'black' },
    blue: { ns: 'color', name: 'blue' },
    fuchsia: { ns: 'color', name: 'fuchsia' },
    gray: { ns: 'color', name: 'gray' },
    green: { ns: 'color', name: 'green' },
    lime: { ns: 'color', name: 'lime' },
    maroon: { ns: 'color', name: 'maroon' },
    navy: { ns: 'color', name: 'navy' },
    olive: { ns: 'color', name: 'olive' },
    orange: { ns: 'color', name: 'orange' },
    purple: { ns: 'color', name: 'purple' },
    red: { ns: 'color', name: 'red' },
    silver: { ns: 'color', name: 'silver' },
    teal: { ns: 'color', name: 'teal' },
    tickerid: { ns: 'syminfo', name: 'tickerid' },
    white: { ns: 'color', name: 'white' },
    yellow: { ns: 'color', name: 'yellow' },
};

// `tr` has a call-position target too; bare-value lowering supplies the
// v4 getter default (`handle_na=true`) by emitting `ta.tr()` with no args.


// Type guard: Pine AST nodes carry a discriminant `type` string.
function isPineNode(value: unknown): value is { type: string } {
    return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}

// Mutation helper for the same generic walker when it replaces a scalar
// child. The AST node classes expose untyped fields, so the cast is contained
// here rather than spread through the transformation.
function setChildField(node: { type: string }, key: string, value: unknown): void {
    (node as unknown as Record<string, unknown>)[key] = value;
}
// Child access for the generic walker — AST fields are declared `any` on the
// node classes, so the unchecked cast is contained to this single helper.
function childField(node: { type: string }, key: string): unknown {
    return (node as unknown as Record<string, unknown>)[key];
}

/**
 * Collect the names of user-declared functions (including inside nested
 * scopes). `method` declarations are excluded — they are not bare-callable
 * (their JS name is prefixed `$M_` and they are dispatched through a
 * receiver), so they cannot shadow a bare builtin call.
 */
function collectUserFunctions(node: unknown, out: Set<string>): void {
    if (!isPineNode(node)) return;
    if (node.type === 'FunctionDeclaration' && 'id' in node) {
        const id = node.id; // unknown — narrowed by `'id' in node`
        if (isPineNode(id) && id.type === 'Identifier' && (!('isMethod' in id) || id.isMethod !== true) && 'name' in id) {
            const name = id.name; // unknown — narrowed by `'name' in id`
            if (typeof name === 'string') out.add(name);
        }
    }
    for (const key of Object.keys(node)) {
        if (key === 'type') continue;
        const val = childField(node, key);
        if (Array.isArray(val)) {
            for (const child of val) {
                if (isPineNode(child)) collectUserFunctions(child, out);
            }
        } else if (isPineNode(val)) {
            collectUserFunctions(val, out);
        }
    }
}
/**
 * Collect user variable bindings so a bare value builtin is not rewritten
 * when a script deliberately shadows that name.
 */
function collectUserVariables(node: unknown, out: Set<string>): void {
    if (!isPineNode(node)) return;
    if (node.type === 'VariableDeclarator' && 'id' in node) {
        const id = node.id;
        if (isPineNode(id) && id.type === 'Identifier' && 'name' in id && typeof id.name === 'string') out.add(id.name);
    }
    if ((node.type === 'AssignmentExpression' || node.type === 'ReassignmentExpression') && 'left' in node) {
        const left = node.left;
        if (isPineNode(left) && left.type === 'Identifier' && 'name' in left && typeof left.name === 'string') out.add(left.name);
    }
    if (node.type === 'FunctionDeclaration' && 'params' in node && Array.isArray(node.params)) {
        for (const param of node.params) {
            const candidate = isPineNode(param) && param.type === 'AssignmentPattern' && 'left' in param ? param.left : param;
            if (isPineNode(candidate) && candidate.type === 'Identifier' && 'name' in candidate && typeof candidate.name === 'string') {
                out.add(candidate.name);
            }
        }
    }
    for (const key of Object.keys(node)) {
        if (key === 'type') continue;
        const val = childField(node, key);
        if (Array.isArray(val)) {
            for (const child of val) if (isPineNode(child)) collectUserVariables(child, out);
        } else if (isPineNode(val)) {
            collectUserVariables(val, out);
        }
    }
}
type RsiArgKind = 'simple-int' | 'series' | 'unknown';

const SERIES_IDENTIFIERS = new Set([
    'open',
    'high',
    'low',
    'close',
    'volume',
    'hl2',
    'hlc3',
    'ohlc4',
    'hlcc4',
    'bar_index',
    'time',
    'time_close',
]);

const SERIES_CALL_NAMES = new Set(
    Object.entries(LEGACY_CALL_TARGETS)
        .filter(([, target]) => target.ns === 'ta')
        .map(([name]) => name)
);

function identifierName(node: unknown): string | null {
    if (!isPineNode(node) || node.type !== 'Identifier' || !('name' in node) || typeof node.name !== 'string') return null;
    return node.name;
}

function isNumericLiteral(node: unknown): boolean {
    return isPineNode(node) && node.type === 'Literal' && 'value' in node && typeof node.value === 'number';
}

function isIntegerLiteral(node: unknown): boolean {
    if (!isPineNode(node) || node.type !== 'Literal' || !('value' in node) || typeof node.value !== 'number') return false;
    if (!('raw' in node) || typeof node.raw !== 'string') return false;
    return !/[.eE]/.test(node.raw);
}

function inputDefault(node: unknown): unknown {
    if (!isPineNode(node) || node.type !== 'CallExpression') return null;
    const call = node as CallExpression;
    if (identifierName(call.callee) !== 'input') return null;
    for (const arg of call.arguments ?? []) {
        if (isPineNode(arg) && arg.type === 'ObjectExpression' && 'properties' in arg && Array.isArray(arg.properties)) {
            for (const property of arg.properties) {
                if (!isPineNode(property) || property.type !== 'Property' || !('key' in property) || !('value' in property)) continue;
                if (identifierName(property.key) === 'defval') return property.value;
            }
        } else if (isNumericLiteral(arg)) {
            return arg;
        }
    }
    return null;
}

function mergeRsiKind(previous: RsiArgKind | undefined, next: RsiArgKind): RsiArgKind {
    if (!previous) return next;
    if (previous === next) return previous;
    return 'unknown';
}
function classifyRsiExpression(node: unknown, bindings: ReadonlyMap<string, RsiArgKind>): RsiArgKind {
    if (!isPineNode(node)) return 'unknown';
    if (isIntegerLiteral(node)) return 'simple-int';
    if (isNumericLiteral(node)) return 'series';
    if (node.type === 'Identifier') {
        const name = identifierName(node);
        if (name && SERIES_IDENTIFIERS.has(name)) return 'series';
        return name ? bindings.get(name) ?? 'unknown' : 'unknown';
    }
    if (node.type === 'MemberExpression' && 'object' in node) {
        const objectKind = classifyRsiExpression(node.object, bindings);
        return objectKind === 'series' ? 'series' : 'unknown';
    }
    if ((node.type === 'UnaryExpression' || node.type === 'UpdateExpression') && 'argument' in node) {
        return classifyRsiExpression(node.argument, bindings);
    }
    if ((node.type === 'BinaryExpression' || node.type === 'LogicalExpression') && 'left' in node && 'right' in node) {
        const left = classifyRsiExpression(node.left, bindings);
        const right = classifyRsiExpression(node.right, bindings);
        return left === 'series' || right === 'series' ? 'series' : 'unknown';
    }
    if (node.type === 'ConditionalExpression' && 'consequent' in node && 'alternate' in node) {
        const consequent = classifyRsiExpression(node.consequent, bindings);
        const alternate = classifyRsiExpression(node.alternate, bindings);
        return consequent === 'series' || alternate === 'series' ? 'series' : 'unknown';
    }
    if (node.type === 'CallExpression' && 'callee' in node) {
        const call = node as CallExpression;
        const inputValue = inputDefault(call);
        if (inputValue !== null) return isIntegerLiteral(inputValue) ? 'simple-int' : isNumericLiteral(inputValue) ? 'series' : 'unknown';
        const method = identifierName(call.callee) ?? (isPineNode(call.callee) && call.callee.type === 'MemberExpression' && 'property' in call.callee ? identifierName(call.callee.property) : null);
        const targetIsSeries = method !== null && SERIES_CALL_NAMES.has(method);
        if (targetIsSeries) return 'series';
        const argsAreSeries = (call.arguments ?? []).some((arg: unknown) => classifyRsiExpression(arg, bindings) === 'series');
        return argsAreSeries ? 'series' : 'unknown';
    }
    return 'unknown';
}

function collectRsiBindings(node: unknown, bindings: Map<string, RsiArgKind>): void {
    if (!isPineNode(node)) return;
    if (node.type === 'VariableDeclarator' && 'id' in node && 'init' in node) {
        const name = identifierName(node.id);
        if (name) bindings.set(name, mergeRsiKind(bindings.get(name), classifyRsiExpression(node.init, bindings)));
    }
    if ((node.type === 'AssignmentExpression' || node.type === 'ReassignmentExpression') && 'left' in node && 'right' in node) {
        const name = identifierName(node.left);
        if (name) bindings.set(name, mergeRsiKind(bindings.get(name), classifyRsiExpression(node.right, bindings)));
    }
    for (const key of Object.keys(node)) {
        if (key === 'type') continue;
        const val = childField(node, key);
        if (Array.isArray(val)) {
            for (const child of val) if (isPineNode(child)) collectRsiBindings(child, bindings);
        } else if (isPineNode(val)) {
            collectRsiBindings(val, bindings);
        }
    }
}
function collectFunctionParams(node: unknown, out: Map<string, string[]>): void {
    if (!isPineNode(node)) return;
    if (node.type === 'FunctionDeclaration' && 'id' in node && 'params' in node && Array.isArray(node.params)) {
        const name = identifierName(node.id);
        if (name) {
            const params = node.params.map((param: unknown) => {
                const candidate = isPineNode(param) && param.type === 'AssignmentPattern' && 'left' in param ? param.left : param;
                return identifierName(candidate);
            });
            out.set(name, params.filter((param): param is string => param !== null));
        }
    }
    for (const key of Object.keys(node)) {
        if (key === 'type') continue;
        const val = childField(node, key);
        if (Array.isArray(val)) {
            for (const child of val) if (isPineNode(child)) collectFunctionParams(child, out);
        } else if (isPineNode(val)) {
            collectFunctionParams(val, out);
        }
    }
}

function inferFunctionParamKinds(node: unknown, functionParams: ReadonlyMap<string, string[]>, bindings: Map<string, RsiArgKind>): void {
    if (!isPineNode(node)) return;
    if (node.type === 'CallExpression' && 'callee' in node) {
        const call = node as CallExpression;
        const name = identifierName(call.callee);
        const params = name ? functionParams.get(name) : undefined;
        if (params) {
            for (let index = 0; index < params.length; index++) {
                const argKind = classifyRsiExpression(call.arguments?.[index], bindings);
                bindings.set(params[index], mergeRsiKind(bindings.get(params[index]), argKind));
            }
        }
    }
    for (const key of Object.keys(node)) {
        if (key === 'type') continue;
        const val = childField(node, key);
        if (Array.isArray(val)) {
            for (const child of val) if (isPineNode(child)) inferFunctionParamKinds(child, functionParams, bindings);
        } else if (isPineNode(val)) {
            inferFunctionParamKinds(val, functionParams, bindings);
        }
    }
}



/**
 * v4's `security(..., resolution=...)` named parameter was renamed to
 * `timeframe` in v5. The parser stores named arguments in an ObjectExpression,
 * so consume this compatibility spelling here rather than widening the v5
 * request.security runtime signature.
 */
function rewriteV4SecurityResolution(call: CallExpression): void {
    const bag = [...(call.arguments ?? [])].reverse().find((arg: unknown) => {
        if (!isPineNode(arg) || arg.type !== 'ObjectExpression' || !('properties' in arg)) return false;
        return Array.isArray(arg.properties);
    });
    if (!bag || !('properties' in bag) || !Array.isArray(bag.properties)) return;
    for (const property of bag.properties) {
        if (!isPineNode(property) || property.type !== 'Property' || !('key' in property)) continue;
        if (identifierName(property.key) === 'resolution') {
            property.key = new Identifier('timeframe');
        }
    }
}

function deleteChildField(node: { type: string }, key: string): void {
    const fields = node as unknown as Record<string, unknown>;
    delete fields[key];
}

/**
 * Pine v4's calculation-only `offset(series, n)` is the history operator
 * equivalent `series[n]` in v5. Lower it before code generation so the
 * existing history-index machinery owns dynamic index scoping.
 */
function rewriteV4OffsetCall(call: CallExpression): void {
    const args = call.arguments ?? [];
    if (args.length !== 2) return;
    const replacement = new MemberExpression(args[0], args[1], true);
    Object.assign(call, replacement);
    deleteChildField(call, 'callee');
    deleteChildField(call, 'arguments');
}

/**
 * Rewrite bare legacy builtin callees in call position into namespaced
 * member calls, skipping user-function-shadowed names. `versionless`
 * additionally selects the retry-only targets (swma).
 */
function rewriteLegacyCalls(node: unknown, userFunctions: ReadonlySet<string>, rsiBindings: ReadonlyMap<string, RsiArgKind>, versionless = false): void {
    if (!isPineNode(node)) return;

    if (node.type === 'CallExpression') {
        const call = node as CallExpression;
        const callee = call.callee;
        if (callee !== null && typeof callee === 'object' && 'type' in callee && callee.type === 'Identifier' && 'name' in callee) {
            const name = callee.name;
            if (typeof name === 'string' && !userFunctions.has(name)) {
                if (name === 'rsi') {
                    const kind = classifyRsiExpression(call.arguments?.[1], rsiBindings);
                    if (kind === 'simple-int') {
                        call.callee = new MemberExpression(new Identifier('ta'), new Identifier('rsi'), false);
                    } else if (kind === 'series') {
                        call.callee = new Identifier('v4_rsi');
                    } else {
                        throw new Error('v4 rsi(series, series) overload: cannot statically resolve second argument');
                    }
                } else if (name === 'security') {
                    rewriteV4SecurityResolution(call);
                    call.callee = new MemberExpression(new Identifier('request'), new Identifier('security'), false);
                } else if (name === 'offset') {
                    rewriteV4OffsetCall(call);
                } else {
                    const target = LEGACY_CALL_TARGETS[name] ?? (versionless ? VERSIONLESS_CALL_TARGETS[name] : undefined);
                    if (target) {
                        call.callee = new MemberExpression(new Identifier(target.ns), new Identifier(target.name), false);
                    }
                }
            }
        }
    }

    for (const key of Object.keys(node)) {
        if (key === 'type') continue;
        const val = childField(node, key);
        if (Array.isArray(val)) {
            for (const child of val) {
                if (isPineNode(child)) rewriteLegacyCalls(child, userFunctions, rsiBindings, versionless);
            }
        } else if (isPineNode(val)) {
            rewriteLegacyCalls(val, userFunctions, rsiBindings, versionless);
        }
    }
}

/**
 * Pine v4 treats a comparison against the bare `na` value as an absence test.
 * Keep this rewrite in the v4-only pass: v5/v6 preserve their existing
 * comparison/`na` propagation behavior.
 *
 * `na == na` is intentionally left untouched. It is outside the corpus and
 * without a checked v4 oracle we must not assert a semantic result for the
 * literal-on-both-sides case.
 */
function rewriteV4NaComparisons(node: unknown, userVariables: ReadonlySet<string>): void {
    if (!isPineNode(node)) return;

    if (
        node.type === 'BinaryExpression' &&
        'operator' in node &&
        (node.operator === '==' || node.operator === '!=') &&
        'left' in node &&
        'right' in node
    ) {
        const leftIsNa = isBuiltinNa(node.left, userVariables);
        const rightIsNa = isBuiltinNa(node.right, userVariables);
        if (leftIsNa !== rightIsNa) {
            const operand = leftIsNa ? node.right : node.left;
            const naCall = new CallExpression(new Identifier('na'), [operand]);
            const replacement = node.operator === '!=' ? new UnaryExpression('!', naCall) : naCall;
            Object.assign(node, replacement);
            deleteChildField(node, 'left');
            deleteChildField(node, 'right');
            if (replacement.type === 'CallExpression') deleteChildField(node, 'operator');
        }
    }

    for (const key of Object.keys(node)) {
        if (key === 'type') continue;
        const val = childField(node, key);
        if (Array.isArray(val)) {
            for (const child of val) {
                if (isPineNode(child)) rewriteV4NaComparisons(child, userVariables);
            }
        } else if (isPineNode(val)) {
            rewriteV4NaComparisons(val, userVariables);
        }
    }
}

function isBuiltinNa(node: unknown, userVariables: ReadonlySet<string>): boolean {
    return (
        isPineNode(node) &&
        node.type === 'Identifier' &&
        'name' in node &&
        node.name === 'na' &&
        !userVariables.has('na')
    );
}

function canRewriteValue(parent: unknown, key: string | number): boolean {
    if (!isPineNode(parent)) return typeof key === 'number';
    if (parent.type === 'CallExpression' && key === 'callee') return false;
    if (parent.type === 'VariableDeclarator' && key === 'id') return false;
    if ((parent.type === 'AssignmentExpression' || parent.type === 'ReassignmentExpression') && key === 'left') return false;
    if (parent.type === 'MemberExpression' && key === 'property' && (!('computed' in parent) || parent.computed !== true)) return false;
    if (parent.type === 'Property' && key === 'key' && (!('computed' in parent) || parent.computed !== true)) return false;
    return true;
}

function replaceChild(parent: unknown, key: string | number, replacement: unknown): void {
    if (Array.isArray(parent) && typeof key === 'number') {
        parent[key] = replacement;
    } else if (isPineNode(parent) && typeof key === 'string') {
        setChildField(parent, key, replacement);
    }
}

/**
 * Lower v4 built-ins used as values (`tr`, `obv`, `vwap`; plus `tickerid`
 * and bare color constants on the version-less retry path). The runtime
 * exposes callable forms for the first three and namespace members for
 * `tickerid`/colors; preserve user variable shadowing and
 * declaration/property positions in all cases.
 */
function rewriteLegacyValues(
    node: unknown,
    userVariables: ReadonlySet<string>,
    parent: unknown = null,
    key: string | number = '',
    versionless = false,
): void {
    if (!isPineNode(node)) return;

    if (node.type === 'Identifier' && 'name' in node && typeof node.name === 'string' && canRewriteValue(parent, key)) {
        const name = node.name;
        if (!userVariables.has(name)) {
            const callTarget = LEGACY_VALUE_TARGETS[name];
            const memberTarget = versionless ? VERSIONLESS_VALUE_MEMBER_TARGETS[name] : undefined;
            if (callTarget) {
                const args = name === 'vwap' ? [new Identifier('hlc3')] : [];
                replaceChild(parent, key, new CallExpression(new MemberExpression(new Identifier(callTarget.ns), new Identifier(callTarget.name), false), args));
                return;
            }
            if (memberTarget) {
                replaceChild(parent, key, new MemberExpression(new Identifier(memberTarget.ns), new Identifier(memberTarget.name), false));
                return;
            }
        }
    }

    for (const childKey of Object.keys(node)) {
        if (childKey === 'type') continue;
        if (node.type === 'FunctionDeclaration' && (childKey === 'id' || childKey === 'params')) continue;
        if (node.type === 'VariableDeclarator' && childKey === 'id') continue;
        if ((node.type === 'AssignmentExpression' || node.type === 'ReassignmentExpression') && childKey === 'left') continue;
        const val = childField(node, childKey);
        if (Array.isArray(val)) {
            for (let index = 0; index < val.length; index++) {
                if (isPineNode(val[index])) rewriteLegacyValues(val[index], userVariables, val, index, versionless);
            }
        } else if (isPineNode(val)) {
            rewriteLegacyValues(val, userVariables, node, childKey, versionless);
        }
    }
}
/**
 * Lower Pine Script v4 legacy flat builtins to v5 namespaces. In-place AST
 * rewrite; call-position and corpus-exercised value-position identifiers only.
 */
export function lowerV4LegacyBuiltins(ast: Program, versionless = false): void {
    const userFunctions = new Set<string>();
    const userVariables = new Set<string>();
    const rsiBindings = new Map<string, RsiArgKind>();
    const functionParams = new Map<string, string[]>();
    collectUserFunctions(ast, userFunctions);
    collectUserVariables(ast, userVariables);
    collectRsiBindings(ast, rsiBindings);
    collectFunctionParams(ast, functionParams);
    for (let pass = 0; pass < 3; pass++) inferFunctionParamKinds(ast, functionParams, rsiBindings);
    rewriteLegacyCalls(ast, userFunctions, rsiBindings, versionless);
    rewriteV4NaComparisons(ast, userVariables);
    rewriteLegacyValues(ast, userVariables, null, '', versionless);
}

// Exported for tests/audits (name → namespace.member).
export const V4_LEGACY_CALL_TARGETS: Readonly<Record<string, NamespaceTarget>> = LEGACY_CALL_TARGETS;
