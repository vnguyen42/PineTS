// VIN-156: prepared full-history runner, with private fixed configuration.
import { PineTS, Indicator } from './specialize.mjs';

// The compiled function is shared; the input map attached to each returned
// Context is private to that run. Keep this policy in the prepared indicator.
class FixedBacktestIndicator extends Indicator {
    #prepared;

    prepare() {
        this.#prepared ??= super.prepare();
        return { ...this.#prepared, inputs: { ...this.#prepared.inputs } };
    }
}

/** Prepare one fixed configuration; each call runs a fresh historical context. */
export function prepareBacktest(source, { inputs = {}, props = {} } = {}) {
    // Pine configuration inputs are scalars. Reject mutable source objects rather
    // than cloning a Series into a plain object and changing its meaning.
    for (const [key, value] of Object.entries(inputs)) {
        if (!['string', 'number', 'boolean'].includes(typeof value)) {
            throw new TypeError(`Backtest input "${key}" must be a string, number or boolean`);
        }
    }
    const indicator = new FixedBacktestIndicator(source, { ...inputs });
    for (const [key, value] of Object.entries(structuredClone(props))) indicator.prop[key] = value;
    indicator.prepare();
    return (...dataArguments) => new PineTS(...dataArguments).run(indicator);
}
