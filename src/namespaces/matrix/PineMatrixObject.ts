// SPDX-License-Identifier: AGPL-3.0-only
// This file is auto-generated. Do not edit manually.
// Run: npm run generate:matrix-index

import { add_col as add_col_factory } from './methods/add_col';
import { add_row as add_row_factory } from './methods/add_row';
import { avg as avg_factory } from './methods/avg';
import { col as col_factory } from './methods/col';
import { columns as columns_factory } from './methods/columns';
import { concat as concat_factory } from './methods/concat';
import { copy as copy_factory } from './methods/copy';
import { det as det_factory } from './methods/det';
import { diff as diff_factory } from './methods/diff';
import { eigenvalues as eigenvalues_factory } from './methods/eigenvalues';
import { eigenvectors as eigenvectors_factory } from './methods/eigenvectors';
import { elements_count as elements_count_factory } from './methods/elements_count';
import { fill as fill_factory } from './methods/fill';
import { get as get_factory } from './methods/get';
import { inv as inv_factory } from './methods/inv';
import { is_antidiagonal as is_antidiagonal_factory } from './methods/is_antidiagonal';
import { is_antisymmetric as is_antisymmetric_factory } from './methods/is_antisymmetric';
import { is_binary as is_binary_factory } from './methods/is_binary';
import { is_diagonal as is_diagonal_factory } from './methods/is_diagonal';
import { is_identity as is_identity_factory } from './methods/is_identity';
import { is_square as is_square_factory } from './methods/is_square';
import { is_stochastic as is_stochastic_factory } from './methods/is_stochastic';
import { is_symmetric as is_symmetric_factory } from './methods/is_symmetric';
import { is_triangular as is_triangular_factory } from './methods/is_triangular';
import { is_zero as is_zero_factory } from './methods/is_zero';
import { kron as kron_factory } from './methods/kron';
import { max as max_factory } from './methods/max';
import { median as median_factory } from './methods/median';
import { min as min_factory } from './methods/min';
import { mode as mode_factory } from './methods/mode';
import { mult as mult_factory } from './methods/mult';
import { pinv as pinv_factory } from './methods/pinv';
import { pow as pow_factory } from './methods/pow';
import { rank as rank_factory } from './methods/rank';
import { remove_col as remove_col_factory } from './methods/remove_col';
import { remove_row as remove_row_factory } from './methods/remove_row';
import { reshape as reshape_factory } from './methods/reshape';
import { reverse as reverse_factory } from './methods/reverse';
import { row as row_factory } from './methods/row';
import { rows as rows_factory } from './methods/rows';
import { set as set_factory } from './methods/set';
import { sort as sort_factory } from './methods/sort';
import { submatrix as submatrix_factory } from './methods/submatrix';
import { sum as sum_factory } from './methods/sum';
import { swap_columns as swap_columns_factory } from './methods/swap_columns';
import { swap_rows as swap_rows_factory } from './methods/swap_rows';
import { trace as trace_factory } from './methods/trace';
import { transpose as transpose_factory } from './methods/transpose';

const methodTables = new WeakMap<object, any>();

function createMethods(context: any) {
    return {
        add_col: add_col_factory(context),
        add_row: add_row_factory(context),
        avg: avg_factory(context),
        col: col_factory(context),
        columns: columns_factory(context),
        concat: concat_factory(context),
        copy: copy_factory(context),
        det: det_factory(context),
        diff: diff_factory(context),
        eigenvalues: eigenvalues_factory(context),
        eigenvectors: eigenvectors_factory(context),
        elements_count: elements_count_factory(context),
        fill: fill_factory(context),
        get: get_factory(context),
        inv: inv_factory(context),
        is_antidiagonal: is_antidiagonal_factory(context),
        is_antisymmetric: is_antisymmetric_factory(context),
        is_binary: is_binary_factory(context),
        is_diagonal: is_diagonal_factory(context),
        is_identity: is_identity_factory(context),
        is_square: is_square_factory(context),
        is_stochastic: is_stochastic_factory(context),
        is_symmetric: is_symmetric_factory(context),
        is_triangular: is_triangular_factory(context),
        is_zero: is_zero_factory(context),
        kron: kron_factory(context),
        max: max_factory(context),
        median: median_factory(context),
        min: min_factory(context),
        mode: mode_factory(context),
        mult: mult_factory(context),
        pinv: pinv_factory(context),
        pow: pow_factory(context),
        rank: rank_factory(context),
        remove_col: remove_col_factory(context),
        remove_row: remove_row_factory(context),
        reshape: reshape_factory(context),
        reverse: reverse_factory(context),
        row: row_factory(context),
        rows: rows_factory(context),
        set: set_factory(context),
        sort: sort_factory(context),
        submatrix: submatrix_factory(context),
        sum: sum_factory(context),
        swap_columns: swap_columns_factory(context),
        swap_rows: swap_rows_factory(context),
        trace: trace_factory(context),
        transpose: transpose_factory(context),
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

export class PineMatrixObject {
    public matrix: any[][];
    private _methods: any;

    constructor(
        rows: number = 0,
        cols: number = 0,
        initialValue: any = NaN,
        public context: any
    ) {
        this.matrix = [];
        if (rows > 0 && cols > 0) {
            for (let i = 0; i < rows; i++) {
                this.matrix.push(Array(cols).fill(initialValue));
            }
        }
        this._methods = methodsFor(this.context);
    }

    toString(): string {
        let result = '';
        for (let i = 0; i < this.matrix.length; i++) {
            result += result === '' ? '' : '\n';
            result += '[' + this.matrix[i].join(', ') + ']';
        }
        return result;
    }

    add_col(...args: any[]) {
        return this._methods.add_col(this, ...args);
    }

    add_row(...args: any[]) {
        return this._methods.add_row(this, ...args);
    }

    avg(...args: any[]) {
        return this._methods.avg(this, ...args);
    }

    col(...args: any[]) {
        return this._methods.col(this, ...args);
    }

    columns(...args: any[]) {
        return this._methods.columns(this, ...args);
    }

    concat(...args: any[]) {
        return this._methods.concat(this, ...args);
    }

    copy(...args: any[]) {
        return this._methods.copy(this, ...args);
    }

    det(...args: any[]) {
        return this._methods.det(this, ...args);
    }

    diff(...args: any[]) {
        return this._methods.diff(this, ...args);
    }

    eigenvalues(...args: any[]) {
        return this._methods.eigenvalues(this, ...args);
    }

    eigenvectors(...args: any[]) {
        return this._methods.eigenvectors(this, ...args);
    }

    elements_count(...args: any[]) {
        return this._methods.elements_count(this, ...args);
    }

    fill(...args: any[]) {
        return this._methods.fill(this, ...args);
    }

    get(...args: any[]) {
        return this._methods.get(this, ...args);
    }

    inv(...args: any[]) {
        return this._methods.inv(this, ...args);
    }

    is_antidiagonal(...args: any[]) {
        return this._methods.is_antidiagonal(this, ...args);
    }

    is_antisymmetric(...args: any[]) {
        return this._methods.is_antisymmetric(this, ...args);
    }

    is_binary(...args: any[]) {
        return this._methods.is_binary(this, ...args);
    }

    is_diagonal(...args: any[]) {
        return this._methods.is_diagonal(this, ...args);
    }

    is_identity(...args: any[]) {
        return this._methods.is_identity(this, ...args);
    }

    is_square(...args: any[]) {
        return this._methods.is_square(this, ...args);
    }

    is_stochastic(...args: any[]) {
        return this._methods.is_stochastic(this, ...args);
    }

    is_symmetric(...args: any[]) {
        return this._methods.is_symmetric(this, ...args);
    }

    is_triangular(...args: any[]) {
        return this._methods.is_triangular(this, ...args);
    }

    is_zero(...args: any[]) {
        return this._methods.is_zero(this, ...args);
    }

    kron(...args: any[]) {
        return this._methods.kron(this, ...args);
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

    mult(...args: any[]) {
        return this._methods.mult(this, ...args);
    }

    pinv(...args: any[]) {
        return this._methods.pinv(this, ...args);
    }

    pow(...args: any[]) {
        return this._methods.pow(this, ...args);
    }

    rank(...args: any[]) {
        return this._methods.rank(this, ...args);
    }

    remove_col(...args: any[]) {
        return this._methods.remove_col(this, ...args);
    }

    remove_row(...args: any[]) {
        return this._methods.remove_row(this, ...args);
    }

    reshape(...args: any[]) {
        return this._methods.reshape(this, ...args);
    }

    reverse(...args: any[]) {
        return this._methods.reverse(this, ...args);
    }

    row(...args: any[]) {
        return this._methods.row(this, ...args);
    }

    rows(...args: any[]) {
        return this._methods.rows(this, ...args);
    }

    set(...args: any[]) {
        return this._methods.set(this, ...args);
    }

    sort(...args: any[]) {
        return this._methods.sort(this, ...args);
    }

    submatrix(...args: any[]) {
        return this._methods.submatrix(this, ...args);
    }

    sum(...args: any[]) {
        return this._methods.sum(this, ...args);
    }

    swap_columns(...args: any[]) {
        return this._methods.swap_columns(this, ...args);
    }

    swap_rows(...args: any[]) {
        return this._methods.swap_rows(this, ...args);
    }

    trace(...args: any[]) {
        return this._methods.trace(this, ...args);
    }

    transpose(...args: any[]) {
        return this._methods.transpose(this, ...args);
    }
}
