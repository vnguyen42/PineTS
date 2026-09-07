import { expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
// Seven captured BCH240 bars; no artificial prices.
const candles = [
  {
    "openTime": 1583496000000,
    "closeTime": 1583510399999,
    "open": 349.99,
    "high": 350.0,
    "low": 340.58,
    "close": 340.99,
    "volume": 0
  },
  {
    "openTime": 1583510400000,
    "closeTime": 1583524799999,
    "open": 340.84,
    "high": 346.92,
    "low": 340.84,
    "close": 345.7,
    "volume": 0
  },
  {
    "openTime": 1583524800000,
    "closeTime": 1583539199999,
    "open": 345.69,
    "high": 351.0,
    "low": 345.2,
    "close": 350.73,
    "volume": 0
  },
  {
    "openTime": 1583539200000,
    "closeTime": 1583553599999,
    "open": 350.74,
    "high": 351.11,
    "low": 345.55,
    "close": 347.06,
    "volume": 0
  },
  {
    "openTime": 1583553600000,
    "closeTime": 1583567999999,
    "open": 347.04,
    "high": 348.3,
    "low": 342.08,
    "close": 344.17,
    "volume": 0
  },
  {
    "openTime": 1583568000000,
    "closeTime": 1583582399999,
    "open": 344.23,
    "high": 349.27,
    "low": 343.82,
    "close": 346.09,
    "volume": 0
  },
  {
    "openTime": 1583582400000,
    "closeTime": 1583596799999,
    "open": 346.12,
    "high": 349.0,
    "low": 339.6,
    "close": 345.37,
    "volume": 0
  }
];
const source = `//@version=5
strategy("Metadata failure witness", margin_long=0, margin_short=0)
if bar_index == 0
    strategy.entry("entry", strategy.long, qty=1)
plot(strategy.equity, "Equity")`;
it('VIN176 propagates promised symbol metadata failure through ready and run', async () => {
 const cause = new Error('Symbol metadata unavailable for BINANCE:BCHUSDT');
 const pine = new PineTS({configure(){},async getMarketData(){return candles;},async getSymbolInfo(){throw cause;}} as any,'BCHUSDT','240');
 await expect(pine.ready()).rejects.toBe(cause);
 await expect(pine.run(source)).rejects.toBe(cause);
});
it('VIN176 still accepts a provider without a metadata method', async () => {
 const pine = new PineTS({configure(){},async getMarketData(){return candles;}} as any,'BCHUSDT','240');
 await expect(pine.ready()).resolves.toBe(true);
 expect((await pine.run(source)).strategy!.opentrades).toHaveLength(1);
});
it('VIN176 still accepts directly supplied bars', async () => {
 const pine = new PineTS(candles);
 await expect(pine.ready()).resolves.toBe(true);
 expect((await pine.run(source)).strategy!.opentrades).toHaveLength(1);
});
