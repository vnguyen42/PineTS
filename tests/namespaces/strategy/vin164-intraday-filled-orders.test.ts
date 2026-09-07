import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

// VIN-164: TradingView BCHUSDT 240 captures, 2026-09-07, fill-limit and
// pending-next-bar. Real March 16–17 2020 OHLC; broker mintick is 0.1.
const candles = [[-16, 169.22, 179, 167.75, 174.86], [-12, 174.85, 179.81, 170.07, 172.71], [-8, 172.71, 176.56, 171.28, 174.93], [-4, 174.95, 190.69, 170.94, 178.2], [0, 178.2, 184.41, 174.4, 179.61], [4, 179.63, 179.95, 158, 159.31], [8, 159.16, 164.84, 147.14, 150.85], [12, 150.85, 174, 150.04, 172.56], [16, 172.52, 176, 165.37, 168.46], [20, 168.39, 172.77, 162.67, 172.41], [24, 172.45, 184.64, 168.73, 180.1], [28, 179.97, 186.78, 176.31, 182.17], [32, 182.17, 187.59, 177.13, 180.81]].map(([hours, open, high, low, close]) => {
    const openTime = Date.parse('2020-03-16T00:00:00Z') + hours * 3_600_000;
    return { openTime, open, high, low, close, volume: 1, closeTime: openTime + 14_400_000 };
});
const source = `//@version=5
strategy("BCH daily fill limit 2 witness", overlay=true, initial_capital=10000, pyramiding=10, margin_long=0, margin_short=0)
// Real source 2650 uses this exact rule. BCHUSDT 4h, all timestamps UTC.
// March 16 08:00 candle: open159.16 high164.84 low147.14 close150.85.
// The second market fill precedes the later touch of the pending buy150.
strategy.risk.max_intraday_filled_orders(2)
if time == timestamp("UTC", 2020, 3, 16, 0, 0)
    strategy.entry("first", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 16, 4, 0)
    strategy.entry("second", strategy.long, qty=1)
    strategy.entry("pending-buy-150", strategy.long, qty=1, limit=150)
if time == timestamp("UTC", 2020, 3, 16, 12, 0)
    strategy.entry("third-fill-attempt", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 16, 20, 0)
    strategy.close_all("day-cleanup")
if time == timestamp("UTC", 2020, 3, 17, 0, 0)
    strategy.entry("next-day", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.closedtrades, "Closed trades")
plot(strategy.equity, "Equity")
`;
async function run(script: string) {
    const provider = {
        configure() {}, getQtyStep() { return .0001; },
        async getMarketData() { return candles; },
        async getSymbolInfo() { return { ticker: 'BCHUSDT', tickerid: 'BINANCE:BCHUSDT',
            mintick: .1, mincontract: .0001, pointvalue: 1, type: 'crypto',
            currency: 'USDT', timezone: 'Etc/UTC', session: '24x7' }; },
    };
    return new PineTS(provider as any, 'BCHUSDT', '240').run(script);
}
describe('VIN-164 daily filled-order limit', () => {
    it('counts one close_all fill when it closes two FIFO lots', async () => {
        const r = await run(`//@version=5
strategy("BCH daily fill count FIFO witness", overlay=true, initial_capital=10000, pyramiding=10, margin_long=0, margin_short=0)
strategy.risk.max_intraday_filled_orders(3)
// Two entries on the preceding day; one close_all on March 16 closes two lots.
// If FIFO rows count separately, the next entry hits 3 and is forcibly closed.
// If the single close_all counts once, that entry stays until the final close.
if time == timestamp("UTC", 2020, 3, 15, 8, 0)
    strategy.entry("lot-a", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 15, 12, 0)
    strategy.entry("lot-b", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 16, 0, 0)
    strategy.close_all("one-order-two-lots")
if time == timestamp("UTC", 2020, 3, 16, 4, 0)
    strategy.entry("after-two-lot-close", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 16, 12, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.closedtrades, "Closed trades")
plot(strategy.equity, "Equity")
`);
        const trades = r.strategy!.closedtrades;
        expect(trades).toHaveLength(3);
        expect(trades.map(t => t.entry_id)).toEqual(['lot-a', 'lot-b', 'after-two-lot-close']);
        expect(trades.map(t => t.entry_price)).toEqual([174.8, 172.7, 159.2]);
        expect(trades.map(t => t.exit_price)).toEqual([179.6, 179.6, 172.5]);
        expect(trades.map(t => t.size)).toEqual([1, 1, 1]);
        expect(trades[2].exit_time).toBe(Date.parse('2020-03-16T16:00:00Z'));
        expect(trades[2].exit_comment).toBe('final');
        expect(r.strategy!.netprofit).toBeCloseTo(25, 9);
    });
    it('VIN-166: fills the independently captured pyramid2 addition at the open', async () => {
        const r = await run(`//@version=5
strategy("VIN166 distinct IDs pyramid2", overlay=true, initial_capital=10000, pyramiding=2, calc_on_order_fills=true, margin_long=0, margin_short=0)
if time == timestamp("UTC", 2020, 3, 16, 0, 0)
    strategy.entry("L1", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 16, 4, 0) and strategy.position_size > 0
    strategy.entry("L2", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.closedtrades, "Closed trades")
plot(strategy.equity, "Equity")
`);
        expect(r.strategy!.closedtrades).toHaveLength(2);
        for (const t of r.strategy!.closedtrades) {
            expect(t.entry_price).toBe(179.6);
            expect(t.entry_time).toBe(1584331200000);
            expect(t.exit_price).toBe(182.2);
            expect(t.exit_time).toBe(1584432000000);
            expect(t.size).toBe(1);
        }
        expect(r.strategy!.netprofit).toBeCloseTo(5.2, 9);
    });
    it.each([false, true])('VIN-166: matches the COF cap100 control (same ID: %s)', async (sameId) => {
        const controlSource = sameId ? source.replace('strategy.entry("second",', 'strategy.entry("first",') : source;
        const r = await run(controlSource.replace('pyramiding=10,', 'pyramiding=10, calc_on_order_fills=true,').replace('max_intraday_filled_orders(2)', 'max_intraday_filled_orders(100)'));
        expect(r.strategy!.closedtrades).toHaveLength(11);
        if (!sameId) expect(r.strategy!.closedtrades.filter(t => t.entry_id === 'second').map(t => t.entry_price)).toEqual([179.6, 179.9, 158, 159.2]);
        const expected = [["first", 179.6, 172.4, 1584331200000, 1584403200000, -7.2], ["second", 179.6, 172.4, 1584331200000, 1584403200000, -7.2], ["second", 179.9, 172.4, 1584331200000, 1584403200000, -7.5], ["second", 158.0, 172.4, 1584331200000, 1584403200000, 14.4], ["second", 159.2, 172.4, 1584345600000, 1584403200000, 13.2], ["pending-buy-150", 150.0, 172.4, 1584345600000, 1584403200000, 22.4], ["third-fill-attempt", 172.5, 172.4, 1584374400000, 1584403200000, -0.1], ["next-day", 172.4, 180.0, 1584403200000, 1584417600000, 7.6], ["next-day", 168.7, 180.0, 1584403200000, 1584417600000, 11.3], ["next-day", 184.6, 180.0, 1584403200000, 1584417600000, -4.6], ["next-day", 180.0, 180.0, 1584417600000, 1584417600000, 0.0]];
        expected.forEach(([id, entry, exit, entryTime, exitTime, profit], i) => {
            const t = r.strategy!.closedtrades[i];
            expect([t.entry_id, t.entry_time, t.exit_time, t.size, t.commission]).toEqual([sameId && id === 'second' ? 'first' : id, entryTime, exitTime, 1, 0]);
            expect(t.entry_price).toBeCloseTo(Number(entry), 9);
            expect(t.exit_price).toBeCloseTo(Number(exit), 9);
            expect(t.profit).toBeCloseTo(Number(profit), 9);
        });
        expect(r.strategy!.netprofit).toBeCloseTo(42.3, 9);
    });
    // TV COF captures from VIN-164; base4433851 omitted the second same-open fill.
    // https://linear.app/vinplus/issue/VIN-166/studio-corriger-les-executions-au-meme-open-avec-calc-on-order-fills
    it('VIN-166: preserves an older pending order when the COF cap closes next tick', async () => {
        const r = await run(`//@version=5
strategy("BCH daily fill limit 2 COF old pending witness", overlay=true, initial_capital=10000, pyramiding=10, calc_on_order_fills=true, margin_long=0, margin_short=0)
// Real source 2650 uses this exact rule. BCHUSDT 4h, all timestamps UTC.
// March 16 08:00 candle: open159.16 high164.84 low147.14 close150.85.
// The second market fill precedes the later touch of the pending buy150.
strategy.risk.max_intraday_filled_orders(2)
if time == timestamp("UTC", 2020, 3, 16, 0, 0)
    strategy.entry("first", strategy.long, qty=1)
    strategy.entry("pending-buy-150", strategy.long, qty=1, limit=150)
if time == timestamp("UTC", 2020, 3, 16, 4, 0)
    strategy.entry("second", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 16, 12, 0)
    strategy.entry("third-fill-attempt", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 16, 20, 0)
    strategy.close_all("day-cleanup")
if time == timestamp("UTC", 2020, 3, 17, 0, 0)
    strategy.entry("next-day", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.closedtrades, "Closed trades")
plot(strategy.equity, "Equity")
`);
        expect(r.strategy!.closedtrades).toHaveLength(4);
        expect(r.strategy!.closedtrades.map(t => t.entry_price)).toEqual([179.6, 179.6, 150, 180]);
        expect(r.strategy!.closedtrades.map(t => t.exit_price)).toEqual([179.9, 179.9, 180, 180]);
        expect(r.strategy!.netprofit).toBeCloseTo(30.6, 9);
    });
    it('VIN-166: closes immediately when the regular fill itself reaches cap1', async () => {
        const r = await run(source.replace('pyramiding=10,', 'pyramiding=10, calc_on_order_fills=true,').replace('max_intraday_filled_orders(2)', 'max_intraday_filled_orders(1)'));
        expect(r.strategy!.closedtrades).toHaveLength(2);
        expect(r.strategy!.closedtrades.map(t => t.entry_price)).toEqual([179.6, 180]);
        expect(r.strategy!.closedtrades.map(t => t.exit_price)).toEqual([179.6, 180]);
        expect(r.strategy!.netprofit).toBe(0);
    });
    it('VIN-166: preserves a pending order from an earlier recalculation on the same bar', async () => {
        const r = await run(`//@version=5
strategy("BCH daily fill VIN166 pending earlier recalc cap3", overlay=true, initial_capital=10000, pyramiding=10, calc_on_order_fills=true, margin_long=0, margin_short=0)
// Real source 2650 uses this exact rule. BCHUSDT 4h, all timestamps UTC.
// March 16 08:00 candle: open159.16 high164.84 low147.14 close150.85.
// The second market fill precedes the later touch of the pending buy150.
strategy.risk.max_intraday_filled_orders(3)
if time == timestamp("UTC", 2020, 3, 16, 0, 0)
    strategy.entry("first", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 16, 4, 0)
    strategy.entry("second", strategy.long, qty=1)
    if strategy.opentrades == 1
        strategy.entry("pending-buy-150", strategy.long, qty=1, limit=150)
if time == timestamp("UTC", 2020, 3, 16, 12, 0)
    strategy.entry("third-fill-attempt", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 16, 20, 0)
    strategy.close_all("day-cleanup")
if time == timestamp("UTC", 2020, 3, 17, 0, 0)
    strategy.entry("next-day", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.closedtrades, "Closed trades")
plot(strategy.equity, "Equity")
`);
        expect(r.strategy!.closedtrades).toHaveLength(5);
        expect(r.strategy!.closedtrades.map(t => t.entry_price)).toEqual([179.6, 179.6, 179.9, 150, 180]);
        expect(r.strategy!.closedtrades.map(t => t.exit_price)).toEqual([158, 158, 158, 180, 180]);
        expect(r.strategy!.netprofit).toBeCloseTo(-35.1, 9);
    });
    it('VIN-166: admits one additional same-open fill and preserves an older batch', async () => {
        const r = await run(`//@version=5
strategy("VIN166 pending older drain cap3", overlay=true, initial_capital=10000, pyramiding=10, calc_on_order_fills=true, margin_long=0, margin_short=0)
strategy.risk.max_intraday_filled_orders(3)
if time == timestamp("UTC", 2020, 3, 16, 0, 0)
    strategy.entry("first", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 16, 4, 0)
    if strategy.opentrades == 1
        strategy.entry("second", strategy.long, qty=1)
        strategy.entry("pending-buy-150", strategy.long, qty=1, limit=150)
    if strategy.opentrades == 2
        strategy.entry("third", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.closedtrades, "Closed trades")
plot(strategy.equity, "Equity")
`);
        expect(r.strategy!.closedtrades).toHaveLength(4);
        expect(r.strategy!.closedtrades.map(t => t.entry_price)).toEqual([179.6, 179.6, 179.9, 150]);
        expect(r.strategy!.closedtrades.map(t => t.exit_price)).toEqual([158, 158, 158, 182.2]);
        expect(r.strategy!.netprofit).toBeCloseTo(-32.9, 9);
    });
    it('VIN-166: admits only one additional same-open fill without reaching the cap', async () => {
        const r = await run(`//@version=5
strategy("VIN166 three IDs cap100 control", overlay=true, initial_capital=10000, pyramiding=10, calc_on_order_fills=true, margin_long=0, margin_short=0)
strategy.risk.max_intraday_filled_orders(100)
if time == timestamp("UTC", 2020, 3, 16, 0, 0)
    strategy.entry("first", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 16, 4, 0)
    if strategy.opentrades == 1
        strategy.entry("second", strategy.long, qty=1)
        strategy.entry("pending-buy-150", strategy.long, qty=1, limit=150)
    if strategy.opentrades == 2
        strategy.entry("third", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.closedtrades, "Closed trades")
plot(strategy.equity, "Equity")
`);
        expect(r.strategy!.closedtrades).toHaveLength(4);
        expect(r.strategy!.closedtrades.map(t => t.entry_price)).toEqual([179.6, 179.6, 179.9, 150]);
        expect(r.strategy!.closedtrades.map(t => t.exit_price)).toEqual([182.2, 182.2, 182.2, 182.2]);
        expect(r.strategy!.netprofit).toBeCloseTo(39.7, 9);
    });
    it('VIN-166: matches the COF TradingView witness', async () => {
        const r = await run(source.replace('pyramiding=10,', 'pyramiding=10, calc_on_order_fills=true,'));
        const trades = r.strategy!.closedtrades;
        expect(trades).toHaveLength(3);
        expect(trades.map(t => t.entry_id)).toEqual(['first', 'second', 'next-day']);
        expect(trades.map(t => t.entry_price)).toEqual([179.6, 179.6, 180]);
        expect(trades.map(t => t.exit_price)).toEqual([179.9, 179.9, 180]);
        expect(trades.map(t => t.size)).toEqual([1, 1, 1]);
        expect(trades.map(t => t.entry_time)).toEqual([1584331200000, 1584331200000, 1584417600000]);
        expect(trades.map(t => t.exit_time)).toEqual([1584331200000, 1584331200000, 1584417600000]);
        expect(r.strategy!.netprofit).toBeCloseTo(.6, 9);
    });
    for (const nextBar of [false, true]) {
        it(`preserves the pending order ${nextBar ? 'on the next bar' : 'on the cap bar'} and resets next day`, async () => {
            const script = nextBar ? source.replace('pending-buy-150', 'pending-buy-stop-170').replace('limit=150', 'stop=170') : source;
            const r = await run(script);
            const trades = r.strategy!.closedtrades;
            expect(trades).toHaveLength(4);
            const forced = 'Close Position (Max number of filled orders in one day)';
            const expected = [
                ['first', 4, 179.6, 8, 159.2, forced],
                ['second', 8, 159.2, 8, 159.2, forced],
                [nextBar ? 'pending-buy-stop-170' : 'pending-buy-150', nextBar ? 12 : 8, nextBar ? 170 : 150, 32, 182.2, 'final'],
                ['next-day', 28, 180, 32, 182.2, 'final'],
            ];
            expected.forEach(([id, enterHour, entry, exitHour, exit, comment], i) => {
                const t = trades[i];
                expect(t.entry_id).toBe(id);
                expect(t.size).toBe(1);
                expect(t.entry_time).toBe(Date.parse('2020-03-16T00:00:00Z') + Number(enterHour) * 3_600_000);
                expect(t.exit_time).toBe(Date.parse('2020-03-16T00:00:00Z') + Number(exitHour) * 3_600_000);
                expect(t.entry_price).toBeCloseTo(Number(entry), 9);
                expect(t.exit_price).toBeCloseTo(Number(exit), 9);
                expect(t.exit_comment).toBe(comment);
                expect(t.profit).toBeCloseTo(Number(exit) - Number(entry), 9);
            });
            expect(r.strategy!.netprofit).toBeCloseTo(nextBar ? -6 : 14, 9);
            expect(r.strategy!.opentrades).toHaveLength(0);
        });
    }
});
