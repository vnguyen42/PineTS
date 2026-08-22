// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

// PineScript to JavaScript Converter
// Converts PineScript files to JavaScript using the parser and code generator

import { Lexer } from './lexer';
import { Parser } from './parser';
import { CodeGenerator } from './codegen';
import { lowerV4LegacyBuiltins } from './v4LegacyLowering';
import { lowerV4InputCalls } from './v4InputLowering';

/**
 * Extract Pine Script version from source code
 * Looks for //@version=X comment on its own line (can be anywhere in the file)
 * The line must start with // and contain only @version=X (with optional whitespace)
 * Returns the version number or null if not found
 */
export function extractPineScriptVersion(sourceCode: string): number | null {
    // Match //@version=X where:
    // - Line starts with optional whitespace, then //
    // - Followed by optional whitespace, then @version
    // - Then = with optional whitespace around it
    // - Then the version number
    // - Then optional whitespace until end of line
    // - Nothing else allowed on the line
    const versionRegex = /^\s*\/\/\s*@version\s*=\s*(\d+)\s*$/im;
    const match = sourceCode.match(versionRegex);

    if (match && match[1]) {
        return parseInt(match[1], 10);
    }

    return null;
}

export function pineToJS(sourceCode: string, options: any = {}) {
    // Step 0: Detect Pine Script version. `options.forceVersion` lets callers
    // transpile version-less sources (no //@version header) under an assumed
    // version — used by the transpile() fallback for corpus sources whose
    // header was lost (TradingView itself assumes v1 for version-less
    // scripts, which this engine refuses; v5 is the closest supported one).
    const version = options.forceVersion ?? extractPineScriptVersion(sourceCode);
    if (version === null) {
        return {
            success: false,
            version: null,
            error: 'Pine Script version not found. Please add //@version=X comment to your script.',
        };
    }
    // Check if version is supported (must be 4 or above). Pine v4 sources
    // are accepted and lowered to the v5 builtin model (v4LegacyLowering)
    // — v2/v3 and unknown versions stay rejected.
    if (version < 4) {
        return {
            success: false,
            version: version,
            error: `Pine Script version ${version} is not supported. Only version 4 and above are supported.`,
        };
    }

    try {
        // Step 1: Tokenize
        const lexer = new Lexer(sourceCode);
        const tokens = lexer.tokenize();

        // Step 2: Parse to AST (the parser gates version-specific syntax
        // tolerance on the detected Pine version, e.g. the v4-only comma
        // statement sequence spanning a var declaration).
        const parser = new Parser(tokens, version);
        const ast = parser.parse();

        // Step 2b: v4-only lowering — rewrite legacy flat builtins in call
        // position into their v5 namespaced equivalents (ta.*, math.*, …),
        // then the v4 `input(...)` forms into the typed input.* methods
        // (type= consumed, defval-lexical inference, explicit error on
        // unsupported families).
        // STRICTLY gated on version === 4: v5/v6/forced-v5 sources never
        // reach these passes, so their behavior is byte-identical.
        if (version === 4) {
            lowerV4LegacyBuiltins(ast);
            lowerV4InputCalls(ast);
        }

        // Step 3: Generate JavaScript (pass source code for comments and the
        // detected Pine version — codegen gates v4-only identifier renaming
        // on it, e.g. `return` as a legal v4 identifier).
        const codegenOptions = { ...options, sourceCode, version };
        const codegen = new CodeGenerator(codegenOptions);
        const jsCode = codegen.generate(ast);

        return {
            success: true,
            version: version,
            code: jsCode,
            ast: ast,
            tokens: tokens,
        };
    } catch (error) {
        return {
            success: false,
            version,
            error: error.message,
            stack: error.stack,
        };
    }
}
