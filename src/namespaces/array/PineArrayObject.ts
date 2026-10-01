// SPDX-License-Identifier: AGPL-3.0-only
// This file is auto-generated. Do not edit manually.
// Run: npm run generate:array-index

import { abs as abs_factory } from './methods/abs';
import { avg as avg_factory } from './methods/avg';
import { binary_search as binary_search_factory } from './methods/binary_search';
import { binary_search_leftmost as binary_search_leftmost_factory } from './methods/binary_search_leftmost';
import { binary_search_rightmost as binary_search_rightmost_factory } from './methods/binary_search_rightmost';
import { clear as clear_factory } from './methods/clear';
import { concat as concat_factory } from './methods/concat';
import { copy as copy_factory } from './methods/copy';
import { covariance as covariance_factory } from './methods/covariance';
import { every as every_factory } from './methods/every';
import { fill as fill_factory } from './methods/fill';
import { first as first_factory } from './methods/first';
import { get as get_factory } from './methods/get';
import { includes as includes_factory } from './methods/includes';
import { indexof as indexof_factory } from './methods/indexof';
import { insert as insert_factory } from './methods/insert';
import { join as join_factory } from './methods/join';
import { last as last_factory } from './methods/last';
import { lastindexof as lastindexof_factory } from './methods/lastindexof';
import { max as max_factory } from './methods/max';
import { median as median_factory } from './methods/median';
import { min as min_factory } from './methods/min';
import { mode as mode_factory } from './methods/mode';
import { percentile_linear_interpolation as percentile_linear_interpolation_factory } from './methods/percentile_linear_interpolation';
import { percentile_nearest_rank as percentile_nearest_rank_factory } from './methods/percentile_nearest_rank';
import { percentrank as percentrank_factory } from './methods/percentrank';
import { pop as pop_factory } from './methods/pop';
import { push as push_factory } from './methods/push';
import { range as range_factory } from './methods/range';
import { remove as remove_factory } from './methods/remove';
import { reverse as reverse_factory } from './methods/reverse';
import { set as set_factory } from './methods/set';
import { shift as shift_factory } from './methods/shift';
import { size as size_factory } from './methods/size';
import { slice as slice_factory } from './methods/slice';
import { some as some_factory } from './methods/some';
import { sort as sort_factory } from './methods/sort';
import { sort_indices as sort_indices_factory } from './methods/sort_indices';
import { standardize as standardize_factory } from './methods/standardize';
import { stdev as stdev_factory } from './methods/stdev';
import { sum as sum_factory } from './methods/sum';
import { unshift as unshift_factory } from './methods/unshift';
import { variance as variance_factory } from './methods/variance';

const methodTables = new WeakMap<object, any>();

function createMethods(context: any) {
    return {
        abs: abs_factory(context),
        avg: avg_factory(context),
        binary_search: binary_search_factory(context),
        binary_search_leftmost: binary_search_leftmost_factory(context),
        binary_search_rightmost: binary_search_rightmost_factory(context),
        clear: clear_factory(context),
        concat: concat_factory(context),
        copy: copy_factory(context),
        covariance: covariance_factory(context),
        every: every_factory(context),
        fill: fill_factory(context),
        first: first_factory(context),
        get: get_factory(context),
        includes: includes_factory(context),
        indexof: indexof_factory(context),
        insert: insert_factory(context),
        join: join_factory(context),
        last: last_factory(context),
        lastindexof: lastindexof_factory(context),
        max: max_factory(context),
        median: median_factory(context),
        min: min_factory(context),
        mode: mode_factory(context),
        percentile_linear_interpolation: percentile_linear_interpolation_factory(context),
        percentile_nearest_rank: percentile_nearest_rank_factory(context),
        percentrank: percentrank_factory(context),
        pop: pop_factory(context),
        push: push_factory(context),
        range: range_factory(context),
        remove: remove_factory(context),
        reverse: reverse_factory(context),
        set: set_factory(context),
        shift: shift_factory(context),
        size: size_factory(context),
        slice: slice_factory(context),
        some: some_factory(context),
        sort: sort_factory(context),
        sort_indices: sort_indices_factory(context),
        standardize: standardize_factory(context),
        stdev: stdev_factory(context),
        sum: sum_factory(context),
        unshift: unshift_factory(context),
        variance: variance_factory(context),
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

export enum PineArrayType {
    any = '',
    box = 'box',
    bool = 'bool',
    color = 'color',
    float = 'float',
    int = 'int',
    label = 'label',
    line = 'line',
    linefill = 'linefill',
    string = 'string',
    table = 'table',
}

export class PineArrayObject {
    private _methods: any;

    constructor(public array: any, public type: PineArrayType, public context: any) {
        this._methods = methodsFor(this.context);
    }

    toString(): string {
        return '[' + this.array.toString().replace(/,/g, ', ') + ']';
    }

    [Symbol.iterator]() {
        return this.array[Symbol.iterator]();
    }

    abs(...args: any[]) {
        return this._methods.abs(this, ...args);
    }

    avg(...args: any[]) {
        return this._methods.avg(this, ...args);
    }

    binary_search(...args: any[]) {
        return this._methods.binary_search(this, ...args);
    }

    binary_search_leftmost(...args: any[]) {
        return this._methods.binary_search_leftmost(this, ...args);
    }

    binary_search_rightmost(...args: any[]) {
        return this._methods.binary_search_rightmost(this, ...args);
    }

    clear(...args: any[]) {
        return this._methods.clear(this, ...args);
    }

    concat(...args: any[]) {
        return this._methods.concat(this, ...args);
    }

    copy(...args: any[]) {
        return this._methods.copy(this, ...args);
    }

    covariance(...args: any[]) {
        return this._methods.covariance(this, ...args);
    }

    every(...args: any[]) {
        return this._methods.every(this, ...args);
    }

    fill(...args: any[]) {
        return this._methods.fill(this, ...args);
    }

    first(...args: any[]) {
        return this._methods.first(this, ...args);
    }

    get(...args: any[]) {
        return this._methods.get(this, ...args);
    }

    includes(...args: any[]) {
        return this._methods.includes(this, ...args);
    }

    indexof(...args: any[]) {
        return this._methods.indexof(this, ...args);
    }

    insert(...args: any[]) {
        return this._methods.insert(this, ...args);
    }

    join(...args: any[]) {
        return this._methods.join(this, ...args);
    }

    last(...args: any[]) {
        return this._methods.last(this, ...args);
    }

    lastindexof(...args: any[]) {
        return this._methods.lastindexof(this, ...args);
    }

    max(...args: any[]) {
        return this._methods.max(this, ...args);
    }

    median(...args: any[]) {
        return this._methods.median(this, ...args);
    }

    min(...args: any[]) {
        return this._methods.min(this, ...args);
    }

    mode(...args: any[]) {
        return this._methods.mode(this, ...args);
    }

    percentile_linear_interpolation(...args: any[]) {
        return this._methods.percentile_linear_interpolation(this, ...args);
    }

    percentile_nearest_rank(...args: any[]) {
        return this._methods.percentile_nearest_rank(this, ...args);
    }

    percentrank(...args: any[]) {
        return this._methods.percentrank(this, ...args);
    }

    pop(...args: any[]) {
        return this._methods.pop(this, ...args);
    }

    push(...args: any[]) {
        return this._methods.push(this, ...args);
    }

    range(...args: any[]) {
        return this._methods.range(this, ...args);
    }

    remove(...args: any[]) {
        return this._methods.remove(this, ...args);
    }

    reverse(...args: any[]) {
        return this._methods.reverse(this, ...args);
    }

    set(...args: any[]) {
        return this._methods.set(this, ...args);
    }

    shift(...args: any[]) {
        return this._methods.shift(this, ...args);
    }

    size(...args: any[]) {
        return this._methods.size(this, ...args);
    }

    slice(...args: any[]) {
        return this._methods.slice(this, ...args);
    }

    some(...args: any[]) {
        return this._methods.some(this, ...args);
    }

    sort(...args: any[]) {
        return this._methods.sort(this, ...args);
    }

    sort_indices(...args: any[]) {
        return this._methods.sort_indices(this, ...args);
    }

    standardize(...args: any[]) {
        return this._methods.standardize(this, ...args);
    }

    stdev(...args: any[]) {
        return this._methods.stdev(this, ...args);
    }

    sum(...args: any[]) {
        return this._methods.sum(this, ...args);
    }

    unshift(...args: any[]) {
        return this._methods.unshift(this, ...args);
    }

    variance(...args: any[]) {
        return this._methods.variance(this, ...args);
    }
}
