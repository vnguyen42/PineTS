// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * PineTS Transpiler
 *
 * What is PineTS ?
 * -----------------
 * PineTS is an open-source intermediate language designed to bridge the gap between Pine Script and JavaScript.
 * It provides a way to simulate Pine Script-like behavior in a JavaScript environment by representing Pine Script code
 * in a JavaScript-compatible format.
 *
 * Important Notes:
 * -----------------
 * 1. **Independence from Pine Script**: PineTS is not officially affiliated with, endorsed by, or associated with TradingView or Pine Script.
 *    It is an independent open-source initiative created to enable developers to replicate Pine Script indicators in JavaScript environments.
 * 2. **Purpose**: PineTS uses JavaScript syntax and semantics but should not be confused with standard JavaScript code.
 *    It acts as a representation of Pine Script logic that requires transpilation to be executed in JavaScript.
 * 3. **Open Source**: This project is developed and maintained as an open-source initiative. It is intended to serve as a tool for
 *    developers to bridge Pine Script concepts into JavaScript applications.
 *
 * What Does PineTS Transpiler Do?
 * --------------------------------
 * PineTS cannot be executed directly in a JavaScript environment. It requires transpilation into standard JavaScript to handle
 * Pine Script's unique time-series data processing. The PineTS Transpiler facilitates this process by transforming PineTS code
 * into executable JavaScript at runtime, making it possible to execute Pine Script-inspired logic in JavaScript applications.
 *
 * Key Features of the Transpiler:
 * --------------------------------
 * 1. **Context Management**: Transforms code to use a context object (`$`) for variable storage, ensuring all variables are
 *    accessed through this context to prevent scope conflicts.
 * 2. **Variable Scoping**: Renames variables based on their scope and declaration type (`const`, `let`, `var`) to avoid naming issues.
 * 3. **Function Handling**: Converts arrow functions while maintaining parameters and logic. Parameters are registered in the context
 *    to prevent accidental renaming.
 * 4. **Loop and Conditional Handling**: Adjusts loops and conditionals to ensure proper scoping and handling of variables.
 *
 * Usage:
 * -------
 * - The `transpile` function takes a JavaScript function or code string, applies transformations, and returns the transformed
 *   code or function.
 * - The transformed code uses a context object (`$`) to manage variable storage and access.
 *
 * Disclaimer:
 * -----------
 * PineTS is independently developed and is not endorsed by or affiliated with TradingView, the creators of Pine Script. All
 * trademarks and registered trademarks mentioned belong to their respective owners.
 */

import * as acorn from 'acorn';
import * as astring from 'astring';
import ScopeManager from './analysis/ScopeManager';
import { injectImplicitImports } from './transformers/InjectionTransformer';
import { normalizeNativeImports } from './transformers/NormalizationTransformer';
import { wrapInContextFunction } from './transformers/WrapperTransformer';
import { transformNestedArrowFunctions, preProcessContextBoundVars, preProcessUdtRegistry, runAnalysisPass, renameMethodVariants, renameFunctionArityVariants } from './analysis/AnalysisPass';
import { runTypeInferencePass } from './analysis/TypeInferencePass';
import { runTransformationPass, transformEqualityChecks, propagateAsyncAwait } from './transformers/MainTransformer';
import { extractPineScriptVersion, pineToJS } from './pineToJS/pineToJS.index';
import { buildLtfSlices } from './slicing/buildLtfSlices';

function getPineTSFromSource(source: string | Function): string {
    if (typeof source === 'function') {
        return source.toString();
    }

    const pineScriptVersion = extractPineScriptVersion(source);
    if (pineScriptVersion === null) {
        // Assume version-less source is PineTS syntax and parse it as-is first.
        return source;
    }
    if (pineScriptVersion >= 4) {
        // Version 4 is accepted and lowered to the v5 builtin model inside
        // pineToJS (v4LegacyLowering) — v4 sources take the exact same
        // pipeline as v5, plus the version-gated legacy rewriting.
        const pineToJSResult = pineToJS(source);
        if (pineToJSResult.success) return pineToJSResult.code;
        throw new Error(`Failed to transpile Pine Script version ${pineScriptVersion}: ${pineToJSResult.error}`);
    }
    throw new Error(`Unsupported Pine Script version ${pineScriptVersion}. Only version 4 and above are supported.`);
}

export interface ParsedTranspilerSource {
    code: string;
    ast: acorn.Program;
    pineVersion: number | null;
    // True only when a version-less source required the Pine v5 parser retry.
    // This is distinct from `pineVersion`: the retry's legacy helpers are
    // enabled, while version-less division must remain native.
    versionlessFallback: boolean;
}

/**
 * Classify and parse source exactly once for every consumer of the
 * transpiler. Version-less strings are tried as PineTS/JS first and only
 * fall back to Pine v5 when that wrapped JavaScript parse fails.
 */
export function parseSourceForTranspilation(source: string | Function, debug = false): ParsedTranspilerSource {
    let pineVersion = typeof source === 'string' ? extractPineScriptVersion(source) : null;
    let code = wrapInContextFunction(getPineTSFromSource(source));

    try {
        const ast = acorn.parse(code, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            locations: debug,
        });
        return { code, ast, pineVersion, versionlessFallback: false };
    } catch (jsParseError) {
        if (typeof source !== 'string' || extractPineScriptVersion(source) !== null) throw jsParseError;

        const pineResult = pineToJS(source, { forceVersion: 5 });
        if (!pineResult.success) {
            throw new Error(`Failed to transpile Pine Script (assumed version 5): ${pineResult.error}`);
        }
        // The parser retry assumes v5 syntax, while runtime compatibility
        // uses the v4 builtin/argument model. Keep the explicit fallback
        // marker so type inference can leave version-less division native.
        pineVersion = 4;
        code = wrapInContextFunction(pineResult.code);
        const ast = acorn.parse(code, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            locations: debug,
        });
        return { code, ast, pineVersion, versionlessFallback: true };
    }
}

export function transpile(source: string | Function, options: { debug: boolean; ln?: boolean } = { debug: false, ln: false }): Function {
    // Handle backward compatibility if a boolean is passed (though signature changed)
    if (typeof options === 'boolean') {
        options = { debug: options, ln: true };
    }

    const { debug } = options;
    const { code, ast, pineVersion, versionlessFallback } = parseSourceForTranspilation(source, debug);
    const sourceLines = debug ? code.split('\n') : [];

    // Pre-process: Transform all nested arrow functions
    transformNestedArrowFunctions(ast);

    // Pre-process: Normalize native imports (prevent renaming of standard symbols)
    normalizeNativeImports(ast);

    // Pre-process: Inject implicit imports for missing context variables
    injectImplicitImports(ast, pineVersion, versionlessFallback);

    const scopeManager = new ScopeManager();

    // Pre-process: Identify context-bound variables
    preProcessContextBoundVars(ast, scopeManager);

    // Pre-process: Build the UDT registry (type names + their field maps,
    // and user variables that hold UDT instances). Enables type-aware
    // rewrites at use sites — e.g. distinguishing Pine series-lookback
    // (`bar.field[N]` on a UDT instance) from JS array indexing.
    preProcessUdtRegistry(ast, scopeManager);

    // First pass: register all function declarations and their parameters
    // Returns the original parameter name of the root function if any
    const originalParamName = runAnalysisPass(ast, scopeManager) || '';

    // Rename receiver-type overloads of Pine methods to unique bindings
    // (`$M_init_Schema`, `$M_init_Datagram`, …) and register the variants,
    // so the dispatcher emitted below routes by receiver type. Must run
    // after the analysis pass (which reads the original `$M_` names).
    renameMethodVariants(ast, scopeManager);

    // Rename arity overloads of regular Pine functions to unique bindings
    // (`<name>_$ov0`, `<name>_$ov1`, …) and register the variants, so the
    // dispatcher emitted below routes by `arguments.length`. Must run after
    // the analysis pass (which reads the original names) and after
    // `renameMethodVariants` (which pairs `$M_` declarations with their
    // param-type markers). The original Pine name is preserved on
    // `id.__pineName`, so name-keyed consumers (async propagation, LTF
    // slicing) keep collapsing the variants onto the Pine name.
    renameFunctionArityVariants(ast, scopeManager);

    // Type inference: Pine v4/v5 truncate only division of two provably-const
    // integer expressions. v6 and version-less sources keep native `/`; the
    // version-less fallback carries v4 runtime compatibility separately.
    // The pass runs on the clean pre-lowering AST (operands still bare
    // identifiers / `input.int(...)` / literals); the main pass then lowers
    // operand subtrees inside any emitted helper call.
    runTypeInferencePass(ast, scopeManager, pineVersion, versionlessFallback);

    // Second pass: transform the code
    runTransformationPass(ast, scopeManager, originalParamName, options, sourceLines);

    // Post-process: transform equality checks to math.__eq calls
    transformEqualityChecks(ast);

    // Post-process: propagate async/await through user-defined function call chains
    // Functions containing await (e.g., from request.security) must be async,
    // and their callers (via $.call) must await them.
    propagateAsyncAwait(ast);

    // Emit per-name method dispatchers. Every `$M_<name>` call site resolves
    // through the dispatcher, which selects the receiver-type variant at
    // runtime from the instance's UDT factory identity (`_udt`). The
    // dispatcher is bound BEFORE the method markers (`$M_init.__pineMethod__`)
    // run, so those inert markers land on the dispatcher without a
    // ReferenceError; unmatched receivers fall back to the plain `$M_<name>`
    // binding (last declared, preserving pre-overload behavior for methods
    // whose receiver type was not renamed).
    injectMethodDispatchers(ast, scopeManager);

    // Emit per-name function-arity dispatchers. Every call site of an
    // overloaded Pine function (`$.call(g, …)`) resolves through the
    // dispatcher, which selects the variant by `arguments.length` — exact
    // arity first, then the last declared variant whose range contains the
    // arity, then the last declared variant as fallback (preserving
    // last-wins for ambiguous / out-of-range calls). Same-arity (type-based)
    // overloads stay last-wins: the dispatcher checks variants in reverse
    // declaration order, so the last declared variant wins ties. The
    // dispatcher is bound BEFORE the inert `__pineParamTypes__` markers run
    // (they land on the dispatcher without a ReferenceError, mirroring the
    // method dispatchers).
    injectFunctionDispatchers(ast, scopeManager);

    // Post-process: inject __maxLoops local variable at the top of the function body.
    // This caches $.__maxLoops (from Context) in a local variable so loop guards
    // don't access the context object on every iteration. Falls back to 500000.
    if (ast.type === 'Program' && ast.body.length > 0) {
        const firstStmt = ast.body[0] as any;
        const fn = firstStmt?.expression || firstStmt;
        if (fn.body?.type === 'BlockStatement') {
            fn.body.body.unshift({
                type: 'VariableDeclaration',
                kind: 'const',
                declarations: [{
                    type: 'VariableDeclarator',
                    id: { type: 'Identifier', name: '__maxLoops' },
                    init: {
                        type: 'LogicalExpression',
                        operator: '||',
                        left: {
                            type: 'MemberExpression',
                            object: { type: 'Identifier', name: '$' },
                            property: { type: 'Identifier', name: '__maxLoops' },
                            computed: false,
                        },
                        right: { type: 'Literal', value: 500000 },
                    },
                }],
            });
        }
    }

    // Generate final code
    // astring exports baseGenerator (camelCase) in this version/build
    const baseGenerator = astring.baseGenerator || astring.GENERATOR || ((astring as any).default && (astring as any).default.BASE_GENERATOR);

    const customGenerator = Object.assign({}, baseGenerator, {
        LineComment(node: any, state: any) {
            state.write('//' + node.value);
        },
    });

    const transformedCode = astring.generate(ast, {
        generator: customGenerator,
        comments: debug,
    });

    // Slice every `request.security_lower_tf` call site. Each slice is a
    // pre-built async Function whose body is the user-script prefix up
    // through and including the call. Stashed on the returned function
    // (PineTS picks them up at run time and propagates onto the
    // Context). Slicing is read-only over the AST and is safe to do
    // alongside / after the main code-generation pass.
    //
    // Disabled via the PINETS_DISABLE_LTF_SLICING env var (used in
    // tooling that needs to exercise the legacy full-script slow path,
    // e.g. correctness comparisons).
    const slicingDisabled = (typeof process !== 'undefined') && process?.env?.PINETS_DISABLE_LTF_SLICING === '1';
    const slices = slicingDisabled ? {} : buildLtfSlices(ast, pineVersion);

    const _wraperFunction = new Function('', `var _r = ${transformedCode}\n; return _r;`);
    const mainFn = _wraperFunction(this);
    if (slices && Object.keys(slices).length > 0) {
        (mainFn as any)._ltfSlices = slices;
    }
    (mainFn as Function & { _strategyHistorySeries?: string[] })._strategyHistorySeries = scopeManager.getStrategyHistorySeries();
    (mainFn as Function & { _pineVersion: number | null })._pineVersion = pineVersion;
    return mainFn;
}

/**
 * Emit a runtime dispatcher for every Pine method that has receiver-type
 * variants (registered by `renameMethodVariants`). The dispatcher selects
 * the per-type variant by comparing the receiver's UDT factory name
 * (`__pineName`) against the registered receiver types as plain strings:
 *
 *   var $M_init = (function (_fallback) {
 *     return function (self) {
 *       var inst = self != null ? $.get(self, 0) : self;
 *       var t = inst && inst._udt && inst._udt.__pineName;
 *       if (t === 'WordDesc') return $M_init_WordDesc.apply(null, arguments);
 *       ...
 *       if (_fallback) return _fallback.apply(null, arguments);
 *       if (!t && inst != null && typeof inst.init === 'function')
 *           return inst.init.apply(inst, Array.prototype.slice.call(arguments, 1));
 *       throw new Error(...);
 *     };
 *   })($M_init);
 *
 * The receiver can arrive either as a Series wrapper (a UDT variable held as
 * a time series) or as the bare UDT instance (call sites that already lowered
 * the receiver through `$.get`). `$.get(self, 0)` is the runtime's canonical
 * `instanceof Series`-based unwrap — the same discrimination every other
 * generated call site uses — so only genuine Series wrappers are unwrapped;
 * a UDT instance that merely has an array-typed field (e.g. `data`) passes
 * through untouched and dispatches on its own `_udt.__pineName`.
 *
 * The dispatcher statement is PREPENDED to the wrapped context function so
 * the inert `$M_init.__pineMethod__ / __pineParamTypes__` markers (which
 * follow each declaration) bind to the dispatcher without a ReferenceError.
 *
 * Receivers that match no registered variant fall back in order:
 *   1. the plain `$M_init` binding captured by the IIFE (last declared
 *      non-renamed variant — preserves pre-overload behavior for methods
 *      whose receiver type was not renamed);
 *   2. the receiver's own builtin method of the same name, when the receiver
 *      is NOT a UDT instance (`t` undefined) and such a method exists — e.g.
 *      `this.ln.delete()` inside a user method body is retargeted here with
 *      a native Line receiver and must invoke the builtin `line.delete`,
 *      never an undefined binding;
 *   3. an explicit error for genuinely unknown receivers (UDT instances
 *      whose type matches no variant, or receivers without the builtin),
 *      preserving the iteration-5 guard against silent no-ops.
 */
function injectMethodDispatchers(ast: any, scopeManager: ScopeManager): void {
    const program = ast.body?.[0]?.expression?.body;
    if (!program || program.type !== 'BlockStatement' || !Array.isArray(program.body)) return;

    const variants = scopeManager.getMethodVariants();
    if (variants.length === 0) return;

    const lines: string[] = [];
    for (const [pineName, list] of variants) {
        const dispatchName = `$M_${pineName}`;
        const checks = list.map((v) =>
            `if (t === '${v.receiverType}') return ${v.jsName}.apply(null, arguments);`);
        lines.push(`var ${dispatchName} = (function (_fallback) {
  return function (self) {
    var inst = self != null ? $.get(self, 0) : self;
    var t = inst && inst._udt && inst._udt.__pineName;
    ${checks.join('\n    ')}
    if (_fallback) return _fallback.apply(null, arguments);
    if (!t && inst != null && typeof inst.${pineName} === 'function') return inst.${pineName}.apply(inst, Array.prototype.slice.call(arguments, 1));
    throw new Error("PineTS: no overload of method '${pineName}' for receiver type " + String(t));
  };
})(${dispatchName});`);
    }

    const parsed = acorn.parse(lines.join('\n'), { ecmaVersion: 'latest' }) as any;
    program.body.unshift(...parsed.body);
}

/**
 * Emit a runtime dispatcher for every Pine function that has arity variants
 * (registered by `renameFunctionArityVariants`). The dispatcher selects the
 * variant by `arguments.length`:
 *
 *   var smooth = (function (_fallback) {
 *     return function () {
 *       var n = arguments.length;
 *       if (n === 5) return smooth_$ov1.apply(null, arguments);  // exact (reverse decl order)
 *       if (n === 6) return smooth_$ov0.apply(null, arguments);
 *       if (n >= 0 && n <= 5) return smooth_$ov1.apply(null, arguments);  // range (reverse)
 *       if (n >= 1 && n <= 6) return smooth_$ov0.apply(null, arguments);
 *       if (_fallback) return _fallback.apply(null, arguments);
 *       throw new Error("PineTS: no overload of function 'smooth' for " + n + " argument(s)");
 *     };
 *   })(smooth_$ov1);
 *
 * Resolution rule (TradingView's exact tie-break beyond "count or types" is
 * undocumented — nothing is invented for ambiguous calls):
 *   1. EXACT arity first: a call whose arg count equals a variant's total
 *      param count goes to that variant. Checks run in REVERSE declaration
 *      order, so same-arity (type-based) overloads keep JS last-wins.
 *   2. Otherwise the LAST declared variant whose [minArgs..maxArgs] contains
 *      the arg count (reverse declaration order again — the last compatible
 *      variant wins).
 *   3. Fallback: the last declared variant (captured by the IIFE), exactly
 *      preserving pre-dispatcher last-wins behavior for out-of-range calls.
 *
 * Named args on OVERLOADED user functions are currently DROPPED at pineToJS
 * codegen (functionParams is keyed by the renamed `<name>_$ov<i>` while call
 * sites still use `<name>` — pre-existing limitation, identical to 0.9.31),
 * so the dispatcher only ever sees positional
 * arity. The dispatcher statement is PREPENDED to the wrapped context
 * function so the inert `__pineParamTypes__` markers (which follow each
 * declaration) bind to the dispatcher without a ReferenceError — mirroring
 * the method dispatchers.
 */
function injectFunctionDispatchers(ast: any, scopeManager: ScopeManager): void {
    const program = ast.body?.[0]?.expression?.body;
    if (!program || program.type !== 'BlockStatement' || !Array.isArray(program.body)) return;

    const variants = scopeManager.getFunctionVariants();
    if (variants.length === 0) return;

    const lines: string[] = [];
    for (const [pineName, list] of variants) {
        // Reverse declaration order — later declarations are checked first,
        // so the last declared variant wins every tie (same-arity overloads,
        // overlapping ranges).
        const reversed = [...list].reverse();
        const exact = reversed
            .map((v) => `if (n === ${v.maxArgs}) return ${v.jsName}.apply(null, arguments);`);
        const range = reversed
            .map((v) => `if (n >= ${v.minArgs} && n <= ${v.maxArgs}) return ${v.jsName}.apply(null, arguments);`);
        const fallback = list[list.length - 1].jsName;
        lines.push(`var ${pineName} = (function (_fallback) {
  return function () {
    var n = arguments.length;
    ${exact.join('\n    ')}
    ${range.join('\n    ')}
    if (_fallback) return _fallback.apply(null, arguments);
    throw new Error("PineTS: no overload of function '${pineName}' for " + n + " argument(s)");
  };
})(${fallback});`);
    }

    const parsed = acorn.parse(lines.join('\n'), { ecmaVersion: 'latest' }) as any;
    program.body.unshift(...parsed.body);
}
