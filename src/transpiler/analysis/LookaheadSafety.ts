// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Static half of the strict-lookahead guard (see `PineTS.setStrictLookahead`).
 *
 * `request.security(…, lookahead = barmerge.lookahead_on)` on a higher timeframe
 * hands every chart bar the values of the higher-timeframe bar that contains it,
 * final values included: on historical bars the script sees the future. Only
 * values that are already known when that bar opens are safe to read this way:
 * `open`, `time`, any `x[n]` with a literal n ≥ 1, and tuples of those.
 *
 * This pass runs on the transformed AST (built-ins are bare identifiers there,
 * user variables are context-scoped, so the classification cannot be fooled by
 * comments, strings, spacing or shadowed names) and returns the static
 * expression-param names (`pN`) of the call sites whose expression is safe.
 * The runtime refuses a higher-timeframe lookahead_on request whose expression
 * name is not in that list, so anything this pass does not recognize fails
 * closed.
 */

type Node = any;

const SKIP_KEYS = new Set(['type', 'loc', 'start', 'end', 'range', 'parent']);

function walk(node: Node, visit: (node: Node) => void): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const child of node) walk(child, visit);
        return;
    }
    if (typeof node.type !== 'string') return;
    visit(node);
    for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) continue;
        walk(node[key], visit);
    }
}

function isIdentifier(node: Node, name?: string): boolean {
    return node?.type === 'Identifier' && (name === undefined || node.name === name);
}

/** `<object>.<property>` with a plain (non-computed) property. */
function isMember(node: Node, object: string | undefined, property: string): boolean {
    return (
        node?.type === 'MemberExpression' &&
        !node.computed &&
        isIdentifier(node.property, property) &&
        (object === undefined ? isIdentifier(node.object) : isIdentifier(node.object, object))
    );
}

/** A literal history offset n ≥ 1 (Pine offsets are integers). */
function isConfirmedOffset(node: Node): boolean {
    return node?.type === 'Literal' && typeof node.value === 'number' && Number.isInteger(node.value) && node.value >= 1;
}

/** Names bound by a declaration pattern. */
function boundNames(pattern: Node, out: string[]): void {
    if (!pattern) return;
    switch (pattern.type) {
        case 'Identifier':
            out.push(pattern.name);
            break;
        case 'ObjectPattern':
            for (const prop of pattern.properties) boundNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
            break;
        case 'ArrayPattern':
            for (const element of pattern.elements) boundNames(element, out);
            break;
        case 'RestElement':
            boundNames(pattern.argument, out);
            break;
        case 'AssignmentPattern':
            boundNames(pattern.left, out);
            break;
    }
}

/**
 * Built-in names (`open`, `time`) that are bound exactly once, by the runtime's
 * own destructuring (`const {open} = $.data`, `const {time} = $.pine`). Any other
 * binding (a function parameter named `open`, …) makes every bare use suspect.
 */
function trustedBuiltins(ast: Node): Set<string> {
    const bindings = new Map<string, number>();
    const runtimeBound = new Set<string>();
    const count = (names: string[]) => {
        for (const name of names) bindings.set(name, (bindings.get(name) ?? 0) + 1);
    };
    walk(ast, (node) => {
        const names: string[] = [];
        if (node.type === 'VariableDeclarator') {
            boundNames(node.id, names);
            if (node.id.type === 'ObjectPattern' && isMember(node.init, '$', 'data') && names.includes('open')) runtimeBound.add('open');
            if (node.id.type === 'ObjectPattern' && isMember(node.init, '$', 'pine') && names.includes('time')) runtimeBound.add('time');
        } else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
            if (node.id) boundNames(node.id, names);
            for (const param of node.params) boundNames(param, names);
        } else if (node.type === 'CatchClause') {
            boundNames(node.param, names);
        } else if (node.type === 'ClassDeclaration' && node.id) {
            names.push(node.id.name);
        }
        count(names);
    });
    return new Set([...runtimeBound].filter((name) => bindings.get(name) === 1));
}

/** `<ns>.param(value, index, name)` — the transpiler's argument wrapper. */
function isParamCall(node: Node): boolean {
    return node?.type === 'CallExpression' && isMember(node.callee, undefined, 'param') && node.arguments.length >= 3;
}

/** Static `pN` of a param call's name argument (`'pN'` or `$$.id + 'pN'`). */
function paramName(nameArg: Node): string | undefined {
    const literal = nameArg?.type === 'BinaryExpression' ? nameArg.right : nameArg;
    const text = literal?.type === 'Literal' ? String(literal.value) : literal?.type === 'Identifier' ? literal.name : '';
    return /^'?(p\d+)'?$/.exec(text)?.[1];
}

/**
 * A value known when the requested bar opens. `open` only when `trusted` has it: another symbol's
 * bar opens at its window's nominal start, possibly before its first trade (an index's daily window
 * at 00:00 UTC, first print at 08:15), so its `open` is not known at the chart bar's open.
 */
function isConfirmedValue(node: Node, trusted: Set<string>): boolean {
    if (node?.type === 'Identifier') return node.name === 'open' && trusted.has('open');
    if (isMember(node, 'time', '__value')) return trusted.has('time');
    if (node?.type === 'CallExpression' && isMember(node.callee, '$', 'get')) {
        return node.arguments.length === 2 && isConfirmedOffset(node.arguments[1]);
    }
    if (node?.type === 'ArrayExpression') {
        return node.elements.length > 0 && node.elements.every((element: Node) => isConfirmedValue(element, trusted));
    }
    return false;
}

/**
 * Expression params safe under lookahead_on. `withOpen: false` drops bare `open` (the set for
 * another symbol under strict lookahead); `time` and `x[n]`, n ≥ 1, stay.
 */
export function collectLookaheadSafeExpressions(ast: Node, withOpen = true): string[] {
    const trusted = trustedBuiltins(ast);
    if (!withOpen) trusted.delete('open');
    const params = new Map<string, Node>();
    walk(ast, (node) => {
        if (node.type === 'VariableDeclarator' && isIdentifier(node.id) && isParamCall(node.init)) {
            params.set(node.id.name, node.init);
        }
    });
    const resolve = (arg: Node): Node | undefined => {
        if (isParamCall(arg)) return arg;
        if (isIdentifier(arg)) return params.get(arg.name);
        return undefined;
    };

    const safe = new Set<string>();
    walk(ast, (node) => {
        if (node.type !== 'CallExpression' || !isMember(node.callee, 'request', 'security')) return;
        // Named arguments arrive as one trailing param wrapping an object literal.
        const args: Node[] = [...node.arguments];
        const options = resolve(args[args.length - 1])?.arguments[0];
        if (options?.type === 'ObjectExpression') args.pop();
        const expressionArg =
            args[2] ??
            options?.properties?.find(
                (prop: Node) => prop.type === 'Property' && !prop.computed && (isIdentifier(prop.key, 'expression') || prop.key?.value === 'expression'),
            )?.value;
        const param = resolve(expressionArg);
        if (!param) return;
        const [value, index, nameArg] = param.arguments;
        const name = paramName(nameArg);
        if (!name) return;
        const confirmed = isIdentifier(index, 'undefined') ? isConfirmedValue(value, trusted) : isConfirmedOffset(index);
        if (confirmed) safe.add(name);
    });
    return [...safe];
}
