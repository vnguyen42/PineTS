// VIN-149: input parsing dominated the real Studio volatility/webhook/pullback runs.
// Compare the same archived Pine and real candles through literal specialization
// and the existing dynamic-default path; no synthetic market data.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PineTS } from '../../src/PineTS.class';
import { Indicator } from '../../src/Indicator';
import { resetLabelIdCounter } from '../../src/namespaces/label/LabelObject';

const archive = path.resolve(import.meta.dirname, '../fixtures/studio-inputs');
const candles = JSON.parse(fs.readFileSync(path.join(archive, 'btc-400.json'), 'utf8'));
const sources = [
    'volatility.pine',
    'webhook.pine',
    'pullback.pine',
];
async function run(source: string, inputs = {}) {
    resetLabelIdCounter(); // Match independent jobs; drawing IDs are module-global.
    const indicator = new Indicator(source, inputs);
    indicator.prop.currency = 'USDT';
    const provider = {
        configure() {},
        async getMarketData() { return candles; },
        async getSymbolInfo() { return { ticker: 'BTCUSDT', tickerid: 'FILE:BTCUSDT', type: 'crypto',
            currency: 'USDT', basecurrency: 'BTC', timezone: 'Etc/UTC', mintick: 0.01, pricescale: 100,
            minmove: 1, pointvalue: 1, mincontract: 0.00001, session: '24x7' }; },
    };
    const engine = new PineTS(provider, 'BTCUSDT', '240');
    const result = await engine.run(indicator);
    return { plots: result.plots, closed: result.strategy.closedtrades, open: result.strategy.opentrades, equity: result.strategy.equity };
}
describe('VIN-149 literal input specialization on Studio sources', () => {
    for (const sourcePath of sources) it(sourcePath, async () => {
        const source = fs.readFileSync(path.join(archive, sourcePath), 'utf8').replace(/\u00a0/g, ' ');
        // Same defaults at every real bar, but an expression forces the old parser.
        const dynamic = source.replace(/input\.(int|float|bool|string)\(([^,\n]+),/g, 'input.$1((bar_index >= 0 ? $2 : $2),');
        expect(dynamic).not.toBe(source);
        const inputs = { averageLength: 7, 'Average length': 21, fastLen: 10, 'Fast MA length': 30, emaFastLen: 10 };
        expect(await run(source, inputs)).toEqual(await run(dynamic, inputs));
        const original = await run(source);
        expect(Object.keys(original.plots).length).toBeGreaterThan(0);
        expect(await run(source, inputs)).not.toEqual(original);
    });
});
