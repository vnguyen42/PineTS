// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TypeInferencePass — the version- and qualifier-aware part of Pine `/`.
 *
 * Pine v4/v5 only discard the fractional remainder when BOTH operands are
 * `const int`. An `input`, `simple`, or `series` integer keeps its fractional
 * remainder, and Pine v6 always keeps it. The transpiler therefore must not
 * lower every `int / int` expression to `__idiv`.
 *
 * This pass runs BEFORE the main lowering pass, on the clean AST (operands are
 * still bare identifiers, input calls, and literals). It tracks base type and
 * qualifier independently. Unknown information never authorizes a rewrite:
 * native JavaScript `/` is the safe fallback when const-int proof is absent.
 */
import ScopeManager from './ScopeManager';
import { ASTFactory } from '../utils/ASTFactory';

type BaseType = 'int' | 'float' | 'other' | 'unknown';
type Qualifier = 'const' | 'input' | 'simple' | 'series' | 'unknown';

interface InferredType {
    base: BaseType;
    qualifier: Qualifier;
}

interface DeclaredType {
    base: BaseType;
    qualifier?: Qualifier;
}

const UNKNOWN: InferredType = { base: 'unknown', qualifier: 'unknown' };

/**
 * Built-in variables that are integer-valued but runtime/series-qualified.
 * They must never be treated as const merely because their base type is int.
 */
const INT_BUILTIN_VARS: Record<string, true> = {
    bar_index: true,
    last_bar_index: true,
    time: true,
    time_close: true,
    timenow: true,
    year: true,
    month: true,
    weekofyear: true,
    dayofmonth: true,
    dayofweek: true,
    hour: true,
    minute: true,
    second: true,
};

const QUALIFIER_RANK: Record<Qualifier, number> = {
    const: 0,
    input: 1,
    simple: 2,
    series: 3,
    unknown: 4,
};

function type(base: BaseType, qualifier: Qualifier): InferredType {
    return { base, qualifier };
}

function unknownType(): InferredType {
    return { ...UNKNOWN };
}

function joinQualifier(left: Qualifier, right: Qualifier): Qualifier {
    if (left === 'unknown' || right === 'unknown') return 'unknown';
    return QUALIFIER_RANK[left] >= QUALIFIER_RANK[right] ? left : right;
}

function numericType(left: InferredType, right: InferredType): InferredType {
    const qualifier = joinQualifier(left.qualifier, right.qualifier);
    if (left.base === 'int' && right.base === 'int') return type('int', qualifier);
    if (
        (left.base === 'int' || left.base === 'float')
        && (right.base === 'int' || right.base === 'float')
    ) {
        return type('float', qualifier);
    }
    return type('unknown', qualifier);
}

/**
 * An integer literal (`2`, `11`) — NOT a float literal (`2.0`, `.5`, `1e5`).
 * The raw literal text distinguishes `2` from `2.0`, whose JS values match.
 */
function isIntLiteral(n: any): boolean {
    return (
        n
        && n.type === 'Literal'
        && typeof n.value === 'number'
        && Number.isInteger(n.value)
        && !(typeof n.raw === 'string' && /[.eE]/.test(n.raw))
    );
}

/** Dotted name of a callee: `input.int` → "input.int", `foo` → "foo". */
function calleeName(callee: any): string | null {
    if (!callee) return null;
    if (callee.type === 'Identifier') return callee.name;
    if (
        callee.type === 'MemberExpression'
        && !callee.computed
        && callee.object?.type === 'Identifier'
        && callee.property?.type === 'Identifier'
    ) {
        return `${callee.object.name}.${callee.property.name}`;
    }
    return null;
}
const DECLARED_BASE_TYPES: Record<string, BaseType> = {
    int: 'int',
    float: 'float',
    bool: 'other',
    string: 'other',
    color: 'other',
};

const DECLARED_QUALIFIERS: Record<string, Qualifier> = {
    const: 'const',
    input: 'input',
    simple: 'simple',
    series: 'series',
};

/**
 * Parse the canonical annotation text emitted by pine2js. A bare base type
 * (e.g. `int a = ...`) constrains only the base; its qualifier still comes
 * from the initializer. An explicit qualifier (`series int`, `const int`,
 * etc.) overrides the initializer qualifier.
 */
function parseDeclaredType(raw: unknown): DeclaredType | null {
    if (typeof raw !== 'string') return null;
    const words = raw.trim().split(/\s+/);
    const base = DECLARED_BASE_TYPES[words[words.length - 1]];
    if (base === undefined) return null;
    const qualifier = words.length > 1 ? DECLARED_QUALIFIERS[words[0]] : undefined;
    return { base, qualifier };
}

function markerParts(node: any): [string, DeclaredType] | null {
    const value = node?.type === 'ExpressionStatement' ? node.expression?.value : undefined;
    if (typeof value !== 'string') return null;
    const match = value.match(/^__pineVarType@([A-Za-z_$][\w$]*)=(.+)$/);
    if (!match) return null;
    const declared = parseDeclaredType(match[2]);
    return declared ? [match[1], declared] : null;
}

/** Scope stack of variable-name → inferred base type and qualifier. */
class Env {
    private stack: Map<string, InferredType>[] = [new Map()];

    push(): void {
        this.stack.push(new Map());
    }

    pop(): void {
        if (this.stack.length > 1) this.stack.pop();
    }

    set(name: string, inferred: InferredType): void {
        this.stack[this.stack.length - 1].set(name, inferred);
    }

    get(name: string): InferredType | undefined {
        for (let i = this.stack.length - 1; i >= 0; i--) {
            const value = this.stack[i].get(name);
            if (value !== undefined) return value;
        }
        return undefined;
    }

    /**
     * A reassignment is a runtime/series operation. Preserve the base type
     * only when both the old and new values have the same known base type;
     * in all cases the qualifier becomes series, so it can never authorize a
     * const-int rewrite later.
     */
    assign(name: string, inferred: InferredType): void {
        for (let i = this.stack.length - 1; i >= 0; i--) {
            if (!this.stack[i].has(name)) continue;
            const current = this.stack[i].get(name)!;
            const base = current.base === inferred.base && current.base !== 'unknown'
                ? current.base
                : inferred.base === 'int' || inferred.base === 'float'
                    ? inferred.base
                    : 'unknown';
            this.stack[i].set(name, type(base, 'series'));
            return;
        }
        this.stack[this.stack.length - 1].set(name, type(inferred.base, 'series'));
    }
}

export function runTypeInferencePass(
    ast: any,
    _scopeManager: ScopeManager,
    pineVersion: number | null = null,
): void {
    const env = new Env();
    let controlDepth = 0;
    // The codegen marker is the single source of truth for explicit Pine
    // primitive annotations. It is consumed only when immediately adjacent to
    // the matching declaration in the same statement list; this keeps nested
    // scopes independent and prevents a free-standing user string from
    // retyping an unrelated variable.
    function stripAdjacentMarkers(node: any): void {
        if (!node || typeof node !== 'object') return;
        for (const key in node) {
            if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'raw') continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (let i = 0; i < child.length; i++) {
                    const current = child[i];
                    const next = child[i + 1];
                    const marker = markerParts(next);
                    if (current?.type === 'VariableDeclaration' && marker) {
                        const declaration = (current.declarations || []).find(
                            (candidate: any) =>
                                candidate.id?.type === 'Identifier' && candidate.id.name === marker[0],
                        );
                        if (declaration) {
                            declaration.__pineDeclaredType = marker[1];
                            child.splice(i + 1, 1);
                        }
                    }
                    stripAdjacentMarkers(current);
                }
            } else if (child && typeof child === 'object') {
                stripAdjacentMarkers(child);
            }
        }
    }

    stripAdjacentMarkers(ast);

    function visit(node: any): InferredType {
        if (!node || typeof node !== 'object') return unknownType();

        switch (node.type) {
            case 'Literal':
                if (typeof node.value === 'number') {
                    return isIntLiteral(node) ? type('int', 'const') : type('float', 'const');
                }
                return type('other', 'const');

            case 'Identifier':
                if (INT_BUILTIN_VARS[node.name] === true) return type('int', 'series');
                return env.get(node.name) ?? unknownType();

            case 'UnaryExpression': {
                const argument = visit(node.argument);
                if (node.operator === '-' || node.operator === '+') return argument;
                return unknownType();
            }

            case 'BinaryExpression': {
                const left = visit(node.left);
                const right = visit(node.right);
                if (node.operator === '/') {
                    const canUseIntegerDivision =
                        (pineVersion === 4 || pineVersion === 5)
                        && left.base === 'int'
                        && right.base === 'int'
                        && left.qualifier === 'const'
                        && right.qualifier === 'const';
                    if (canUseIntegerDivision) {
                        const call = ASTFactory.createMathIntDivCall(node.left, node.right);
                        Object.assign(node, call);
                        return type('int', 'const');
                    }
                    return numericType(left, right);
                }
                if (node.operator === '+' || node.operator === '-' || node.operator === '*' || node.operator === '%') {
                    return numericType(left, right);
                }
                return unknownType();
            }

            case 'ConditionalExpression': {
                visit(node.test);
                const consequent = visit(node.consequent);
                const alternate = visit(node.alternate);
                const qualifier = joinQualifier(consequent.qualifier, alternate.qualifier);
                if (consequent.base === 'int' && alternate.base === 'int') return type('int', qualifier);
                if (
                    (consequent.base === 'int' || consequent.base === 'float')
                    && (alternate.base === 'int' || alternate.base === 'float')
                ) {
                    return type('float', qualifier);
                }
                return type('unknown', qualifier);
            }

            case 'LogicalExpression':
                visit(node.left);
                visit(node.right);
                return type('other', 'series');

            case 'CallExpression': {
                // Visit the callee object (which may itself contain an
                // expression) and all arguments before classifying the result.
                if (node.callee?.type === 'MemberExpression') {
                    visit(node.callee.object);
                    if (node.callee.computed) visit(node.callee.property);
                }
                const args = (node.arguments || []).map((arg: any) => visit(arg));
                const name = calleeName(node.callee);

                if (name === 'input.int') return type('int', 'input');
                if (name === 'input.float') return type('float', 'input');
                if (name === 'input.any') {
                    // `input.any` is necessarily input-qualified. Infer only
                    // its base from a literal/default when possible; the
                    // qualifier still prevents __idiv.
                    const defaultType = args[0] ?? unknownType();
                    return type(defaultType.base, 'input');
                }
                if (name === 'input.bool' || name === 'input.string' || name === 'input.source'
                    || name === 'input.symbol' || name === 'input.timeframe' || name === 'input.session'
                    || name === 'input.time' || name === 'input.color') {
                    return type('other', 'input');
                }

                // Pine casts preserve the qualifier of their operand while
                // changing the base type. Thus int(input.int(4)) is input
                // int, not const int.
                if (name === 'int') {
                    const argument = args[0] ?? unknownType();
                    return type('int', argument.qualifier);
                }
                if (name === 'float') {
                    const argument = args[0] ?? unknownType();
                    return type('float', argument.qualifier);
                }

                if (name === 'math.floor' || name === 'math.ceil') {
                    const argument = args[0] ?? unknownType();
                    return type('int', argument.qualifier);
                }
                if (name === 'timestamp') {
                    const qualifier = args.reduce(
                        (current: Qualifier, argument: InferredType) => joinQualifier(current, argument.qualifier),
                        'const' as Qualifier,
                    );
                    return type('int', qualifier);
                }
                if (name === 'array.size' || name === 'matrix.rows' || name === 'matrix.columns'
                    || name === 'str.length' || name === 'ta.barssince'
                    || name === 'ta.highestbars' || name === 'ta.lowestbars') {
                    return type('int', 'series');
                }
                return unknownType();
            }

            case 'MemberExpression':
                visit(node.object);
                if (node.computed) visit(node.property);
                return unknownType();

            case 'VariableDeclaration': {
                for (const declaration of node.declarations || []) {
                    const inferred = declaration.init ? visit(declaration.init) : unknownType();
                    if (declaration.id?.type !== 'Identifier') continue;
                    const annotation = declaration.__pineDeclaredType;
                    const annotated = annotation
                        ? type(annotation.base, annotation.qualifier ?? inferred.qualifier)
                        : inferred;
                    // `var` declarations persist across bars and are
                    // series-qualified even when their initializer is a
                    // literal. Declarations inside control flow are likewise
                    // not compile-time constants.
                    const explicitQualifier = annotation?.qualifier !== undefined;
                    const stored = node.kind === 'var'
                        || (controlDepth > 0 && !explicitQualifier)
                        ? type(annotated.base, 'series')
                        : annotated;
                    env.set(declaration.id.name, stored);
                }
                return unknownType();
            }

            case 'AssignmentExpression': {
                const right = visit(node.right);
                if (node.left?.type === 'Identifier') {
                    env.assign(node.left.name, right);
                } else {
                    visit(node.left);
                }
                return type(right.base, 'series');
            }

            case 'UpdateExpression': {
                const argument = visit(node.argument);
                if (node.argument?.type === 'Identifier') {
                    env.assign(node.argument.name, argument);
                }
                return type(argument.base, 'series');
            }

            case 'IfStatement':
                visit(node.test);
                controlDepth++;
                visit(node.consequent);
                if (node.alternate) visit(node.alternate);
                controlDepth--;
                return unknownType();

            case 'ForStatement':
                controlDepth++;
                if (node.init) visit(node.init);
                if (node.test) visit(node.test);
                if (node.update) visit(node.update);
                visit(node.body);
                controlDepth--;
                return unknownType();

            case 'WhileStatement':
            case 'DoWhileStatement':
                controlDepth++;
                if (node.test) visit(node.test);
                visit(node.body);
                controlDepth--;
                return unknownType();

            case 'ForInStatement':
            case 'ForOfStatement':
                controlDepth++;
                if (node.left?.type === 'Identifier') {
                    const current = env.get(node.left.name) ?? unknownType();
                    env.assign(node.left.name, current);
                } else {
                    visit(node.left);
                }
                visit(node.right);
                visit(node.body);
                controlDepth--;
                return unknownType();

            case 'SwitchStatement':
                visit(node.discriminant);
                controlDepth++;
                for (const switchCase of node.cases || []) {
                    env.push();
                    visit(switchCase);
                    env.pop();
                }
                controlDepth--;
                return unknownType();

            case 'BlockStatement':
                env.push();
                recurseChildren(node);
                env.pop();
                return unknownType();

            case 'FunctionDeclaration':
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
                env.push();
                for (const parameter of node.params || []) {
                    const id = parameter.type === 'AssignmentPattern' ? parameter.left : parameter;
                    if (id?.type === 'Identifier') env.set(id.name, unknownType());
                    if (parameter.type === 'AssignmentPattern') visit(parameter.right);
                }
                visit(node.body);
                env.pop();
                return unknownType();

            default:
                recurseChildren(node);
                return unknownType();
        }
    }

    function recurseChildren(node: any): void {
        for (const key in node) {
            if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'raw') continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child) if (item && typeof item.type === 'string') visit(item);
            } else if (child && typeof child.type === 'string') {
                visit(child);
            }
        }
    }

    visit(ast);
}
