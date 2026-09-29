// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// Strict-mode identifier validation for explicit Pine v5/v6 sources.
//
// PineTS' Pine mode compiles `//@version=5|6` sources to JavaScript that is
// later executed in a Node/JS runtime. Without a whitelist, any identifier the
// script does not declare passes through the transpiler untouched
// ("Global/unknown var, return as is" in ExpressionTransformer), so a Pine
// script could reach real JS globals (`process`, `globalThis`, `fetch`,
// `require`, `eval`, `Function`, `Math`, …) and arbitrary `constructor`
// chains — code the Pine language itself can never express.
//
// This pass runs on the parsed Pine AST (before codegen) and rejects every
// identifier reference that is neither:
//   - declared in the script (variables, params, loop vars, functions,
//     methods, types, enums), nor
//   - a known Pine v5/v6 built-in, namespace, keyword-represented-as-
//     identifier, or contextual keyword.
// Member accesses of `constructor` / `__proto__` / `prototype` are rejected
// outright so object-prototype chains cannot reach `Function`.
//
// It is gated on an EXPLICIT `//@version=5|6` header by the caller:
// version-less PineTS/JS sources and the version-less Pine fallback retry
// keep their existing library behavior, and v4 legacy lowering is untouched.

import { CONTEXT_DATA_VARS, CONTEXT_PINE_VARS, NAMESPACE_COLLISION_NAMES } from '../settings';

/**
 * Pine v5/v6 built-in identifiers not covered by the settings tables above:
 *  - legacy-but-valid v5 globals: `study` (deprecated declaration),
 *    `tickerid` (deprecated variable), `tick` (tick-size variable),
 *    `plotstyle` (v4-era drawing-style namespace root);
 *  - the v6 `calendar` namespace;
 *  - `this`, the explicit receiver parameter of Pine method declarations
 *    (parsed as an ordinary identifier);
 *  - `return` / `break` / `continue`, which the parser represents as
 *    identifier nodes (later passes emit them as JS keywords — they are NOT
 *    reachable JS globals);
 *  - the contextual keywords `type` / `method` / `enum`, which Pine permits
 *    as plain identifiers outside their declaration-introducing position.
 */
const EXTRA_PINE_IDENTIFIERS: readonly string[] = [
    'study',
    'tickerid',
    'tick',
    'plotstyle',
    'calendar',
    'this',
    'return',
    'break',
    'continue',
    'type',
    'method',
    'enum',
    // Documented v6 built-ins that carry no value in this runtime (they produce a
    // clean runtime error instead of a false "not Pine" compile claim): the order
    // book series `bid` / `ask`, the `settlement_as_close` chart-setting flag,
    // and the footprint chart type names `footprint` / `volume_row` (usable as
    // bare values, e.g. via `type()`).
    'bid',
    'ask',
    'settlement_as_close',
    'footprint',
    'volume_row',
];

function toLookup(names: readonly string[]): Record<string, true> {
    const lookup: Record<string, true> = Object.create(null) as Record<string, true>;
    for (const name of names) lookup[name] = true;
    return lookup;
}

/**
 * Every identifier a Pine v5/v6 source may reference without declaring it.
 * `iff` / `v4_rsi` are v4-only runtime helpers (not injected for v5/v6), so
 * explicit v5/v6 sources referencing them fail here with a clear compile
 * error instead of a runtime ReferenceError.
 */
const PINE_WHITELIST: Record<string, true> = toLookup([
    ...CONTEXT_DATA_VARS,
    ...CONTEXT_PINE_VARS.filter((name) => name !== 'iff' && name !== 'v4_rsi'),
    ...NAMESPACE_COLLISION_NAMES,
    ...EXTRA_PINE_IDENTIFIERS,
]);

/**
 * Object-prototype property names that can reach JS internals (e.g.
 * `x.constructor.constructor(...)` == `Function`). Pine has no legitimate
 * use for them.
 */
const DANGEROUS_PROPERTY_NAMES: Record<string, true> = toLookup(['constructor', '__proto__', 'prototype']);

// `in` would also match Object.prototype members (`'constructor' in {}` is
// true), so membership must be own-property only.
function isPineAllowed(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(PINE_WHITELIST, name);
}

function isDangerousProperty(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(DANGEROUS_PROPERTY_NAMES, name);
}

// The parser produces dynamic AST nodes matching the shapes in ./ast.ts but
// without a shared static union; the walker narrows fields as it goes.
interface PineNode {
    type: string;
    [key: string]: unknown;
}

function isPineNode(value: unknown): value is PineNode {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    if (!('type' in value)) return false;
    return typeof value.type === 'string';
}

function asNode(value: unknown): PineNode | null {
    return isPineNode(value) ? value : null;
}

function asNodeArray(value: unknown): PineNode[] {
    if (!Array.isArray(value)) return [];
    return value.filter(isPineNode);
}

function identifierName(node: PineNode | null): string | null {
    if (!node || node.type !== 'Identifier') return null;
    return typeof node.name === 'string' ? node.name : null;
}

/** The declared-name nodes (Identifier / ArrayPattern, possibly wrapped in
 *  AssignmentPattern defaults) that `node` binds. ArrayPatterns recurse into
 *  their elements so every tuple-destructure target is collected. */
function bindingTargets(node: PineNode | null): PineNode[] {
    if (!node) return [];
    switch (node.type) {
        case 'Identifier':
            return [node];
        case 'ArrayPattern':
            return asNodeArray(node.elements).flatMap(bindingTargets);
        case 'AssignmentPattern':
            return bindingTargets(asNode(node.left));
        default:
            return [];
    }
}

/**
 * Phase 1 — collect every name the script declares, so references can be
 * checked against it. Pine forbids shadowing a global name in a local scope,
 * and declarations are hoisted/allowed in any order in the corpus, so a
 * script-wide set is the faithful model for valid Pine sources.
 */
function collectDeclared(node: PineNode, declared: Set<string>): void {
    switch (node.type) {
        case 'VariableDeclarator': {
            for (const target of bindingTargets(asNode(node.id))) {
                const name = identifierName(target);
                if (name) declared.add(name);
            }
            // Initializers can host declaration-introducing expressions
            // (for/while-as-expression: `result = for i = 0 to 4` declares
            // `i` inside the initializer's ForStatement).
            const init = asNode(node.init);
            if (init) collectDeclared(init, declared);
            return;
        }
        case 'FunctionDeclaration': {
            for (const target of bindingTargets(asNode(node.id))) {
                const name = identifierName(target);
                if (name) declared.add(name);
            }
            for (const param of asNodeArray(node.params)) {
                for (const target of bindingTargets(param)) {
                    const name = identifierName(target);
                    if (name) declared.add(name);
                }
            }
            // Local variables declared in the body.
            const body = asNode(node.body);
            if (body) collectDeclared(body, declared);
            return;
        }
        case 'ArrowFunctionExpression': {
            for (const param of asNodeArray(node.params)) {
                for (const target of bindingTargets(param)) {
                    const name = identifierName(target);
                    if (name) declared.add(name);
                }
            }
            const body = asNode(node.body);
            if (body) collectDeclared(body, declared);
            return;
        }
        case 'TypeDefinition': {
            // `type Name` — the parser stores the name as a plain string.
            if (typeof node.name === 'string') declared.add(node.name);
            return;
        }
        default: {
            for (const [key, value] of Object.entries(node)) {
                if (key === 'parent' || key === '_line') continue;
                if (Array.isArray(value)) {
                    for (const child of value) {
                        const childNode = asNode(child);
                        if (childNode) collectDeclared(childNode, declared);
                    }
                } else {
                    const childNode = asNode(value);
                    if (childNode) collectDeclared(childNode, declared);
                }
            }
        }
    }
}

/** Wrapper for the source line threaded down to identifier errors. */
interface LineCursor {
    current: number;
}

/**
 * Phase 2 — walk every expression reference and reject identifiers outside
 * the whitelist or the declared set. Statements carry `_line` (set by the
 * parser), which is threaded down to identifiers for the error message.
 */
function checkReferences(node: PineNode, declared: Set<string>, line: LineCursor): void {
    if (typeof node._line === 'number') line.current = node._line;

    switch (node.type) {
        case 'Identifier': {
            const name = typeof node.name === 'string' ? node.name : null;
            if (name === null) return;
            if (!isPineAllowed(name) && !declared.has(name)) {
                throw new Error(
                    `Undeclared identifier '${name}' at line ${line.current} — not a Pine built-in, namespace, or a name declared in the script`,
                );
            }
            return;
        }
        case 'MemberExpression': {
            // Non-computed property: an object-property name, never a
            // reference itself — but prototype-chain names are banned.
            if (node.computed !== true) {
                const property = asNode(node.property);
                const propertyName = identifierName(property);
                if (propertyName && isDangerousProperty(propertyName)) {
                    throw new Error(
                        `Member access '${propertyName}' is not allowed in Pine at line ${line.current}`,
                    );
                }
                const object = asNode(node.object);
                if (object) checkReferences(object, declared, line);
                return;
            }
            // Computed access: the property expression is a real reference.
            const object = asNode(node.object);
            if (object) checkReferences(object, declared, line);
            const property = asNode(node.property);
            if (property) {
                if (
                    property.type === 'Literal' &&
                    typeof property.value === 'string' &&
                    isDangerousProperty(property.value)
                ) {
                    throw new Error(
                        `Member access '${property.value}' is not allowed in Pine at line ${line.current}`,
                    );
                }
                checkReferences(property, declared, line);
            }
            return;
        }
        case 'Property': {
            // Object-property keys (including named call arguments, which the
            // parser folds into ObjectExpression properties) are names, not
            // references — unless the property is computed.
            const key = asNode(node.key);
            const value = asNode(node.value);
            const keyIsName =
                key !== null && node.computed !== true && (key.type === 'Identifier' || key.type === 'Literal');
            if (keyIsName) {
                if (value) checkReferences(value, declared, line);
            } else {
                if (key) checkReferences(key, declared, line);
                if (value) checkReferences(value, declared, line);
            }
            return;
        }
        case 'VariableDeclarator': {
            // Declaration targets are validated via the declared set; only
            // the initializer is a reference.
            const init = asNode(node.init);
            if (init) checkReferences(init, declared, line);
            return;
        }
        default: {
            for (const [key, value] of Object.entries(node)) {
                if (key === 'parent' || key === '_line') continue;
                if (Array.isArray(value)) {
                    for (const child of value) {
                        const childNode = asNode(child);
                        if (childNode) checkReferences(childNode, declared, line);
                    }
                } else {
                    const childNode = asNode(value);
                    if (childNode) checkReferences(childNode, declared, line);
                }
            }
        }
    }
}

/**
 * Validate every identifier reference of an explicit Pine v5/v6 AST against
 * the script's own declarations and the Pine built-in vocabulary. Throws an
 * Error (surfaced by pineToJS as a failed compilation with a clear message)
 * on the first undeclared identifier or banned prototype-chain member access.
 */
export function validatePineIdentifiers(ast: unknown): void {
    const root = asNode(ast);
    if (!root) return;
    const declared = new Set<string>();
    collectDeclared(root, declared);
    checkReferences(root, declared, { current: 1 });
}