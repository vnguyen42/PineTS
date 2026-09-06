import {prepareBacktest} from 'pinets/backtest';
import {Provider} from 'pinets';
const run = prepareBacktest('//@version=6\nstrategy("Example")\nplot(close)', {
    inputs: {Length: 14}, props: {initial_capital: 10000},
});
const context = await run(Provider.Mock, 'BTCUSDT', '5', undefined, 1704067200000, 1704153600000);
context.strategy?.equity;
// @ts-expect-error mutable source objects are outside the fixed-configuration API
prepareBacktest('example', {inputs: {Source: []}});

// @ts-expect-error a historical result is a Context, never an arbitrary scalar
const wrongResult: 1 = context;
// @ts-expect-error this API returns a Promise, not the paginated overload
const wrongPaging: AsyncGenerator = run([]);
// @ts-expect-error the timeframe parameter is a string
run([], 'BTCUSDT', 5);
