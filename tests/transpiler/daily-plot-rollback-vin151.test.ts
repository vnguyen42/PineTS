// VIN-151: real Studio curves duplicated the last point on every daily update.
// Compare several extensions and repeated last-bar updates with full replays.
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
describe('VIN-151 daily update plot rollback on real Studio scripts', () => {
    for (const sourcePath of sources) it(sourcePath, async () => {
        let count = 350;
        const provider = {configure() {}, async getMarketData(_s, _t, _l, start) {return candles.slice(0, count).filter(c => start === undefined || c.openTime >= start);},
            async getSymbolInfo() {return {ticker:'BTCUSDT',tickerid:'FILE:BTCUSDT',type:'crypto',currency:'USDT',basecurrency:'BTC',timezone:'Etc/UTC',mintick:0.01,pricescale:100,minmove:1,pointvalue:1,mincontract:0.00001,session:'24x7'};}};
        const source = fs.readFileSync(path.join(archive, sourcePath), 'utf8').replace(/\u00a0/g, ' ');
        const indicator = () => {const i = new Indicator(source); i.prop.currency = 'USDT';return i;};
        resetLabelIdCounter();
        const engine = new PineTS(provider, 'BTCUSDT', '240');
        const ctx = await engine.run(indicator());
        for (count of [356, 362, 400]) {
            await engine.updateTail(ctx);
            resetLabelIdCounter();
            const full = await new PineTS(provider, 'BTCUSDT', '240').run(indicator());
            // Drawing IDs are module-global; compare time-series curves separately.
            for (const [key, plot] of Object.entries(full.plots)) {
                if (!key.startsWith('__')) expect(ctx.plots[key]).toEqual(plot);
            }
            expect(ctx.strategy.closedtrades).toEqual(full.strategy.closedtrades);
            expect(ctx.strategy.opentrades).toEqual(full.strategy.opentrades);
            expect(ctx.strategy.equity).toBe(full.strategy.equity);
            const curves = () => Object.fromEntries(Object.entries(ctx.plots).filter(([key]) => !key.startsWith('__')));
            const before = JSON.stringify(curves());
            await engine.updateTail(ctx);
            expect(JSON.stringify(curves())).toBe(before);
            expect(ctx.strategy.closedtrades).toEqual(full.strategy.closedtrades);
        }
    });
});
