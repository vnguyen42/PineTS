// VIN-154/VIN-155/VIN-156: semantic boundaries found during specialization research.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PineTS, Indicator } from 'pinets';
import { prepareBacktest } from 'pinets/backtest';
const candles = JSON.parse(fs.readFileSync(new URL('../fixtures/studio-inputs/btc-400.json', import.meta.url)));

async function compare(source, inputs = {}) {
    const reference = await new PineTS(candles).run(new Indicator(source, { ...inputs }));
    const actual = await prepareBacktest(source, { inputs })(candles);
    // Deep equality preserves NaN, infinities, signed zero, and absent fields.
    assert.deepEqual(actual.plots, reference.plots);
    assert.deepEqual(actual.strategy, reference.strategy);
    return actual;
}

const operationCases = [
    [
        'named plot source',
        `indicator("Named")\nplot(series=close,title="close",color=color.red)\nplot(series=bar_index<10?na:high,title="high",color=color.green)`,
    ],
    [
        'fixed metadata',
        `indicator("Metadata")\nx=input.int(5,"Length",minval=1,maxval=100,step=1,tooltip="Hi",group="Group")\ny=input.string("A","Mode",options=["A","B"])\nplot(close*x,"Same",color=color.rgb(10,20,30),offset=3,display=display.all-display.status_line)\nplot(open,"Same",color=color.new(color.green,30))\nplot(y=="A"?high:low,color=color.red)`,
        { Length: 7, Mode: 'B' },
    ],
    [
        'input precedence',
        `indicator("Inputs")\nx=input.float(1,"Repeated",inline="x",group="g")\ny=input.float(2,"Repeated")\nz=input.float(3,"")\nplot(x)\nplot(y)\nplot(z)`,
        { x: 4, Repeated: 6, z: 8 },
    ],
    [
        'plot dynamic and absent colors',
        `indicator("Colors")\nplot(close,color=close>open?color.red:color.green)\nplot(close,color=na)\nplot(close)\nplot(close,color=color.new(color.blue,30),offset=-2)`,
    ],
    [
        'conditional title collision',
        `indicator("Collision")\nif bar_index>20\n    plot(high,"same",color=color.red)\nplot(close,"same",color=color.green)\nplot(open,"same",color=color.blue)`,
    ],
    [
        'replay plot',
        `strategy("Replay",calc_on_order_fills=true,process_orders_on_close=true)\nplot(close,"close",color=color.green,offset=1)\nif bar_index%20==0\n    strategy.entry("L",strategy.long)\nif bar_index%20==10\n    strategy.close("L")`,
    ],
    [
        'source override',
        `indicator("Sources")\ns=input.source(close,"Source")\nn=input.int(4,"Length")\nplot(ta.ema(s,n),"EMA",color=color.blue)`,
        { Source: 'high', Length: 8 },
    ],
    [
        'input helper graph',
        `indicator("Group")\ng="Risk"\nx=input.float(0.123456789123,"Value",group=g)\nvar y=x\nplot(y)\nplot(y[1])`,
        { Value: 0.999999999999 },
    ],
];

const boundaryCases = {
    forwardHelper: 'plot(f())\nx=2.0\nf() => x',
    nonFiniteRounding: 'var x = 1e300\nplot(x)',
    rounding: 'var x = input.float(0.123456789123, "Value")\nplot(x)\nplot(x[1])',
    mutation: 'var x = input.float(2.0, "Value")\nx := x + 1\nplot(x)',
    currentMutation: 'x = 2.0\nif close > open\n    x := 3.0\nplot(x)',
    helperHistory: 'previous(x) => x[1]\nplot(previous(close - open))',
    helperState: 'counter(x) =>\n    var total = 0.0\n    total += x\n    total\nplot(counter(close - open))',
    collision: 'f(__specialized_0) => __specialized_0 * 2\nx = close - open\nplot(f(x))',
    tuple: '[a,b,c] = ta.macd(close,12,26,9)\nplot(a)\nplot(b)\nplot(c)',
    signedZero: 'x = input.float(1.0, "Value")\nplot(x)\nplot(1 / x)',
};

for (const [name, body, inputs = {}] of operationCases) {
    await test(name, () => compare('//@version=6\n' + body, inputs));
}
for (const [name, body] of Object.entries(boundaryCases)) {
    await test(name, () => compare('//@version=6\nindicator("Probe")\n' + body, name === 'signedZero' ? { Value: -0 } : {}));
}
await test('dynamic strategy declaration', () =>
    compare(
        '//@version=6\nstrategy("Dynamic",default_qty_value=bar_index + 1)\nif bar_index % 20 == 0\n    strategy.entry("L",strategy.long)\nif bar_index % 20 == 10\n    strategy.close("L")',
    ));
await test('distinct fixed input configurations', async () => {
    const source = '//@version=6\nindicator("Bindings")\nx=input.float(1,"Value")\nplot(x)';
    for (const value of [3, 7]) {
        const result = await compare(source, { Value: value });
        assert(Object.values(result.plots)[0].data.every((point) => Object.is(point.value, value)));
    }
});

await test('real strategies exercise input, constant, and fixed-plot specialization', async () => {
    // Inspect the installed optimizer without adding diagnostics to the public API.
    const { Indicator: SpecializedIndicator } = await import(new URL('./specialize.mjs', import.meta.resolve('pinets/backtest')));
    const totals = { inputReads: 0, constants: 0, fixedPlots: 0 };
    for (const name of ['volatility', 'webhook', 'pullback']) {
        const source = fs.readFileSync(new URL(`../fixtures/studio-inputs/${name}.pine`, import.meta.url), 'utf8').replace(/\u00a0/g, ' ');
        const indicator = new SpecializedIndicator(source);
        indicator.prepare();
        assert.equal(indicator.specialization.stats.fallback, undefined, name);
        for (const key of Object.keys(totals)) totals[key] += indicator.specialization.stats[key] ?? 0;
    }
    for (const [pass, count] of Object.entries(totals)) assert(count > 0, `${pass} must run on the real fixtures`);
});
