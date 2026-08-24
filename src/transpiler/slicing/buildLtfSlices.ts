// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * LTF / HTF request slicing — Phases 1 + 2 + 3.
 *
 * For every `request.security_lower_tf` (and `request.security`) call
 * site in the post-transpile AST, build a pre-built async JavaScript
 * Function. Phase 1 + 2 use a path-projection of the statements that
 * lead to the call; Phase 3 keeps the complete invoking statement and
 * removes only consumers of the truncated function return.

 * Coverage:
 *   - Phase 1 — call at top level of the wrapper function.
 *   - Phase 2 — call nested inside `if` / `for` / `while` / `do-while`
 *     / `switch` / nested `BlockStatement` at any depth.
 *   - Phase 3 — call inside a user-defined function (or UDT method —
 *     methods compile to regular FunctionDeclarations). Slice
 *     preserves the function definition with its body truncated at
 *     the call, plus the LAST top-level statement that invokes
 *     that function. Multi-level nesting (A→B→C with the call inside
 *     C, only B called from top level) is currently NOT handled
 *     specially; in that case the runtime falls back to today's
 *     full-script slow path.
 *
 * Slices are keyed by the static `pN` literal carried by the call's
 * third positional argument (the same name `request.param` injects at
 * codegen). Inside a function body, the runtime composes the actual
 * `_expression_name` as `$$.id + 'pN'` (see commit 812eb2d for the
 * path-prefixing fix); the runtime hook in `security_lower_tf.ts`
 * extracts the trailing `pN` for slice-map lookup.
 */

import * as astring from 'astring';

const SLICING_TARGETS = new Set(['security_lower_tf', 'security']);

const AST_SKIP_KEYS = new Set([
    'type', 'loc', 'start', 'end', 'range', 'parent',
    'leadingComments', 'trailingComments',
]);

/** Match `request.<target>(...)`. */
function isRequestSecurityCall(node: any): boolean {
    if (!node || node.type !== 'CallExpression') return false;
    const callee = node.callee;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false;
    if (callee.object?.type !== 'Identifier' || callee.object.name !== 'request') return false;
    if (callee.property?.type !== 'Identifier') return false;
    return SLICING_TARGETS.has(callee.property.name);
}

/**
 * Read the `pN` expression name from a request call's 3rd arg. The
 * call's 3rd arg is the Identifier `pN` returned by `request.param`.
 */
function exprNameOfCall(call: any): string | null {
    const arg2 = call?.arguments?.[2];
    if (arg2?.type === 'Identifier' && typeof arg2.name === 'string') return arg2.name;
    return null;
}

/**
 * Find every `request.security_lower_tf` CallExpression inside `root`,
 * paired with the path of AST ancestors leading to it. The path
 * starts at `root` (path[0] === root) and ends at the call node.
 */
function findRequestCallsWithPaths(root: any): Array<{ call: any; path: any[] }> {
    const found: Array<{ call: any; path: any[] }> = [];
    const seen = new WeakSet<object>();
    function walk(n: any, path: any[]): void {
        if (!n || typeof n !== 'object') return;
        if (seen.has(n)) return;
        seen.add(n);
        const newPath = path.concat([n]);
        if (isRequestSecurityCall(n)) {
            found.push({ call: n, path: newPath });
        }
        for (const key of Object.keys(n)) {
            if (AST_SKIP_KEYS.has(key)) continue;
            const v = n[key];
            if (Array.isArray(v)) {
                for (const item of v) walk(item, newPath);
            } else if (v && typeof v === 'object') {
                walk(v, newPath);
            }
        }
    }
    walk(root, []);
    return found;
}

/** True for any user-function-like AST node (excludes the wrapper). */
function isFunctionLike(n: any): boolean {
    if (!n) return false;
    return n.type === 'FunctionExpression' ||
           n.type === 'ArrowFunctionExpression' ||
           n.type === 'FunctionDeclaration';
}

/**
 * Slice a single AST node along the path. Reused by Phase 1, 2, and 3
 * (Phase 3 also runs this against function-bodies).
 *
 * `path[depth]` is the node we're slicing; `path[depth+1]` is the
 * child on the path. Return a new node with sibling/post-path content
 * dropped. Once we leave the statement realm and enter expression-
 * level nodes (ConditionalExpression, BinaryExpression, etc.), we
 * preserve them whole — slicing inside an expression breaks its
 * value.
 */
function sliceAlongPath(node: any, path: any[], depth: number): any {
    if (depth >= path.length - 1) return node;
    const next = path[depth + 1];

    switch (node.type) {
        case 'BlockStatement': {
            const idx = node.body.indexOf(next);
            if (idx < 0) return node;
            const newBody = node.body.slice(0, idx);
            newBody.push(sliceAlongPath(next, path, depth + 1));
            return { ...node, body: newBody };
        }
        case 'IfStatement': {
            if (next === node.test) {
                return { ...node, test: sliceAlongPath(next, path, depth + 1), consequent: { type: 'BlockStatement', body: [] }, alternate: null };
            }
            if (next === node.consequent) {
                return { ...node, consequent: sliceAlongPath(next, path, depth + 1), alternate: null };
            }
            if (next === node.alternate) {
                return { ...node, alternate: sliceAlongPath(next, path, depth + 1) };
            }
            return node;
        }
        case 'ForStatement':
        case 'WhileStatement':
        case 'DoWhileStatement':
        case 'ForInStatement':
        case 'ForOfStatement': {
            if (next === node.body) {
                return { ...node, body: sliceAlongPath(next, path, depth + 1) };
            }
            return node;
        }
        case 'SwitchStatement': {
            const idx = node.cases.indexOf(next);
            if (idx >= 0) {
                const newCases = node.cases.slice(0, idx);
                newCases.push(sliceAlongPath(next, path, depth + 1));
                return { ...node, cases: newCases };
            }
            return node;
        }
        case 'SwitchCase': {
            const idx = node.consequent.indexOf(next);
            if (idx >= 0) {
                const newCons = node.consequent.slice(0, idx);
                newCons.push(sliceAlongPath(next, path, depth + 1));
                return { ...node, consequent: newCons };
            }
            return node;
        }
        // FunctionDeclaration / FunctionExpression / ArrowFunctionExpression
        // — slice their body when the path enters it.
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression': {
            if (next === node.body) {
                return { ...node, body: sliceAlongPath(next, path, depth + 1) };
            }
            return node;
        }
        default:
            return node;
    }
}

/**
 * Strip the `$M_` JS prefix Pine methods get at codegen. Pine identifiers
 * cannot contain `$`, so the prefix is collision-proof and unambiguous.
 */
function stripMethodPrefix(name: string): string {
    return name.startsWith('$M_') ? name.slice(3) : name;
}

/**
 * Canonical user-function name for the call graph. A Pine method is
 * emitted with a `$M_` JS prefix (`$M_fetch`); when it declares a UDT
 * receiver, `renameMethodVariants` renames the declaration to
 * `$M_fetch_Tracker` (the plain Pine name is preserved on
 * `id.__pineName`). Runtime invocations always target the dispatcher
 * (`$.call($M_fetch, …)`). Both shapes must collapse onto the plain
 * Pine name (`fetch`) so the graph keyed on declaration ids matches the
 * invocation targets.
 */
function canonicalFnName(id: { name?: string; __pineName?: string } | string | null | undefined): string | null {
    if (typeof id === 'string') return stripMethodPrefix(id);
    if (!id || typeof id.name !== 'string' || id.name.length === 0) return null;
    if (typeof id.__pineName === 'string' && id.__pineName.length > 0) return id.__pineName;
    return stripMethodPrefix(id.name);
}

/**
 * Extract the user-function name from the first argument of a
 * `$.call(fnRef, id, …)` invocation. The codegen emits two shapes:
 *   - `$.call(fnName, "_fn0", …)`         — bare function reference
 *   - `$.call($.get(fnName, 0), "_fn0", …)` — via a `$.get` wrapper
 *     (function parameters bound to a Series of fn refs). Both must be
 *     recognized when locating runtime invocations of a user function.
 */
function dollarCallRefName(arg0: any): string | null {
    if (!arg0 || typeof arg0 !== 'object') return null;
    if (arg0.type === 'Identifier' && typeof arg0.name === 'string') return canonicalFnName(arg0.name);
    if (arg0.type === 'CallExpression' && arg0.callee?.type === 'MemberExpression') {
        const obj = arg0.callee.object;
        const prop = arg0.callee.property;
        if (obj?.name === '$' && prop?.name === 'get' && arg0.arguments?.[0]?.type === 'Identifier') {
            return canonicalFnName(arg0.arguments[0].name);
        }
    }
    return null;
}

/**
 * Test if a CallExpression is `$.call(fnRef, ...)` and return the
 * fnRef name. Used to locate top-level invocations of a given user
 * function. Returns null if the node is not a `$.call` or its first
 * arg is not an Identifier / `$.get(Identifier, 0)`.
 */
function dollarCallTarget(node: any): string | null {
    if (!node || node.type !== 'CallExpression') return null;
    const callee = node.callee;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed) return null;
    if (callee.object?.type !== 'Identifier' || callee.object.name !== '$') return null;
    if (callee.property?.type !== 'Identifier' || callee.property.name !== 'call') return null;
    return dollarCallRefName(node.arguments?.[0]);
}

/**
 * Build the user-function call graph of the wrapper body: fnName →
 * the set of user function names its body calls directly (via
 * `$.call(fn, …)` / `$.call($.get(fn, 0), …)`). Used to decide which
 * top-level statements can (transitively) invoke a given function.
 */
function buildWrapperCallGraph(wrapperBody: any): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    for (const stmt of wrapperBody.body || []) {
        if (!isFunctionLike(stmt) || stmt.type !== 'FunctionDeclaration' || !stmt.id?.name) continue;
        // Methods (renamed variants included) collapse onto their Pine name —
        // the same canonical form dollarCallRefName returns for `$.call` targets.
        const name = canonicalFnName(stmt.id);
        if (!name) continue;
        const targets = new Set<string>();
        const seen = new WeakSet<object>();
        (function walk(n: any) {
            if (!n || typeof n !== 'object') return;
            if (seen.has(n)) return;
            seen.add(n);
            const t = dollarCallTarget(n);
            if (t) targets.add(t);
            for (const key of Object.keys(n)) {
                if (AST_SKIP_KEYS.has(key)) continue;
                const v = n[key];
                if (Array.isArray(v)) {
                    for (const item of v) walk(item);
                } else if (v && typeof v === 'object') {
                    walk(v);
                }
            }
        })(stmt);
        graph.set(name, targets);
    }
    return graph;
}

/**
 * True if executing user function `name` can (transitively) invoke
 * user function `target` — `name` either is `target`, or its body
 * calls another user function whose body eventually calls `target`.
 * Recursion-safe via the shared `visited` set.
 */
function fnReachesTarget(name: string, target: string, graph: Map<string, Set<string>>, visited: Set<string> = new Set()): boolean {
    if (name === target) return true;
    if (visited.has(name)) return false;
    visited.add(name);
    const targets = graph.get(name);
    if (!targets) return false;
    for (const t of targets) {
        if (fnReachesTarget(t, target, graph, visited)) return true;
    }
    return false;
}

/**
 * True if executing `stmt` can (transitively through user functions)
 * invoke the user function `fnName` — the statement either calls it
 * directly, or calls another user function whose body eventually
 * calls it. Recursion-safe (visited set per `reaches` query).
 */
function statementReaches(stmt: any, fnName: string, graph: Map<string, Set<string>>): boolean {
    let found = false;
    const seen = new WeakSet<object>();
    (function walk(n: any) {
        if (found || !n || typeof n !== 'object') return;
        if (seen.has(n)) return;
        seen.add(n);
        const t = dollarCallTarget(n);
        if (t && fnReachesTarget(t, fnName, graph)) {
            found = true;
            return;
        }
        for (const key of Object.keys(n)) {
            if (AST_SKIP_KEYS.has(key)) continue;
            const v = n[key];
            if (Array.isArray(v)) {
                for (const item of v) walk(item);
            } else if (v && typeof v === 'object') {
                walk(v);
            }
        }
    })(stmt);
    return found;
}

/**
 * Walk only the executable representation of the generated AST. Tuple
 * destructuring carries vestigial `declarations` / `kind` fields beside
 * the `body` / `expression` that astring actually emits; following those
 * fields would find a call on the wrong chain.
 */
function walkExecutableAst(root: any, visit: (node: any) => void): void {
    const seen = new WeakSet<object>();
    (function walk(node: any): void {
        if (!node || typeof node !== 'object') return;
        if (seen.has(node)) return;
        seen.add(node);
        visit(node);
        for (const key of Object.keys(node)) {
            if (AST_SKIP_KEYS.has(key)) continue;
            if ((key === 'declarations' || key === 'kind') && (node.body !== undefined || node.expression !== undefined)) continue;
            const value = node[key];
            if (Array.isArray(value)) {
                for (const item of value) walk(item);
            } else if (value && typeof value === 'object') {
                walk(value);
            }
        }
    })(root);
}

/** Canonical key for a non-computed member chain such as `$.let.temp`. */
function memberChainKey(node: any): string | null {
    const parts: string[] = [];
    let current = node;
    while (current?.type === 'MemberExpression' &&
           !current.computed &&
           current.property?.type === 'Identifier') {
        parts.unshift(current.property.name);
        current = current.object;
    }
    if (current?.type !== 'Identifier' || parts.length === 0) return null;
    parts.unshift(current.name);
    return parts.join('.');
}

function isDollarMethodCall(node: any, method: string): boolean {
    return node?.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        !node.callee.computed &&
        node.callee.object?.type === 'Identifier' &&
        node.callee.object.name === '$' &&
        node.callee.property?.type === 'Identifier' &&
        node.callee.property.name === method;
}

function containsReachingCall(node: any, fnName: string, graph: Map<string, Set<string>>): boolean {
    let found = false;
    walkExecutableAst(node, (candidate) => {
        const target = dollarCallTarget(candidate);
        if (target && fnReachesTarget(target, fnName, graph)) found = true;
    });
    return found;
}

/**
 * Locate the series slots that hold returns from calls to the truncated
 * function. A tuple assignment is emitted as
 * `$.let.temp = $.init($.let.temp, await $.call(fn, ...))`; only later
 * `$.get($.let.temp, 0)[i]` statements consume that return.
 */
function findTruncatedReturnTemps(stmt: any, fnName: string, graph: Map<string, Set<string>>): Set<string> {
    const temps = new Set<string>();
    walkExecutableAst(stmt, (node) => {
        if (!isDollarMethodCall(node, 'init')) return;
        const temp = memberChainKey(node.arguments?.[0]);
        const value = node.arguments?.[1];
        if (temp && value && containsReachingCall(value, fnName, graph)) temps.add(temp);
    });
    return temps;
}

function containsTruncatedReturnRead(node: any, temps: Set<string>): boolean {
    let found = false;
    walkExecutableAst(node, (candidate) => {
        if (!isDollarMethodCall(candidate, 'get')) return;
        const temp = memberChainKey(candidate.arguments?.[0]);
        if (temp && temps.has(temp)) found = true;
    });
    return found;
}

/**
 * A direct consumer is a statement whose own expression reads a truncated
 * return. Container statements are kept so their tests and non-consuming
 * branches can be traversed and preserved. Generated tuple consumers are
 * standalone assignment statements; a future mixed-effect consumer is
 * conservatively removed as one statement rather than partially rewritten.
 */
function isTruncatedReturnConsumer(stmt: any, temps: Set<string>): boolean {
    if (!stmt || typeof stmt !== 'object') return false;
    switch (stmt.type) {
        case 'BlockStatement':
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
        case 'IfStatement':
        case 'ForStatement':
        case 'WhileStatement':
        case 'DoWhileStatement':
        case 'ForInStatement':
        case 'ForOfStatement':
        case 'SwitchStatement':
        case 'SwitchCase':
        case 'TryStatement':
        case 'LabeledStatement':
            return false;
        default:
            return containsTruncatedReturnRead(stmt, temps);
    }
}

function removeTruncatedReturnConsumers(node: any, temps: Set<string>): any {
    if (!node || typeof node !== 'object' || temps.size === 0) return node;
    switch (node.type) {
        case 'BlockStatement':
            return {
                ...node,
                body: (node.body || [])
                    .filter((stmt: any) => !isTruncatedReturnConsumer(stmt, temps))
                    .map((stmt: any) => removeTruncatedReturnConsumers(stmt, temps)),
            };
        // A kept function whose body destructures the truncated fn's return
        // carries the same dead temp reads one nesting level deeper (probe C:
        // `outer()` destructures `inner()`'s truncated return). Recurse into
        // the body — expression-bodied arrows fall through to the default
        // (kept whole), matching the conservative container policy.
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
            return { ...node, body: removeTruncatedReturnConsumers(node.body, temps) };
        case 'IfStatement':
            return {
                ...node,
                consequent: removeTruncatedReturnConsumers(node.consequent, temps),
                alternate: node.alternate ? removeTruncatedReturnConsumers(node.alternate, temps) : node.alternate,
            };
        case 'ForStatement':
        case 'WhileStatement':
        case 'DoWhileStatement':
        case 'ForInStatement':
        case 'ForOfStatement':
            return { ...node, body: removeTruncatedReturnConsumers(node.body, temps) };
        case 'SwitchStatement':
            return {
                ...node,
                cases: (node.cases || []).map((caseNode: any) => removeTruncatedReturnConsumers(caseNode, temps)),
            };
        case 'SwitchCase':
            return {
                ...node,
                consequent: (node.consequent || [])
                    .filter((stmt: any) => !isTruncatedReturnConsumer(stmt, temps))
                    .map((stmt: any) => removeTruncatedReturnConsumers(stmt, temps)),
            };
        case 'TryStatement':
            return {
                ...node,
                block: removeTruncatedReturnConsumers(node.block, temps),
                handler: node.handler
                    ? { ...node.handler, body: removeTruncatedReturnConsumers(node.handler.body, temps) }
                    : node.handler,
                finalizer: node.finalizer ? removeTruncatedReturnConsumers(node.finalizer, temps) : node.finalizer,
            };
        case 'LabeledStatement':
            return { ...node, body: removeTruncatedReturnConsumers(node.body, temps) };
        default:
            return node;
    }
}

function stripTruncatedReturnConsumers(stmt: any, fnName: string, graph: Map<string, Set<string>>): any {
    const temps = findTruncatedReturnTemps(stmt, fnName, graph);
    return temps.size > 0 ? removeTruncatedReturnConsumers(stmt, temps) : stmt;
}

/**
 * Find the LAST top-level statement in `wrapperBody.body` whose
 * execution can (transitively) invoke `fnName`. Returns -1 when no
 * statement reaches the function.
 *
 * The Phase 3 slice must extend through EVERY runtime invocation of
 * the function, not just the first: the runtime `_expression_name`
 * is per-call-path (`$$.id + 'pN'`), so a slice that stops at the
 * first invocation leaves `secContext.params[$$.id + 'pN']` empty
 * for the later call sites — request.security then crashes reading
 * `[0]` off `undefined`. Statement reachability is transitive: a
 * statement that invokes a *wrapper* function whose body calls the
 * target (e.g. `f_get_donchian()` → `f_secureSecurity()`) must be
 * kept, and a nested function *declaration* whose body calls the
 * target counts too (its invocation statements must be included for
 * the nested calls to ever execute in the slice).
 */
function findLastReachingIdx(wrapperBody: any, fnName: string, graph: Map<string, Set<string>>): number {
    const stmts: any[] = wrapperBody.body || [];
    let last = -1;
    for (let i = 0; i < stmts.length; i++) {
        if (statementReaches(stmts[i], fnName, graph)) last = i;
    }
    return last;
}

/**
 * Build a Phase 3 slice for a request call inside a function body.
 *
 * Strategy:
 *   1. The call's path = [wrapperBody, …, fnDecl, fnDecl.body, …, call].
 *   2. Slice fnDecl.body at the call (using sliceAlongPath rooted at
 *      fnDecl).
 *   3. Find the LAST top-level statement that invokes fnDecl via
 *      `$.call(fnDecl.id, …)`. If none, bail (defensive — shouldn't
 *      happen in practice).
 *   4. Build the wrapper-body slice: keep statements [0..lastIdx]
 *      inclusive, with fnDecl swapped for its sliced version. Within
 *      those statements, remove only reads of the truncated return;
 *      invocation branches and non-consuming side effects stay intact.
 *      The kept statements include any `var` instance initializers the
 *      method needs (e.g. `var Counter c = Counter.new()`), preserving
 *      the var-once semantics observed in TV (Probe 3).
 *
 * Returns the sliced wrapper.body's statement list, or null if the
 * shape isn't supported (multi-level fn nesting, recursive fn,
 * invocation buried inside an expression that we can't safely
 * truncate, etc.). Falling back is always safe — the runtime uses
 * the legacy full-script slow path when no slice is registered.
 */
function buildPhase3SliceStmts(wrapperBody: any, path: any[]): any[] | null {
    // path[0] === wrapperBody. Find the FIRST FunctionDeclaration
    // on the path — that's the outer-most fn body the call lives in.
    let fnIdx = -1;
    for (let i = 1; i < path.length; i++) {
        if (isFunctionLike(path[i])) { fnIdx = i; break; }
    }
    if (fnIdx < 0) return null;
    const fnNode = path[fnIdx];

    // Phase 3 v1 — only handle single-level fn nesting. If there's a
    // SECOND function-like node deeper in the path, bail.
    for (let i = fnIdx + 1; i < path.length; i++) {
        if (isFunctionLike(path[i])) return null;
    }

    // Only handle FunctionDeclarations — anonymous fn-expressions
    // can't be looked up by name in the call graph.
    if (fnNode.type !== 'FunctionDeclaration' || !fnNode.id?.name) return null;
    // Methods carry a `$M_` JS prefix and may have been renamed to a
    // `$M_<name>_<ReceiverType>` variant — canonicalize to the Pine name
    // so the reachability query matches the `$.call($M_<name>, …)`
    // invocation targets (see canonicalFnName).
    const fnName = canonicalFnName(fnNode.id);
    if (!fnName) return null;

    // Slice the function's body at the call.
    const fnSlicePath = path.slice(fnIdx); // [fnDecl, fnDecl.body?, …, call]
    const slicedFn = sliceAlongPath(fnNode, fnSlicePath, 0);

    // Keep every wrapper statement that can (transitively) invoke this
    // function — the runtime expression name is per-call-path, so a
    // slice ending at the FIRST invocation would leave the later call
    // sites without their per-bar captured values in the secondary
    // context (→ TypeError in request.security). Include all statements
    // up to the LAST reaching one.
    const graph = buildWrapperCallGraph(wrapperBody);
    const lastReachingIdx = findLastReachingIdx(wrapperBody, fnName, graph);
    if (lastReachingIdx < 0) return null;

    // Build the wrapper.body slice: keep [0..lastReachingIdx] inclusive,
    // with fnNode replaced by slicedFn. The fn declaration may sit AFTER
    // the invocation in source order — when the fn is hoisted by the
    // pineToJS step. Handle either case:
    const stmts: any[] = wrapperBody.body || [];
    const fnDeclIdx = stmts.indexOf(fnNode);
    if (fnDeclIdx < 0) return null;

    const result: any[] = [];
    const lastIdx = Math.max(lastReachingIdx, fnDeclIdx);
    for (let i = 0; i <= lastIdx; i++) {
        const s = stmts[i];
        if (s === fnNode) {
            result.push(slicedFn);
            continue;
        }
        // Preserve the invocation and every non-consuming side effect in a
        // kept statement. Remove only reads from the truncated return value
        // (the tuple-consumer statements that would otherwise index undefined).
        result.push(stripTruncatedReturnConsumers(s, fnName, graph));
    }
    return result;
}

/** Wrap a sliced statement list back into an async arrow Function. */
function buildSliceFunction(wrapperFn: any, slicedStmts: any[]): Function {
    const slicedAst = {
        type: 'Program',
        sourceType: 'module',
        body: [{
            type: 'ExpressionStatement',
            expression: {
                type: 'ArrowFunctionExpression',
                async: !!wrapperFn.async,
                params: wrapperFn.params,
                body: { type: 'BlockStatement', body: slicedStmts },
            },
        }],
    };
    const code = astring.generate(slicedAst as any);
    const wrapped = `var _r = ${code}\n; return _r;`;
    return new Function('', wrapped)();
}

/**
 * Build the per-call-site slice functions for LTF/HTF requests.
 *
 * Every slice is executed later in its own secondary context via
 * `runPretranspiled`, which reads `transpiledFn._pineVersion` to set
 * `context.pineVersion`. Without propagation, a version-less fallback
 * source (main `_pineVersion` = 4) would run its slices under the
 * default null version, disabling the v4 strategy.entry `long=` /
 * positional-bool translation and crashing on
 * "strategy.entry: direction is required". The slice build carries the
 * propagation itself so call-sites cannot forget it; slices are cut from
 * the already type-inferred AST, so the `versionlessFallback` compile-time
 * gate (native const division) is baked into their nodes and needs no
 * per-slice marker.
 */
export function buildLtfSlices(ast: any, pineVersion: number | null): Record<string, Function> {
    const slices: Record<string, Function> = {};

    if (!ast || ast.type !== 'Program' || !Array.isArray(ast.body) || ast.body.length === 0) {
        return slices;
    }
    const firstStmt = ast.body[0];
    let wrapperFn: any | null = null;
    if (firstStmt.type === 'ExpressionStatement') {
        const expr = firstStmt.expression;
        if (expr && (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression')) {
            wrapperFn = expr;
        }
    } else if (firstStmt.type === 'FunctionDeclaration') {
        wrapperFn = firstStmt;
    }
    if (!wrapperFn || wrapperFn.body?.type !== 'BlockStatement') return slices;

    const calls = findRequestCallsWithPaths(wrapperFn.body);

    for (const { call, path } of calls) {
        const exprName = exprNameOfCall(call);
        if (!exprName) continue;
        if (exprName in slices) continue;

        // Phase 1 + 2 path: the request call is reachable without
        // crossing a nested user function.
        const crossesFn = path.some((n) => isFunctionLike(n));
        let stmts: any[] | null = null;
        if (!crossesFn) {
            const slicedRoot = sliceAlongPath(wrapperFn.body, path, 0);
            stmts = (slicedRoot && slicedRoot.body) ? slicedRoot.body : [];
        } else {
            // Phase 3 path: call lives inside a function body.
            stmts = buildPhase3SliceStmts(wrapperFn.body, path);
        }
        if (!stmts || stmts.length === 0) continue;

        const sliceFn = buildSliceFunction(wrapperFn, stmts);
        // Carry the main function's Pine version onto the slice: the
        // secondary context (`runPretranspiled`) derives its
        // `context.pineVersion` from this marker, and version-less
        // fallback slices must run under v4 runtime semantics.
        (sliceFn as any)._pineVersion = pineVersion;
        slices[exprName] = sliceFn;
    }

    return slices;
}
