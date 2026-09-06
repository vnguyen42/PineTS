# Prepared historical backtests (Node ESM)

```js
import {prepareBacktest} from 'pinets/backtest';

const run = prepareBacktest(pineSource, {
    inputs: {'Average length': 14, Multiplier: 2},
    props: {currency: 'USDT', initial_capital: 20000},
});
const result = await run(provider, 'BTCUSDT', '5');
```

`run` accepts the same data arguments as the `PineTS` constructor. Every call creates a fresh PineTS instance and returns a `Context` with the strategy results and plots. Use a provider with symbol metadata when the script uses `syminfo`; an array of candles alone does not supply that metadata.

The source and configuration are prepared once. Inputs are strings, numbers or booleans; mutable source objects are rejected. Input values are copied and props are cloned before preparation. Later mutations of the caller's options or of a returned context's input map cannot change the prepared runner. Create another runner for another configuration. Completed results are not retained by the runner. Independent executions may share the prepared runner, including concurrent executions; they do not share a market context.

This entry point specializes static inputs, suitable current-value expressions and fixed plot metadata. It retains the ordinary generated code for expressions it cannot simplify. Scripts with asynchronous requests and JavaScript source callbacks retain the original generated function. The standard `pinets` entry point remains available and does not enable the external specialization pass.

Scope: full historical runs with fixed configuration, validated on Node 22.23.1. This API exposes neither streaming nor `updateTail`/checkpoint operations. It does not add support for Pine functions missing from the underlying engine. It preserves strategy results and plots; internal variable slots in `context.let`/`var` may be removed by specialization and are not a supported introspection contract. There is no scores-only mode or cross-job indicator cache.

The benchmark and qualification report lives in the companion `pinets-parity` repository under `benchmarks/studio-production-perf/README.md`. The runtime package contains its own optimizer and helper; it does not import benchmark files or machine-specific paths. Existing `acorn` and `astring` package dependencies are used for the transformation.
