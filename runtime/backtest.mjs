// VIN-156: prepared full-history runner, with private fixed configuration.
import {PineTS, Indicator} from './specialize.mjs';

/** Prepare one fixed configuration; each call runs a fresh historical context. */
export function prepareBacktest(source, {inputs = {}, props = {}} = {}) {
    // Pine configuration inputs are scalars. Reject mutable source objects rather
    // than cloning a Series into a plain object and changing its meaning.
    for (const [key, value] of Object.entries(inputs)) {
        if (!['string', 'number', 'boolean'].includes(typeof value)) {
            throw new TypeError(`Backtest input "${key}" must be a string, number or boolean`);
        }
    }
    const indicator = new Indicator(source, {...inputs});
    for (const [key, value] of Object.entries(structuredClone(props))) indicator.prop[key] = value;
    const prepared = indicator.prepare();
    // PineTS attaches prepared.inputs to the returned Context. Give each run
    // its own map so a consumer cannot mutate the private fixed configuration.
    indicator.prepare = () => ({...prepared, inputs: {...prepared.inputs}});
    return (...dataArguments) => new PineTS(...dataArguments).run(indicator);
}
