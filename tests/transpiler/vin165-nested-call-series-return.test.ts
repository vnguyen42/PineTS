import { expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

// VIN-165: exact custom SMA functions captured on TradingView BCHUSDT 240,
// 2026-09-07. Direct and nested calls agree. First 100 captured closes below;
// discard the 95-bar warmup when comparing this finite replay with TradingView.
const closes = [215.3, 214.1, 212.6, 214.9, 217.9, 217.8, 219.9, 223.6, 223.9, 225.3, 225.7, 224.0, 223.9, 224.3, 220.9, 221.3, 220.8, 219.4, 220.0, 218.1, 216.0, 216.3, 214.4, 210.1, 211.8, 211.7, 212.5, 210.3, 209.8, 209.6, 211.0, 210.9, 211.5, 210.6, 209.9, 209.5, 209.8, 210.9, 210.1, 210.9, 212.5, 217.3, 217.1, 216.1, 216.6, 219.2, 215.4, 215.8, 211.8, 213.7, 212.8, 212.7, 214.7, 213.6, 214.3, 211.5, 214.2, 212.2, 210.9, 206.0, 211.5, 210.4, 209.6, 211.2, 219.9, 218.7, 217.0, 214.6, 213.9, 207.5, 207.5, 208.5, 210.0, 211.2, 210.7, 208.5, 207.8, 206.6, 208.1, 209.2, 212.1, 211.8, 213.2, 214.1, 212.9, 210.8, 210.0, 209.8, 211.3, 213.8, 213.2, 213.2, 213.2, 214.3, 214.1, 214.3, 213.4, 211.3, 210.8, 213.2];
const candles = closes.map((close, i) => ({ openTime: 1784491200000 + i * 14_400_000,
    closeTime: 1784491200000 + (i + 1) * 14_400_000 - 1,
    open: close, high: close, low: close, close, volume: 1 }));
const source = `//@version=5
indicator("Custom moving average history witness")
pine_sma(x, y) =>
    sum = 0.0
    for i = 0 to y - 1
        sum := sum + x[i] / y
    sum
ma(source, length) =>
    pine_sma(source, length)
plot(pine_sma(close, 96), "Direct custom SMA")
plot(ma(close, 96), "Nested custom SMA")
plot(ta.sma(close, 96), "Built-in SMA")
`;
it('VIN-165 preserves the series through a nested custom moving average return', async () => {
    const result = await new PineTS(candles).run(source);
    const direct = result.plots['Direct custom SMA'].data;
    const nested = result.plots['Nested custom SMA'].data;
    for (let i = 0; i < closes.length; i++) {
        expect(nested[i].value).toBe(direct[i].value);
        if (i < 95) expect(nested[i].value).toBeNaN();
        else expect(nested[i].value).toBeCloseTo(closes.slice(i - 95, i + 1).reduce((a, b) => a + b, 0) / 96, 8);
    }
});
