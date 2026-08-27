import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Indicator } from '../../../src/Indicator';
import { Series } from '../../../src/Series';
import { any } from '../../../src/namespaces/strategy/methods/any';
import { Context } from '../../../src/Context.class';

// strategy() declaration parameters are Pine series: `default_qty_value=qty`
// with `qty` reassigned every bar arrives as a LIVE Series wrapper. The
// unwrap must run at EVERY merge into config — bar 0 (initializeStrategy)
// AND the per-bar re-merge in any() — with the CURRENT value at the merge
// bar. Before this fix the re-merge re-polled config with the Series object:
// calculateOrderQty(Series) → NaN → qty>0 refused → 1833 ran 0 trades, and
// commission_value → Number(Series) → NaN made 2133/2135 P&L NaN.
// Famille (condition 2) : `unwrap Series des params strategy()` — fix fork
// 1768c13, ids révélateurs 1833/2133/2135.

function makeProvider(candles: any[]) {
    return {
        configure() {},
        async getMarketData() {
            return candles;
        },
        async getSymbolInfo() {
            return {
                ticker: 'BTCUSDT', tickerid: 'TEST:BTCUSDT', main_tickerid: 'TEST:BTCUSDT',
                prefix: 'TEST', root: 'BTC', description: 'BTC / USDT', type: 'crypto',
                basecurrency: 'BTC', currency: 'USDT', timezone: 'Etc/UTC',
                mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1, mincontract: 0.00001,
                session: '24x7', volumetype: 'base',
            };
        },
    };
}

const candles = [0, 1, 2, 3, 4].map((i) => ({
    openTime: i * 86_400_000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1000,
    closeTime: i * 86_400_000 + 86_399_999,
}));

// `qty` is recalculated every bar (bar_index + 1) and passed BY NAME to
// strategy() — the transpiler hands the runtime a Series, not a scalar.
const SOURCE = `
//@version=5
qty = bar_index + 1
strategy('Series unwrap probe', default_qty_type=strategy.fixed, default_qty_value=qty)
if bar_index == 0
    strategy.entry('L', strategy.long)`;

describe('strategy() Series params unwrap on every config merge', () => {
    it('keeps config.default_qty_value numeric at bar 0 AND at every later bar, tracking the recalculated variable', async () => {
        const ind = Indicator.from(SOURCE);
        const prepared = await ind.prepare();
        const rawFn = prepared.fn;

        // Snapshot the config AFTER each bar's body runs (strategy() is
        // declared inside the body; context.strategy appears on bar 0).
        const seen: Array<{ bar: number; qty: unknown }> = [];
        const wrapped = async (context: any) => {
            const result = await rawFn(context);
            seen.push({ bar: context.idx, qty: context.strategy?.config?.default_qty_value });
            return result;
        };
        wrapped._pineVersion = rawFn._pineVersion;
        wrapped._strategyHistorySeries = rawFn._strategyHistorySeries;
        wrapped._ltfSlices = rawFn._ltfSlices;

        const engine = new PineTS(makeProvider(candles) as any, 'BTCUSDT', 'D');
        await engine.runPretranspiled(wrapped, prepared.inputs);

        expect(seen.length).toBe(candles.length);
        // Bar 0: init unwrap → current value 1 (not the Series object).
        expect(seen[0].bar).toBe(0);
        expect(seen[0].qty).toBe(1);
        expect(typeof seen[0].qty).toBe('number');
        // Bars N>0: the re-merge unwraps the LIVE Series to its value at
        // THAT bar (bar_index + 1). A Series object here means the re-merge
        // re-polled config (the 1833/2133/2135 failure mode).
        for (const snapshot of seen.slice(1)) {
            expect(snapshot.qty).toBe(snapshot.bar + 1);
            expect(snapshot.qty).not.toBeInstanceOf(Series);
        }
        expect(seen[seen.length - 1].qty).toBe(candles.length);
    });

    it('unit: any() re-merge unwraps a live Series to its current value at each call', () => {
        const context = new Context({ marketData: [], source: [], tickerId: 'BTCUSDT', timeframe: 'D' });
        const strategyFn = any(context as any);

        // Bar 0: strategy() first call initializes state with a Series value.
        strategyFn('x', { default_qty_value: new Series([1]) });
        expect((context as any).strategy.config.default_qty_value).toBe(1);

        // Bar N: the Series grew (transpiled per-bar assignment appends); the
        // re-merge must unwrap to the CURRENT value, not keep the object.
        strategyFn('x', { default_qty_value: new Series([1, 7]) });
        expect((context as any).strategy.config.default_qty_value).toBe(7);
        expect((context as any).strategy.config.default_qty_value).not.toBeInstanceOf(Series);
    });
});
