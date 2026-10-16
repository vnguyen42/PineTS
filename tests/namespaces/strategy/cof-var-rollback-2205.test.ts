// Famille : COF_VAR_ROLLBACK — sous calc_on_order_fills, chaque exécution de recalcul
// d'une barre repart des variables COMMITTÉES par la barre précédente ; seule
// l'exécution de clôture de la barre commit (id révélateur 2205, NYMEX:CL1! 60).
//
// Preuve TV (oracle-archives/tv-vin142/runs/run-20260826T191338Z-2205-deep) :
// `var entry_price` est posé dans `if entry_long and strategy.position_size == 0`
// juste avant `strategy.entry`, puis le TP vaut entry_price × 1.005. Barre
// 2023-01-18 14:00 : le stop de la position précédente remplit à l'open 81.56, le
// recalcul ré-entre à 81.56 (le bloc a donc exécuté `entry_price := close`), mais
// le TP de ce trade est 82.25 = 81.84 × 1.005 — la valeur committée par la barre
// précédente. Idem 2023-01-25 15:00 : TP 80.80 = 80.39 × 1.005. Le moteur parent
// gardait l'affectation du recalcul (TP 82.71 / 80.88) : 972/1043 clés → 1038/1043.
import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Kline } from '../../../src/marketData/types';

function candle(openTime: number, open: number, high: number, low: number, close: number): Kline {
    return {
        openTime,
        open,
        high,
        low,
        close,
        volume: 1000,
        closeTime: openTime + 3_599_999,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
        ignore: 0,
    };
}

const HOUR = 3_600_000;

describe('2205 — calc_on_order_fills recalculations roll script variables back', () => {
    it('counts one committed increment per bar however many fill recalculations run', async () => {
        // Bar 1 opens with the market entry fill and reaches the TP at 102:
        // two fill recalculations, then the closing execution.
        const candles = [
            candle(0, 100, 100.5, 99.5, 100),
            candle(HOUR, 100, 103, 99.8, 102.5),
            candle(2 * HOUR, 102.5, 102.8, 102, 102.4),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('cof rollback counter', calc_on_order_fills=true)
var int n = 0
n += 1
varip int k = 0
k += 1
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
strategy.exit('TP', 'L', limit=102.0)
plot(n, 'n')
plot(k, 'k')`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');
        expect(strategy.closedtrades.map((t) => [t.entry_price, t.exit_price])).toEqual([[100, 102]]);
        expect(context.plots['n'].data.map((point: { value: number }) => point.value)).toEqual([1, 2, 3]);
        // varip is not rolled back: bar 1 counts its two fill recalculations too.
        expect(context.plots['k'].data.map((point: { value: number }) => point.value)).toEqual([1, 4, 5]);
    });

    it('keeps the committed var when the fill recalculation re-enters (2205 shape)', async () => {
        // Bar 0 enters (filled at bar 1 open 100). On bar 1 the TP 100.5 fills
        // intrabar; the recalculation re-enters (var ep := close) and the new
        // trade's TP must use the ep committed at the bar-0 close (100 → 100.5),
        // not the recalculation's assignment.
        const candles = [
            candle(0, 99.5, 100.2, 99.4, 100),
            candle(HOUR, 100, 100.6, 99.9, 100.3),
            candle(2 * HOUR, 100.3, 100.8, 100.2, 100.7),
        ];
        const context = await new PineTS(candles).run(`
//@version=5
strategy('cof rollback re-entry', calc_on_order_fills=true)
var float ep = na
if strategy.position_size == 0 and bar_index <= 1
    ep := close
    strategy.entry('L', strategy.long, qty=1)
if strategy.position_size > 0
    strategy.exit('TP', 'L', limit=ep + 0.5)`);
        const strategy = context.strategy;
        if (!strategy) throw new Error('strategy state was not initialized');
        const rows = strategy.closedtrades.map((t) => [t.entry_bar_index, t.exit_bar_index, t.exit_price]);
        expect(rows[0]).toEqual([1, 1, 100.5]);
        // The re-entry placed by the bar-1 recalculation exits at the committed
        // ep + 0.5 = 100.5 (ep was 100 at the bar-0 close), not at close + 0.5.
        expect(rows[1]?.[2]).toBe(100.5);
    });

    // Review findings (Pine execution model: var collections and drawings created
    // by a rolled-back execution are rolled back too). Bar 1 opens with the
    // entry fill: one fill recalculation, then the closing execution.
    const quietCandles = [
        candle(0, 100, 100.5, 99.5, 100),
        candle(HOUR, 100, 100.6, 99.8, 100.4),
        candle(2 * HOUR, 100.4, 100.7, 100.1, 100.5),
    ];

    it('rolls back the contents of var arrays and UDT instances', async () => {
        const context = await new PineTS(quietCandles).run(`
//@version=5
strategy('cof rollback collections', calc_on_order_fills=true)
type Cnt
    int v = 0
var int n = 0
var arr = array.new_int()
var Cnt c = Cnt.new(0)
n += 1
array.push(arr, n)
c.v += 1
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
plot(array.size(arr) - n, 'arr')
plot(c.v - n, 'udt')`);
        expect(context.plots['arr'].data.map((point: { value: number }) => point.value)).toEqual([0, 0, 0]);
        expect(context.plots['udt'].data.map((point: { value: number }) => point.value)).toEqual([0, 0, 0]);
    });

    it('drops the drawings created by a rolled-back execution', async () => {
        const context = await new PineTS(quietCandles).run(`
//@version=5
strategy('cof rollback drawings', calc_on_order_fills=true)
var label lb = na
if na(lb) and strategy.position_size != 0
    lb := label.new(bar_index, high, 'in')
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)`);
        // One label: the one the closing execution of bar 1 created.
        const labels: unknown[] = [];
        for (const helper of context._drawingHelpers) {
            if ('all' in helper && Array.isArray(helper.all)) labels.push(...helper.all);
        }
        expect(labels).toHaveLength(1);
    });

    it('re-declares a var first declared by a rolled-back execution', async () => {
        const context = await new PineTS(quietCandles).run(`
//@version=5
strategy('cof rollback late var', calc_on_order_fills=true)
float shown = na
if strategy.position_size != 0
    var int k = 0
    k += 1
    shown := k
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
plot(shown, 'shown')`);
        expect(context.plots['shown'].data.slice(1).map((point: { value: number }) => point.value)).toEqual([1, 2]);
    });

    // Review v2: a drawing held by a varip survives with its binding.
    it('keeps the drawings a varip variable holds', async () => {
        const context = await new PineTS(quietCandles).run(`
//@version=5
strategy('cof rollback varip drawing', calc_on_order_fills=true)
varip label lb = na
if na(lb) and strategy.position_size != 0
    lb := label.new(bar_index, high, 'varip')
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)`);
        const labels: unknown[] = [];
        for (const helper of context._drawingHelpers) {
            if ('all' in helper && Array.isArray(helper.all)) labels.push(...helper.all);
        }
        expect(labels).toHaveLength(1);
    });

    // Journaled collections: overwrites, removals and appends made by a
    // discarded execution are all undone, whatever their mix.
    it('undoes overwrites, removals and appends of var arrays and maps', async () => {
        const context = await new PineTS(quietCandles).run(`
//@version=5
strategy('cof rollback journal', calc_on_order_fills=true)
var int n = 0
var arr = array.from(0)
var mp = map.new<int, int>()
n += 1
array.push(arr, n)
array.set(arr, 0, n)
if array.size(arr) > 2
    array.remove(arr, 1)
map.put(mp, n, n)
map.put(mp, 0, n)
if map.contains(mp, n - 1) and n > 1
    map.remove(mp, n - 1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
plot(array.size(arr) * 100 + array.get(arr, 0) * 10 + array.get(arr, array.size(arr) - 1), 'arr')
plot(map.size(mp) * 100 + map.get(mp, 0) * 10 + map.get(mp, n), 'map')`);
        // n = 1: [1, 1]; n = 2: [2, 1, 2] then remove index 1 -> [2, 2]; n = 3: [3, 3].
        expect(context.plots['arr'].data.map((point: { value: number }) => point.value)).toEqual([211, 222, 233]);
        // n = 1: {1:1, 0:1}; n = 2: {0:2, 2:2} (1 removed); n = 3: {0:3, 3:3}.
        expect(context.plots['map'].data.map((point: { value: number }) => point.value)).toEqual([211, 222, 233]);
    });

    // UDT elements of var arrays / maps are journaled on their first read.
    it('undoes field writes on UDT elements of var arrays and maps', async () => {
        const context = await new PineTS(quietCandles).run(`
//@version=5
strategy('cof rollback udt elements', calc_on_order_fills=true)
type Cnt
    int v = 0
var bars = array.new<Cnt>()
var mb = map.new<int, Cnt>()
if array.size(bars) == 0
    array.push(bars, Cnt.new(0))
    map.put(mb, 0, Cnt.new(0))
a = array.get(bars, 0)
a.v += 1
m = map.get(mb, 0)
m.v += 1
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
plot(a.v, 'a')
plot(m.v, 'm')`);
        expect(context.plots['a'].data.map((point: { value: number }) => point.value)).toEqual([1, 2, 3]);
        expect(context.plots['m'].data.map((point: { value: number }) => point.value)).toEqual([1, 2, 3]);
    });
});
