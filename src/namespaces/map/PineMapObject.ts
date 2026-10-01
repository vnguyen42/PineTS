// SPDX-License-Identifier: AGPL-3.0-only
// This file is auto-generated. Do not edit manually.
// Run: npm run generate:map-index

import { clear as clear_factory } from './methods/clear';
import { contains as contains_factory } from './methods/contains';
import { copy as copy_factory } from './methods/copy';
import { get as get_factory } from './methods/get';
import { keys as keys_factory } from './methods/keys';
import { put as put_factory } from './methods/put';
import { put_all as put_all_factory } from './methods/put_all';
import { remove as remove_factory } from './methods/remove';
import { size as size_factory } from './methods/size';
import { values as values_factory } from './methods/values';

const methodTables = new WeakMap<object, any>();

function createMethods(context: any) {
    return {
        clear: clear_factory(context),
        contains: contains_factory(context),
        copy: copy_factory(context),
        get: get_factory(context),
        keys: keys_factory(context),
        put: put_factory(context),
        put_all: put_all_factory(context),
        remove: remove_factory(context),
        size: size_factory(context),
        values: values_factory(context),
    };
}

function methodsFor(context: any) {
    if (context === null || typeof context !== 'object') return createMethods(context);
    let methods = methodTables.get(context);
    if (!methods) {
        methods = createMethods(context);
        methodTables.set(context, methods);
    }
    return methods;
}

export class PineMapObject {
    public map: Map<any, any>;
    private _methods: any;

    constructor(public context: any) {
        this.map = new Map();
        this._methods = methodsFor(this.context);
    }

    toString(): string {
        return `PineMapObject(${this.map.size})`;
    }

    clear(...args: any[]) {
        return this._methods.clear(this, ...args);
    }

    contains(...args: any[]) {
        return this._methods.contains(this, ...args);
    }

    copy(...args: any[]) {
        return this._methods.copy(this, ...args);
    }

    get(...args: any[]) {
        return this._methods.get(this, ...args);
    }

    keys(...args: any[]) {
        return this._methods.keys(this, ...args);
    }

    put(...args: any[]) {
        return this._methods.put(this, ...args);
    }

    put_all(...args: any[]) {
        return this._methods.put_all(this, ...args);
    }

    remove(...args: any[]) {
        return this._methods.remove(this, ...args);
    }

    size(...args: any[]) {
        return this._methods.size(this, ...args);
    }

    values(...args: any[]) {
        return this._methods.values(this, ...args);
    }
}
