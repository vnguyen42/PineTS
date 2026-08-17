// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Series } from '../Series';
import { Context } from '..';
import { PineRuntimeError } from '../errors/PineRuntimeError';

/**
 * `runtime` namespace (Pine v5.19+).
 *
 * Only members required by real corpus scripts are implemented — currently
 * `error`. When called, the script stops executing with a runtime error
 * carrying the supplied message, matching TradingView's semantics
 * (`runtime.error(message) → void`, message is a `series string`).
 */
export class Runtime {
    constructor(private context: Context) {}

    /**
     * Parameter wrapper (Type B — simple unwrap, like strategy.param):
     * the transpiler wraps every `runtime.*` argument in
     * `runtime.param(arg, index, name)`. `error` halts the script as soon as
     * it is called, so no per-bar history is needed — only the current
     * scalar value.
     */
    param(source: unknown, index?: number): unknown {
        return Series.from(source).get(index || 0);
    }

    error(message: unknown): void {
        // The argument is a `series string`: unwrap a Series to its current value.
        const text = message instanceof Series ? message.get(0) : message;
        throw new PineRuntimeError(String(text), 'runtime.error');
    }
}
