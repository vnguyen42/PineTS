// VIN-154/VIN-155/VIN-156: full-backtest specialization; fixed input bindings.
// Uses the existing PineTS runtime, broker, TA, and output construction.
import { makePlot } from './fixed-plot.mjs';
import { createRequire } from 'node:module';
import { Context, Indicator as BaseIndicator } from '../dist/pinets.min.es.js';
export { PineTS } from '../dist/pinets.min.es.js';
const require = createRequire(new URL('../package.json', import.meta.url));
const { parse } = require('acorn'),
    { generate } = require('astring');
const path = (n) =>
    n?.type === 'Identifier' ? n.name : n?.type === 'MemberExpression' && !n.computed ? `${path(n.object)}.${n.property.name}` : null;
const lit = (v) =>
    typeof v === 'number' && (v < 0 || Object.is(v, -0))
        ? {
              type: 'UnaryExpression',
              operator: '-',
              prefix: true,
              argument: {
                  type: 'Literal',
                  value: -v,
              },
          }
        : {
              type: 'Literal',
              value: v,
          };
function walk(n, fn, parent = null) {
    if (!n || typeof n !== 'object') return;
    fn(n, parent);
    for (const [k, v] of Object.entries(n)) {
        if (k === 'loc') continue;
        if (Array.isArray(v)) v.forEach((x) => walk(x, fn, n));
        else if (v?.type) walk(v, fn, n);
    }
}
function transform(n, fn) {
    if (!n || !n.type) return n;
    for (const [k, v] of Object.entries(n)) {
        if (Array.isArray(v)) n[k] = v.map((x) => (x?.type ? transform(x, fn) : x));
        else if (v?.type) n[k] = transform(v, fn);
    }
    return fn(n);
}
function foldLiteralOperations(root) {
    // Fold only literal JS operations emitted by the existing PineTS transpiler.
    for (let pass = 0; pass < 3; pass++)
        transform(root, (n) => {
            if (
                n.type === 'CallExpression' &&
                ['$.pine.math.__eq', '$.pine.math.__neq'].includes(path(n.callee)) &&
                n.arguments.length === 2 &&
                n.arguments.every((a) => a.type === 'Literal' && ['string', 'boolean'].includes(typeof a.value)) &&
                typeof n.arguments[0].value === typeof n.arguments[1].value
            ) {
                const equal = n.arguments[0].value === n.arguments[1].value;
                return lit(path(n.callee).endsWith('__eq') ? equal : !equal);
            }
            if (n.type === 'UnaryExpression' && n.operator === '!' && n.argument.type === 'Literal') return lit(!n.argument.value);
            if (n.type === 'LogicalExpression' && n.left.type === 'Literal') {
                if (n.operator === '&&') return n.left.value ? n.right : n.left;
                if (n.operator === '||') return n.left.value ? n.left : n.right;
            }
            if (n.type === 'ConditionalExpression' && n.test.type === 'Literal') return n.test.value ? n.consequent : n.alternate;
            if (
                n.type === 'SwitchStatement' &&
                n.discriminant.type === 'Literal' &&
                n.cases.every((c) => !c.test || c.test.type === 'Literal') &&
                n.cases.every((c) => c.consequent.at(-1)?.type === 'ReturnStatement')
            ) {
                const c = n.cases.find((c) => c.test && c.test.value === n.discriminant.value) ?? n.cases.find((c) => !c.test);
                return {
                    type: 'BlockStatement',
                    body: c?.consequent ?? [],
                };
            }
            if (n.type === 'IfStatement' && n.test.type === 'Literal')
                return n.test.value
                    ? n.consequent
                    : (n.alternate ?? {
                          type: 'EmptyStatement',
                      });
            if ((n.type === 'BinaryExpression' || n.type === 'LogicalExpression') && n.left.type === 'Literal' && n.right.type === 'Literal') {
                try {
                    const v = Function(`return (${generate(n)})`)();
                    if (['number', 'boolean', 'string'].includes(typeof v) && !(typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0))))
                        return lit(v);
                } catch {}
            }
            return n;
        });
}

function specializeFixedPlots(root, stats, fresh, scalar, plotFactory) {
    // VIN-155: resolve static plot options through the original call once.
    const plotBindings = new Map();
    for (const statement of root.body.body)
        if (statement.type === 'VariableDeclaration' && statement.kind === 'const') {
            for (const d of statement.declarations) if (d.id.type === 'Identifier') plotBindings.set(d.id.name, { d, statement });
        }
    const plotEnums =
        /^(plot\.(style_[a-z_]+|linestyle_[a-z_]+)|color\.(aqua|black|blue|fuchsia|gray|green|lime|maroon|navy|olive|orange|purple|red|silver|teal|white|yellow))$/;
    function fixedPlot(n, seen = new Set()) {
        if (!n) return false;
        if (n.type === 'Literal') return true;
        if (n.type === 'Identifier') {
            if (n.name === 'undefined') return true;
            const b = plotBindings.get(n.name);
            if (!b || seen.has(n.name)) return false;
            return fixedPlot(b.d.init, new Set([...seen, n.name]));
        }
        if (n.type === 'MemberExpression')
            return (
                !n.computed && (plotEnums.test(path(n) || '') || /^display\.(all|none|data_window|pane|price_scale|status_line)$/.test(path(n) || ''))
            );
        if (n.type === 'BinaryExpression') return fixedPlot(n.left, seen) && fixedPlot(n.right, seen);
        if (n.type === 'ObjectExpression')
            return n.properties.every(
                (p) =>
                    p.type === 'Property' &&
                    !p.computed &&
                    !p.method &&
                    p.kind === 'init' &&
                    (p.key.name ?? p.key.value) !== 'series' &&
                    fixedPlot(p.value, seen),
            );
        if (n.type === 'ArrayExpression') return n.elements.every((e) => fixedPlot(e, seen));
        if (n.type === 'UnaryExpression') return ['-', '+', '!'].includes(n.operator) && fixedPlot(n.argument, seen);
        if (n.type === 'CallExpression') {
            const name = path(n.callee);
            return (
                (['plot.param', 'color.param', 'color.new', 'color.rgb'].includes(name) || plotEnums.test(name || '')) &&
                n.arguments.every((a) => fixedPlot(a, seen))
            );
        }
        return false;
    }
    for (const statement of [...root.body.body])
        if (statement.type === 'VariableDeclaration') {
            for (const d of statement.declarations) {
                const n = d.init;
                if (
                    path(n?.callee) !== 'plot.any' ||
                    n.arguments.length < 2 ||
                    n.arguments[0].type !== 'Identifier' ||
                    !n.arguments.slice(1).every((a) => fixedPlot(a))
                )
                    continue;
                // Only current-value wrappers/scalars: no custom source object is substituted.
                const src = plotBindings.get(n.arguments[0].name)?.d.init;
                if (
                    !src ||
                    (path(src.callee) === 'plot.param' && src.arguments[0]?.type === 'ObjectExpression') ||
                    !(path(src.callee) === 'plot.param' || path(src.callee) === '$.get' || scalar(src))
                )
                    continue;
                const deps = new Set();
                function collect(n) {
                    walk(n, (x, p) => {
                        if (
                            x.type === 'Identifier' &&
                            plotBindings.has(x.name) &&
                            !deps.has(x.name) &&
                            !(p?.type === 'Property' && p.key === x && !p.computed)
                        ) {
                            deps.add(x.name);
                            collect(plotBindings.get(x.name).d.init);
                        }
                    });
                }
                n.arguments.slice(1).forEach(collect);
                const movable = new Set(deps);
                // Keep shared metadata in place; move only declarations read by this call/dependency tree.
                let changed = true;
                while (changed) {
                    changed = false;
                    for (const name of [...movable]) {
                        const own = plotBindings.get(name);
                        let safe = true;
                        walk(root, (x, p) => {
                            if (x.type !== 'Identifier' || x.name !== name || x === own.d.id) return;
                            let allowed = false;
                            walk(n, (y) => {
                                if (y === x) allowed = true;
                            });
                            for (const other of movable)
                                walk(plotBindings.get(other).d.init, (y) => {
                                    if (y === x) allowed = true;
                                });
                            if (!allowed) safe = false;
                        });
                        if (!safe) {
                            movable.delete(name);
                            changed = true;
                        }
                    }
                }
                const moved = root.body.body.filter((st) => [...movable].some((name) => plotBindings.get(name).statement === st));
                root.body.body = root.body.body.filter((st) => !moved.includes(st));
                const cache = fresh();
                const sourceArg = fresh(),
                    originalSource = n.arguments[0].name;
                n.arguments[0] = { type: 'Identifier', name: sourceArg };
                const initializer = {
                    type: 'ArrowFunctionExpression',
                    params: [{ type: 'Identifier', name: sourceArg }],
                    async: false,
                    expression: false,
                    body: { type: 'BlockStatement', body: [...moved, { type: 'ReturnStatement', argument: n }] },
                };
                const base = parse(`($.${cache} ??= ${plotFactory}($,()=>{}))(${originalSource})`, { ecmaVersion: 'latest' }).body[0].expression;
                base.callee.right.arguments[1] = initializer;
                d.init = base;
                stats.fixedPlots = (stats.fixedPlots || 0) + 1;
            }
        }
}

export function specialize(original, inputs = {}) {
    const ast = parse(`(${original.toString()})`, {
            ecmaVersion: 'latest',
        }),
        root = ast.body[0].expression;
    if (original._pineVersion == null)
        return {
            fn: original,
            stats: {
                fallback: 'non-Pine source',
            },
        };
    // Full backtests with fixed input bindings only; asynchronous requests keep PineTS.
    let unsupported = false;
    walk(root, (n) => {
        if (n.type === 'AwaitExpression') unsupported = true;
    });
    if (unsupported)
        return {
            fn: original,
            stats: {
                fallback: 'await',
            },
        };
    const names = new Set();
    walk(root, (n) => {
        if (n.type === 'Identifier') names.add(n.name);
    });
    let freshId = 0;
    const fresh = () => {
        let name;
        do {
            name = `__specialized_${freshId++}`;
        } while (names.has(name));
        names.add(name);
        return name;
    };
    const stats = {
        inputReads: 0,
        constants: 0,
        scalarLocals: 0,
        parameterWrappers: 0,
        staticDeclarations: 0,
        statelessFunctions: 0,
        directCalls: 0,
        deadHistories: 0,
        liftedDeclarations: 0,
    };
    transform(root, (n) => {
        if (
            n.type === 'CallExpression' &&
            path(n.callee) === '$._inputValue' &&
            n.arguments.length >= 3 &&
            n.arguments.slice(0, 3).every((x) => x.type === 'Literal') &&
            n.arguments.slice(3).every((x) => ['Identifier', 'Literal'].includes(x.type))
        ) {
            const [d, title, id] = n.arguments.map((x) => x.value),
                v = inputs[id] !== undefined ? inputs[id] : inputs[title] !== undefined ? inputs[title] : d;
            if (['string', 'number', 'boolean'].includes(typeof v) && !(typeof v === 'number' && !Number.isFinite(v))) {
                stats.inputReads++;
                return lit(v);
            }
        }
        return n;
    });
    // VIN-155: evaluate fixed scalar input calls through PineTS itself, including
    // named metadata that the original scalar-input pass could not resolve.
    const staticBindings = new Map();
    for (const statement of root.body.body)
        if (statement.type === 'VariableDeclaration' && statement.kind === 'const') {
            for (const d of statement.declarations) if (d.id.type === 'Identifier') staticBindings.set(d.id.name, d.init);
        }
    const unknown = Symbol('dynamic');
    let inputContext;
    const scalarInput = /^input\.(int|float|bool|string|time|timeframe|session|symbol|price|color)$/;
    function staticValue(n, seen = new Set()) {
        if (!n) return unknown;
        if (n.type === 'Literal') return n.value;
        if (n.type === 'Identifier') {
            if (n.name === 'undefined') return undefined;
            const init = staticBindings.get(n.name);
            if (!init || seen.has(n.name) || init.end > n.start) return unknown;
            return staticValue(init, new Set([...seen, n.name]));
        }
        if (n.type === 'UnaryExpression' && ['-', '+', '!'].includes(n.operator)) {
            const v = staticValue(n.argument, seen);
            if (v === unknown || (v !== null && !['number', 'boolean', 'string', 'undefined'].includes(typeof v))) return unknown;
            return n.operator === '-' ? -v : n.operator === '+' ? +v : !v;
        }
        if (n.type === 'ArrayExpression') {
            const values = n.elements.map((v) => staticValue(v, seen));
            return values.includes(unknown) ? unknown : values;
        }
        if (n.type === 'ObjectExpression') {
            const out = {};
            for (const p of n.properties) {
                if (p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method) return unknown;
                const v = staticValue(p.value, seen),
                    key = p.key.name ?? p.key.value;
                if (v === unknown || key === '__proto__') return unknown;
                out[key] = v;
            }
            return out;
        }
        if (n.type === 'CallExpression' && (path(n.callee) === 'input.param' || scalarInput.test(path(n.callee) || ''))) {
            const values = n.arguments.map((a) => staticValue(a, seen));
            if (values.includes(unknown)) return unknown;
            inputContext ??= new Context({ marketData: [], source: [], inputs });
            return inputContext.pine.input[n.callee.property.name](...values);
        }
        return unknown;
    }
    // Only root initializations are resolved; nested lexical bindings stay intact.
    for (const statement of root.body.body) {
        if (statement.type !== 'VariableDeclaration') continue;
        for (const d of statement.declarations) {
            if (!scalarInput.test(path(d.init?.callee) || '')) continue;
            const value = staticValue(d.init);
            if (!['number', 'boolean', 'string'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) continue;
            const replacement = { ...lit(value), start: d.init.start, end: d.init.end };
            d.init = replacement;
            staticBindings.set(d.id.name, replacement);
            stats.inputReads++;
        }
    }
    for (const statement of root.body.body) {
        const n = statement.expression;
        if (n?.type !== 'AssignmentExpression' || !['$.init', '$.initVar'].includes(path(n.right?.callee))) continue;
        const a = n.right.arguments[1];
        if (a?.type !== 'Identifier') continue;
        const value = staticValue(a);
        if (['number', 'boolean', 'string'].includes(typeof value) && !(typeof value === 'number' && !Number.isFinite(value)))
            n.right.arguments[1] = { ...lit(value), start: a.start, end: a.end };
    }
    // Known current-value namespace wrappers: their input Series is always a global context slot.
    transform(root, (n) => {
        if (
            n.type === 'CallExpression' &&
            /^(plot|plotshape|strategy|color|str|input|label)\.param$/.test(path(n.callee) || '') &&
            (n.arguments[1]?.name === 'undefined' || n.arguments[1]?.value === 0)
        ) {
            const a = n.arguments[0];
            if (/^\$\.(let|var|const)\./.test(path(a) || '')) {
                stats.parameterWrappers++;
                return {
                    type: 'CallExpression',
                    callee: {
                        type: 'MemberExpression',
                        object: {
                            type: 'Identifier',
                            name: '$',
                        },
                        property: {
                            type: 'Identifier',
                            name: 'get',
                        },
                        computed: false,
                    },
                    arguments: [a, lit(0)],
                    start: n.start,
                    end: n.end,
                };
            }
            if (a.type === 'Literal' && a.value !== null) {
                stats.parameterWrappers++;
                return a;
            }
        }
        return n;
    });
    // TA lengths are current-value arguments; TA source histories remain untouched.
    const lengths = {
        ema: [1],
        sma: [1],
        wma: [1],
        rma: [1],
        rsi: [1],
        atr: [0],
        dmi: [0, 1],
        macd: [1, 2, 3],
        change: [1],
    };
    const parameterBindings = new Map();
    walk(root, (n) => {
        if (
            n.type === 'VariableDeclarator' &&
            n.id.type === 'Identifier' &&
            path(n.init?.callee) === 'ta.param' &&
            (n.init.arguments[1]?.name === 'undefined' || n.init.arguments[1]?.value === 0)
        )
            parameterBindings.set(n.id.name, {
                node: n,
                uses: 0,
                unsafe: false,
            });
    });
    walk(root, (n, parent) => {
        if (n.type !== 'Identifier') return;
        const b = parameterBindings.get(n.name);
        if (!b || b.node.id === n) return;
        b.uses++;
        const name = path(parent?.callee);
        if (parent?.type !== 'CallExpression' || !name?.startsWith('ta.') || !lengths[name.slice(3)]?.includes(parent.arguments.indexOf(n)))
            b.unsafe = true;
    });
    for (const b of parameterBindings.values())
        if (b.uses && !b.unsafe) {
            const old = b.node.init;
            b.node.init = {
                type: 'CallExpression',
                callee: {
                    type: 'MemberExpression',
                    object: {
                        type: 'Identifier',
                        name: '$',
                    },
                    property: {
                        type: 'Identifier',
                        name: 'get',
                    },
                    computed: false,
                },
                arguments: [old.arguments[0], lit(0)],
                start: old.start,
                end: old.end,
            };
            stats.parameterWrappers++;
        }
    // Inputs assigned once syntactically, with no writes other than their initialization.
    const candidates = new Map();
    for (const statement of root.body.body) {
        const a = statement.expression,
            key = path(a?.left);
        if (
            a?.type === 'AssignmentExpression' &&
            /^\$\.(let|var)\./.test(key) &&
            a.right.type === 'CallExpression' &&
            ['$.init', '$.initVar'].includes(path(a.right.callee)) &&
            a.right.arguments[1]?.type === 'Literal' &&
            !(
                path(a.right.callee) === '$.initVar' &&
                typeof a.right.arguments[1].value === 'number' &&
                !Number.isFinite(Math.round(a.right.arguments[1].value * 1e10) / 1e10)
            )
        )
            candidates.set(key, {
                statement,
                value:
                    path(a.right.callee) === '$.initVar' && typeof a.right.arguments[1].value === 'number'
                        ? lit(Math.round(a.right.arguments[1].value * 1e10) / 1e10)
                        : a.right.arguments[1],
                writes: 0,
                unsafe: false,
                canFold: true,
            });
    }
    const plotCurrentReads = new WeakSet(),
        functionReads = new Set();
    const currentPlotOptions = new Set([
        'color',
        'linewidth',
        'style',
        'trackprice',
        'histbase',
        'offset',
        'join',
        'editable',
        'show_last',
        'display',
        'format',
        'precision',
        'force_overlay',
    ]);
    walk(root, (n) => {
        if (path(n.callee) === 'plot.param' && n.arguments[0]?.type === 'ObjectExpression')
            for (const p of n.arguments[0].properties) {
                if (p.type === 'Property' && !p.computed && currentPlotOptions.has(p.key.name ?? p.key.value) && candidates.has(path(p.value)))
                    plotCurrentReads.add(p.value);
            }
        if (n !== root && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type))
            walk(n, (x) => {
                const key = path(x);
                if (candidates.has(key)) functionReads.add(key);
            });
    });
    walk(root, (n, parent) => {
        const c = candidates.get(path(n));
        if (!c) return;
        if (parent?.type === 'AssignmentExpression' && parent.left === n) {
            c.writes++;
            return;
        }
        if (parent?.type === 'CallExpression' && ['$.init', '$.initVar'].includes(path(parent.callee)) && parent.arguments[0] === n) return;
        if (parent?.type === 'CallExpression' && path(parent.callee) === '$.get' && parent.arguments[0] === n && parent.arguments[1]?.value === 0) {
            if (n.start < c.statement.end) c.canFold = false;
            return;
        }
        c.unsafe = true;
        if (plotCurrentReads.has(n) && n.start > c.statement.end) return;
        if (
            !(
                parent?.type === 'CallExpression' &&
                (/^(ta|math|plot|plotshape|strategy|color|str|input)\.param$/.test(path(parent.callee) || '') || path(parent.callee) === '$.get')
            )
        )
            c.canFold = false;
    });
    let firstUserCall = Infinity;
    for (const statement of root.body.body) {
        if (statement.type === 'FunctionDeclaration') continue;
        walk(statement, (n) => {
            if (n.type === 'CallExpression' && path(n.callee) === '$.call' && n.start !== undefined) firstUserCall = Math.min(firstUserCall, n.start);
        });
    }
    for (const [key, c] of candidates) if (firstUserCall < c.statement.end && functionReads.has(key)) c.canFold = false;
    // Replace current-value reads even when history still requires retaining the input series.
    transform(root, (n) => {
        if (plotCurrentReads.has(n)) {
            const c = candidates.get(path(n));
            if (c?.writes === 1 && c.canFold) {
                stats.constants++;
                return structuredClone(c.value);
            }
        }
        if (n.type === 'CallExpression' && path(n.callee) === '$.get' && n.arguments[1]?.value === 0) {
            const c = candidates.get(path(n.arguments[0]));
            if (c && c.writes === 1 && c.canFold) {
                stats.constants++;
                return structuredClone(c.value);
            }
        }
        return n;
    });
    for (const c of candidates.values())
        if (c.writes === 1 && !c.unsafe && c.canFold) root.body.body = root.body.body.filter((s) => s !== c.statement);
    foldLiteralOperations(root);
    // A literal strategy declaration has no per-bar changes to merge into config.
    const bindings = new Map();
    for (const statement of root.body.body)
        if (statement.type === 'VariableDeclaration' && statement.kind === 'const')
            for (const d of statement.declarations) if (d.id.type === 'Identifier') bindings.set(d.id.name, d.init);
    function stable(n, seen = new Set()) {
        if (!n) return false;
        if (n.type === 'Literal') return true;
        if (n.type === 'Identifier') {
            if (n.name === 'undefined') return true;
            if (seen.has(n.name) || !bindings.has(n.name)) return false;
            return stable(bindings.get(n.name), new Set([...seen, n.name]));
        }
        if (n.type === 'ObjectExpression') return n.properties.every((p) => p.type === 'Property' && !p.computed && stable(p.value, seen));
        if (n.type === 'ArrayExpression') return n.elements.every((e) => stable(e, seen));
        if (n.type === 'UnaryExpression') return stable(n.argument, seen);
        if (n.type === 'MemberExpression' && !n.computed) return stable(n.object, seen);
        if (n.type === 'CallExpression') {
            const name = path(n.callee);
            if (name === 'strategy.param') return n.arguments.every((a) => stable(a, seen));
            if (/^strategy\.(percent_of_equity|fixed|cash|commission|long|short|direction)$/.test(name || '') && n.arguments.length === 0)
                return true;
        }
        return false;
    }
    const earlierEffects = [];
    walk(root, (n) => {
        if (n.type !== 'CallExpression') return;
        const name = path(n.callee);
        if (
            name === '$.call' ||
            (name?.startsWith('strategy.') && !/^strategy\.(any|param|percent_of_equity|fixed|cash|commission|long|short|direction)$/.test(name))
        )
            earlierEffects.push(n.start);
    });
    transform(root, (n) => {
        if (
            n.type === 'CallExpression' &&
            path(n.callee) === 'strategy.any' &&
            !earlierEffects.some((start) => start < n.start) &&
            n.arguments.every((a) => stable(a))
        ) {
            stats.staticDeclarations++;
            return {
                type: 'ConditionalExpression',
                test: parse('$.strategy', {
                    ecmaVersion: 'latest',
                }).body[0].expression,
                consequent: parse('$.strategy.config', {
                    ecmaVersion: 'latest',
                }).body[0].expression,
                alternate: n,
            };
        }
        return n;
    });
    for (let pass = 0; pass < 2; pass++) {
        const uses = new Map();
        walk(root, (n) => {
            if (n.type === 'Identifier') uses.set(n.name, (uses.get(n.name) || 0) + 1);
        });
        root.body.body = root.body.body.filter((s) => {
            if (s.type !== 'VariableDeclaration' || s.declarations.length !== 1) return true;
            const d = s.declarations[0];
            return !(uses.get(d.id.name) === 1 && stable(d.init));
        });
    }
    // Move the statically proven declaration's construction to the first bar as well.
    for (const statement of [...root.body.body]) {
        const d = statement.type === 'VariableDeclaration' && statement.declarations.length === 1 ? statement.declarations[0] : null;
        if (!d || d.init?.type !== 'ConditionalExpression' || path(d.init.alternate?.callee) !== 'strategy.any') continue;
        const dependencies = new Set();
        function collect(n) {
            walk(n, (x) => {
                if (x.type === 'Identifier' && bindings.has(x.name) && !dependencies.has(x.name)) {
                    dependencies.add(x.name);
                    collect(bindings.get(x.name));
                }
            });
        }
        collect(d.init.alternate);
        const moved = root.body.body.filter(
            (s) => s.type === 'VariableDeclaration' && s.declarations.length === 1 && dependencies.has(s.declarations[0].id.name),
        );
        if (moved.length !== dependencies.size || moved.some((s) => root.body.body.indexOf(s) > root.body.body.indexOf(statement))) continue;
        const discard = root.body.body.filter(
            (s) => s.type === 'ExpressionStatement' && s.expression.type === 'Identifier' && s.expression.name === d.id.name,
        );
        let safe = true;
        for (const s of root.body.body) {
            if (s === statement || moved.includes(s) || discard.includes(s)) continue;
            walk(s, (n) => {
                if (n.type === 'Identifier' && (dependencies.has(n.name) || n.name === d.id.name)) safe = false;
            });
        }
        if (!safe) continue;
        const replacement = {
            type: 'IfStatement',
            test: {
                type: 'UnaryExpression',
                operator: '!',
                prefix: true,
                argument: d.init.test,
            },
            consequent: {
                type: 'BlockStatement',
                body: [
                    ...moved,
                    {
                        type: 'ExpressionStatement',
                        expression: d.init.alternate,
                    },
                ],
            },
            alternate: null,
        };
        root.body.body = root.body.body.filter((s) => !moved.includes(s) && !discard.includes(s)).map((s) => (s === statement ? replacement : s));
        stats.liftedDeclarations++;
    }
    // Root-level, once-assigned values consumed exclusively at offset zero need no history.
    const parents = new WeakMap();
    walk(root, (n, p) => parents.set(n, p));
    const nested = (n) => {
        for (let p = parents.get(n); p && p !== root; p = parents.get(p))
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(p.type)) return true;
        return false;
    };
    const locals = new Map();
    for (const statement of root.body.body) {
        const a = statement.expression,
            key = path(a?.left);
        if (a?.type === 'AssignmentExpression' && /^\$\.let\./.test(key) && path(a.right?.callee) === '$.init' && a.right.arguments.length === 2)
            locals.set(key, {
                statement,
                assignment: a,
                writes: 0,
                unsafe: false,
            });
    }
    walk(root, (n, parent) => {
        const c = locals.get(path(n));
        if (!c) return;
        if (parent?.type === 'AssignmentExpression' && parent.left === n) {
            c.writes++;
            return;
        }
        if (parent?.type === 'CallExpression' && path(parent.callee) === '$.init' && parent.arguments[0] === n) return;
        if (
            parent?.type === 'CallExpression' &&
            path(parent.callee) === '$.get' &&
            parent.arguments[0] === n &&
            parent.arguments[1]?.value === 0 &&
            n.start > c.assignment.end &&
            !nested(n)
        )
            return;
        c.unsafe = true;
    });
    const initializers = new Map();
    for (const statement of root.body.body) {
        const a = statement.expression;
        if (a?.type === 'AssignmentExpression' && path(a.right?.callee) === '$.init') initializers.set(path(a.left), a.right.arguments[1]);
    }
    const scalarNames = new Set();
    function scalar(n, seen = new Set()) {
        if (!n) return false;
        if (n.type === 'Literal') return true;
        if (n.type === 'Identifier') {
            if (scalarNames.has(n.name)) return true;
            if (seen.has(n.name) || !bindings.has(n.name)) return false;
            return scalar(bindings.get(n.name), new Set([...seen, n.name]));
        }
        if (['BinaryExpression', 'UnaryExpression'].includes(n.type)) return true;
        if (n.type === 'LogicalExpression') return scalar(n.left, seen) && scalar(n.right, seen);
        if (
            n.type === 'CallExpression' &&
            ['$.pine.math.__eq', '$.pine.math.__neq'].includes(path(n.callee)) &&
            n.arguments.length === 2 &&
            n.arguments.every((a) => a.type === 'Literal' && ['string', 'boolean'].includes(typeof a.value)) &&
            typeof n.arguments[0].value === typeof n.arguments[1].value
        ) {
            const equal = n.arguments[0].value === n.arguments[1].value;
            return lit(path(n.callee).endsWith('__eq') ? equal : !equal);
        }
        if (n.type === 'UnaryExpression' && n.operator === '!' && n.argument.type === 'Literal') return lit(!n.argument.value);
        if (n.type === 'LogicalExpression' && n.left.type === 'Literal') {
            if (n.operator === '&&') return n.left.value ? n.right : n.left;
            if (n.operator === '||') return n.left.value ? n.left : n.right;
        }
        if (n.type === 'ConditionalExpression') return scalar(n.consequent, seen) && scalar(n.alternate, seen);
        if (n.type === 'CallExpression') {
            const name = path(n.callee);
            if (
                /^(ta\.(ema|atr|rsi|sma|wma|rma|change|crossover|crossunder)|math\.(abs|max|min|round|floor|ceil|sqrt|pow|log|exp)|\$\.pine\.math\.__(gt|lt|ge|le|eq|neq)|strategy\.(equity|position_size|position_avg_price))$/.test(
                    name || '',
                )
            )
                return true;
            if (name === '$.get' && n.arguments[1]?.value === 0) {
                const key = path(n.arguments[0]),
                    c = locals.get(key);
                if (c && c.writes === 1 && !c.unsafe && !seen.has(key)) return scalar(initializers.get(key), new Set([...seen, key]));
            }
        }
        return false;
    }
    for (const [key, c] of locals)
        if (c.writes === 1 && !c.unsafe && scalar(c.assignment.right.arguments[1])) {
            c.name = fresh();
            stats.scalarLocals++;
            scalarNames.add(c.name);
            transform(root, (n) =>
                n.type === 'CallExpression' && path(n.callee) === '$.get' && path(n.arguments[0]) === key
                    ? {
                          type: 'Identifier',
                          name: c.name,
                      }
                    : n,
            );
            const pos = root.body.body.indexOf(c.statement);
            root.body.body[pos] = {
                type: 'VariableDeclaration',
                kind: 'const',
                declarations: [
                    {
                        type: 'VariableDeclarator',
                        id: {
                            type: 'Identifier',
                            name: c.name,
                        },
                        init: c.assignment.right.arguments[1],
                    },
                ],
            };
        }
    // Function-local current-only results can be ordinary locals too.
    const functions = root.body.body.filter((n) => n.type === 'FunctionDeclaration'),
        pureFunctions = new Set();
    for (const f of functions) {
        const ctx = f.body.body.find(
            (n) => n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id.name === '$$' && path(d.init?.callee) === '$.peekCtx'),
        );
        if (!ctx) continue;
        transform(f.body, (n) =>
            n.type === 'CallExpression' && path(n.callee) === '$.get' && n.arguments[0]?.name === '$$' && n.arguments[1]?.value === 0
                ? n.arguments[0]
                : n,
        );
        for (const statement of [...f.body.body]) {
            const a = statement.expression,
                key = path(a?.left);
            if (
                a?.type !== 'AssignmentExpression' ||
                !/^\$\$\.let\./.test(key) ||
                path(a.right?.callee) !== '$.init' ||
                !scalar(a.right.arguments[1])
            )
                continue;
            let safe = true,
                writes = 0;
            walk(f.body, (n, p) => {
                if (path(n) !== key) return;
                if (p?.type === 'AssignmentExpression' && p.left === n) {
                    writes++;
                    return;
                }
                if (p?.type === 'CallExpression' && path(p.callee) === '$.init' && p.arguments[0] === n) return;
                if (
                    p?.type === 'CallExpression' &&
                    path(p.callee) === '$.get' &&
                    p.arguments[0] === n &&
                    p.arguments[1]?.value === 0 &&
                    n.start > a.end
                )
                    return;
                safe = false;
            });
            if (!safe || writes !== 1) continue;
            const name = fresh();
            stats.scalarLocals++;
            transform(f.body, (n) =>
                n.type === 'CallExpression' && path(n.callee) === '$.get' && path(n.arguments[0]) === key
                    ? {
                          type: 'Identifier',
                          name,
                      }
                    : n,
            );
            f.body.body[f.body.body.indexOf(statement)] = {
                type: 'VariableDeclaration',
                kind: 'const',
                declarations: [
                    {
                        type: 'VariableDeclarator',
                        id: {
                            type: 'Identifier',
                            name,
                        },
                        init: a.right.arguments[1],
                    },
                ],
            };
        }
        let uses = 0;
        walk(f.body, (n) => {
            if (n.type === 'Identifier' && n.name === '$$') uses++;
        });
        if (uses === 1) f.body.body = f.body.body.filter((n) => n !== ctx);
    }
    for (let pass = 0; pass < functions.length; pass++) {
        for (const f of functions) {
            if (pureFunctions.has(f.id.name)) continue;
            let pure = true;
            walk(f, (n) => {
                if (n.type === 'AssignmentExpression' || n.type === 'UpdateExpression' || n.type === 'AwaitExpression' || n.type === 'NewExpression')
                    pure = false;
                if (
                    n.type === 'CallExpression' &&
                    !['$.get', '$.precision'].includes(path(n.callee)) &&
                    !/^\$\.pine\.math\.__(gt|lt|ge|le|eq|neq)$/.test(path(n.callee) || '') &&
                    !pureFunctions.has(path(n.callee))
                )
                    pure = false;
            });
            if (pure) {
                pureFunctions.add(f.id.name);
                stats.statelessFunctions++;
            }
        }
        transform(root, (n) => {
            if (n.type === 'CallExpression' && path(n.callee) === '$.call') {
                let fn = n.arguments[0];
                if (path(fn?.callee) === '$.get' && fn.arguments[1]?.value === 0) fn = fn.arguments[0];
                if (fn.type === 'Identifier' && pureFunctions.has(fn.name)) {
                    stats.directCalls++;
                    return {
                        type: 'CallExpression',
                        callee: fn,
                        arguments: n.arguments.slice(2),
                        start: n.start,
                        end: n.end,
                    };
                }
            }
            return n;
        });
    }
    // Parameter histories are unnecessary at calls to functions that only read offset zero.
    const currentOnly = new Map();
    for (const f of functions) {
        const safe = f.params.map((param) => {
            if (param.type !== 'Identifier') return false;
            let ok = true;
            walk(f.body, (n, p) => {
                if (
                    n.type === 'Identifier' &&
                    n.name === param.name &&
                    !(p?.type === 'CallExpression' && path(p.callee) === '$.get' && p.arguments[0] === n && p.arguments[1]?.value === 0)
                )
                    ok = false;
            });
            return ok;
        });
        currentOnly.set(f.id.name, safe);
    }
    const directParams = new Map();
    walk(root, (n) => {
        if (n.type === 'VariableDeclarator' && path(n.init?.callee) === '$.param' && n.init.arguments[1]?.name === 'undefined')
            directParams.set(n.id.name, {
                node: n,
                uses: 0,
                safe: true,
            });
    });
    walk(root, (n, p) => {
        if (n.type !== 'Identifier') return;
        const b = directParams.get(n.name);
        if (!b || b.node.id === n) return;
        b.uses++;
        if (
            p?.type !== 'CallExpression' ||
            !pureFunctions.has(path(p.callee)) ||
            !p.arguments.includes(n) ||
            !currentOnly.get(path(p.callee))?.[p.arguments.indexOf(n)]
        )
            b.safe = false;
    });
    for (const b of directParams.values())
        if (b.safe && b.uses) {
            b.node.init = b.node.init.arguments[0];
            stats.parameterWrappers++;
        }
    const inert = (n) =>
        n &&
        (n.type === 'Literal' ||
            n.type === 'Identifier' ||
            (n.type === 'MemberExpression' && !n.computed && /^\$\.(let|var|const)\./.test(path(n) || '')) ||
            (n.type === 'ArrayExpression' && n.elements.every(inert)) ||
            (n.type === 'ObjectExpression' && n.properties.every((p) => p.type === 'Property' && !p.computed && inert(p.value))) ||
            (n.type === 'CallExpression' && path(n.callee) === '$.get' && n.arguments.every(inert)));
    for (let pass = 0; pass < 4; pass++) {
        const counts = new Map();
        walk(root, (n) => {
            if (n.type === 'Identifier') counts.set(n.name, (counts.get(n.name) || 0) + 1);
        });
        transform(root, (n) => {
            if (n.type === 'VariableDeclaration' && n.declarations.length === 1) {
                const d = n.declarations[0];
                if (counts.get(d.id.name) === 1 && path(d.init?.callee) === 'input.param' && d.init.arguments.every(inert))
                    return {
                        type: 'EmptyStatement',
                    };
            }
            return n;
        });
    }
    // Drop unread history slots, but retain indicator calls and their state updates.
    const readOnly = (n) =>
        n &&
        (n.type === 'Literal' ||
            n.type === 'Identifier' ||
            (n.type === 'MemberExpression' && !n.computed && /^\$\.(let|var|const)\./.test(path(n) || '')) ||
            (n.type === 'CallExpression' && path(n.callee) === '$.get' && n.arguments.every(readOnly)));
    for (let pass = 0; pass < 4; pass++) {
        const counts = new Map();
        walk(root, (n) => {
            const key = path(n);
            if (key) counts.set(key, (counts.get(key) || 0) + 1);
        });
        transform(root, (n) => {
            const a = n.expression,
                key = path(a?.left);
            if (
                n.type === 'ExpressionStatement' &&
                a?.type === 'AssignmentExpression' &&
                /^\$\.let\./.test(key || '') &&
                path(a.right?.callee) === '$.init' &&
                path(a.right.arguments[0]) === key &&
                counts.get(key) === 2 &&
                readOnly(a.right.arguments[1])
            ) {
                stats.deadHistories++;
                return {
                    type: 'EmptyStatement',
                };
            }
            return n;
        });
    }
    const plotFactory = fresh();
    specializeFixedPlots(root, stats, fresh, scalar, plotFactory);
    const code = generate(root),
        fn = Function(plotFactory, `return (${code})`)(makePlot);
    Object.assign(fn, original);
    return {
        fn,
        stats,
        code,
    };
}
export class Indicator extends BaseIndicator {
    prepare(opts) {
        const p = super.prepare(opts);
        if (this.__sourcePrepared !== p) {
            this.__sourcePrepared = p;
            const s = specialize(p.fn, p.inputs);
            this.__optimized = {
                ...p,
                fn: s.fn,
            };
            this.specialization = s;
        }
        return this.__optimized;
    }
}
