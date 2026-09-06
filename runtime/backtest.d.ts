import type {PineTS} from '../dist/types/PineTS.class.js';
import type {Context} from '../dist/types/Context.class.js';

export interface BacktestOptions {
    inputs?: Record<string, string | number | boolean>;
    props?: Record<string, unknown>;
}
/** Fixed configuration; every invocation creates a fresh historical context. */
export declare function prepareBacktest(
    source: string | Function,
    options?: BacktestOptions,
): (...dataArguments: ConstructorParameters<typeof PineTS>) => Promise<Context>;
