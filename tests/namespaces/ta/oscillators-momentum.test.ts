import { describe, expect, it } from 'vitest';
import { arrayPrecision, getKlines, runNSFunctionWithArgs } from '../../utils';

import { Context, PineTS, Provider } from 'index';

async function runTAFunctionWithArgs(taFunction: string, ...args) {
    // Use the same dataset as the original tests for consistency
    const klines = await getKlines('BTCUSDT', '1h', 500, 0, 1736071200000 - 1);

    const result = await runNSFunctionWithArgs(klines, 'ta', taFunction, ...args);

    return result;
}

describe('Technical Analysis - Oscillators & Momentum', () => {
    it('CHANGE - Price Change', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context: Context) => {
            const { close, high, low } = context.data;
            const { ta, plotchar } = context.pine;

            const res = ta.change(close, 28);
            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: NaN
[2019-05-27T00:00:00.000-00:00]: NaN
[2019-06-03T00:00:00.000-00:00]: NaN
[2019-06-10T00:00:00.000-00:00]: NaN
[2019-06-17T00:00:00.000-00:00]: NaN
[2019-06-24T00:00:00.000-00:00]: 7549.66
[2019-07-01T00:00:00.000-00:00]: 7527.280000000001
[2019-07-08T00:00:00.000-00:00]: 6358.34
[2019-07-15T00:00:00.000-00:00]: 6550.19
[2019-07-22T00:00:00.000-00:00]: 6025.78
[2019-07-29T00:00:00.000-00:00]: 7438.36
[2019-08-05T00:00:00.000-00:00]: 8008.039999999999
[2019-08-12T00:00:00.000-00:00]: 6903.099999999999
[2019-08-19T00:00:00.000-00:00]: 6484.82
[2019-08-26T00:00:00.000-00:00]: 6130.03
[2019-09-02T00:00:00.000-00:00]: 6676.630000000001
[2019-09-09T00:00:00.000-00:00]: 6530.36
[2019-09-16T00:00:00.000-00:00]: 6128.2699999999995`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('RSI - Relative Strength Index', async () => {
        const result = await runTAFunctionWithArgs('rsi', 'close', 14);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            40.42051518, 44.4602605765, 54.2984140824, 59.8046908557, 57.7926804941, 57.7604149786, 54.1294122804, 55.1559185358, 52.9779441078,
            55.1281063588,
        ];
        console.log(' RSI ', part);

        expect(arrayPrecision(part)).toEqual(arrayPrecision(expected));
    });

    it('MOM - Momentum', async () => {
        const result = await runTAFunctionWithArgs('mom', 'close', 14);

        const part = result.values.reverse().slice(0, 10);
        const expected = [-514.06, -100.52, 252.51, 746.87, 701.04, 322.42, 214.91, 339.36, 234.14, 424.11];
        console.log(' MOM ', part);
        expect(arrayPrecision(part)).toEqual(arrayPrecision(expected));
    });

    it('ROC - Rate of Change', async () => {
        const result = await runTAFunctionWithArgs('roc', 'close', 14);

        const part = result.values.reverse().slice(0, 10);
        const expected = [
            -0.5236626108, -0.1026116775, 0.2576205213, 0.7644164144, 0.7178525371, 0.3288824078, 0.2193562413, 0.3466814972, 0.2391883329,
            0.4336976676,
        ];
        console.log(' ROC ', part);
        expect(arrayPrecision(part)).toEqual(arrayPrecision(expected));
    });

    it('MACD - Moving Average Convergence Divergence', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, volume } = context.data;
            const { ta, plotchar } = context.pine;

            const [macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9);
            plotchar(macdLine, 'macdLine');
            plotchar(signalLine, 'signalLine');
            plotchar(histLine, 'histLine');

            return { macdLine, signalLine, histLine };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let macdLine_plotdata = plots['macdLine']?.data;
        let signalLine_plotdata = plots['signalLine']?.data;
        let histLine_plotdata = plots['histLine']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();
        //macdLine_plotdata = macdLine_plotdata.filter((e) => e.time >= startDate && e.time <= endDate);
        //signalLine_plotdata = signalLine_plotdata.filter((e) => e.time >= startDate && e.time <= endDate);
        //histLine_plotdata = histLine_plotdata.filter((e) => e.time >= startDate && e.time <= endDate);

        let plotdata_str = '';
        for (let i = 0; i < macdLine_plotdata.length; i++) {
            const time = macdLine_plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const macdLine = macdLine_plotdata[i].value;
            const signalLine = signalLine_plotdata[i]?.value;
            const histLine = histLine_plotdata[i]?.value;
            plotdata_str += `[${str_time}]: ${macdLine} ${signalLine} ${histLine}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: NaN NaN NaN
[2019-05-27T00:00:00.000-00:00]: NaN NaN NaN
[2019-06-03T00:00:00.000-00:00]: 1752.0169161202302 NaN NaN
[2019-06-10T00:00:00.000-00:00]: 1811.3480940478212 NaN NaN
[2019-06-17T00:00:00.000-00:00]: 1985.5011469079245 NaN NaN
[2019-06-24T00:00:00.000-00:00]: 2091.4758618620463 NaN NaN
[2019-07-01T00:00:00.000-00:00]: 2209.050400793487 NaN NaN
[2019-07-08T00:00:00.000-00:00]: 2172.2277130526654 NaN NaN
[2019-07-15T00:00:00.000-00:00]: 2151.275604844869 NaN NaN
[2019-07-22T00:00:00.000-00:00]: 2026.2380772764263 NaN NaN
[2019-07-29T00:00:00.000-00:00]: 2019.9879565059773 2024.346863490161 -4.3589069841837045
[2019-08-05T00:00:00.000-00:00]: 2037.1625005575534 2026.9099909036397 10.252509653913648
[2019-08-12T00:00:00.000-00:00]: 1929.8543228138296 2007.4988572856778 -77.64453447184815
[2019-08-19T00:00:00.000-00:00]: 1809.4157867147424 1967.8822431714907 -158.46645645674835
[2019-08-26T00:00:00.000-00:00]: 1664.2955001788232 1907.1648945729573 -242.86939439413413
[2019-09-02T00:00:00.000-00:00]: 1582.6611389306945 1842.264143444505 -259.60300451381045
[2019-09-09T00:00:00.000-00:00]: 1494.0231506145738 1772.6159448785188 -278.59279426394505
[2019-09-16T00:00:00.000-00:00]: 1384.4838361148832 1694.9895231257917 -310.50568701090856`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('STOCH - Stochastic Oscillator', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, high, low } = context.data;
            const { ta, plotchar } = context.pine;

            const res = ta.stoch(close, high, low, 28);
            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: NaN
[2019-05-27T00:00:00.000-00:00]: NaN
[2019-06-03T00:00:00.000-00:00]: NaN
[2019-06-10T00:00:00.000-00:00]: NaN
[2019-06-17T00:00:00.000-00:00]: 94.65922798552472
[2019-06-24T00:00:00.000-00:00]: 70.82101343333487
[2019-07-01T00:00:00.000-00:00]: 77.43700080080117
[2019-07-08T00:00:00.000-00:00]: 65.12425670316023
[2019-07-15T00:00:00.000-00:00]: 68.99877134759883
[2019-07-22T00:00:00.000-00:00]: 59.0187629798891
[2019-07-29T00:00:00.000-00:00]: 72.64147014223214
[2019-08-05T00:00:00.000-00:00]: 77.99197684302592
[2019-08-12T00:00:00.000-00:00]: 66.41689747283807
[2019-08-19T00:00:00.000-00:00]: 63.9606083338489
[2019-08-26T00:00:00.000-00:00]: 59.94507611786685
[2019-09-02T00:00:00.000-00:00]: 66.04866017511708
[2019-09-09T00:00:00.000-00:00]: 65.19627550149926
[2019-09-16T00:00:00.000-00:00]: 61.912680757499686`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('CCI - Commodity Channel Index', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { open, high, low } = context.data;
            const { ta, plotchar } = context.pine;

            const res = ta.cci(close, 28);
            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: NaN
[2019-05-27T00:00:00.000-00:00]: NaN
[2019-06-03T00:00:00.000-00:00]: NaN
[2019-06-10T00:00:00.000-00:00]: NaN
[2019-06-17T00:00:00.000-00:00]: 217.93551326007574
[2019-06-24T00:00:00.000-00:00]: 180.93112773829483
[2019-07-01T00:00:00.000-00:00]: 175.2318123043319
[2019-07-08T00:00:00.000-00:00]: 119.94510234745808
[2019-07-15T00:00:00.000-00:00]: 117.6598979423861
[2019-07-22T00:00:00.000-00:00]: 81.71213540127007
[2019-07-29T00:00:00.000-00:00]: 109.36313918634987
[2019-08-05T00:00:00.000-00:00]: 113.7902019475471
[2019-08-12T00:00:00.000-00:00]: 77.28102808840046
[2019-08-19T00:00:00.000-00:00]: 67.99565930207143
[2019-08-26T00:00:00.000-00:00]: 54.506997366584024
[2019-09-02T00:00:00.000-00:00]: 67.17700316723416
[2019-09-09T00:00:00.000-00:00]: 61.39219381479463
[2019-09-16T00:00:00.000-00:00]: 49.79146043291919`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('MFI - Money Flow Index', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { ta, plotchar, math } = context.pine;

            const res = ta.mfi(close, 28);
            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: NaN
[2019-05-27T00:00:00.000-00:00]: NaN
[2019-06-03T00:00:00.000-00:00]: NaN
[2019-06-10T00:00:00.000-00:00]: NaN
[2019-06-17T00:00:00.000-00:00]: 78.6068702017598
[2019-06-24T00:00:00.000-00:00]: 66.06341341550343
[2019-07-01T00:00:00.000-00:00]: 69.05806803234695
[2019-07-08T00:00:00.000-00:00]: 63.5411497242271
[2019-07-15T00:00:00.000-00:00]: 66.5693463113482
[2019-07-22T00:00:00.000-00:00]: 65.06968761383453
[2019-07-29T00:00:00.000-00:00]: 66.42919420501016
[2019-08-05T00:00:00.000-00:00]: 69.71613160283074
[2019-08-12T00:00:00.000-00:00]: 66.15996801252174
[2019-08-19T00:00:00.000-00:00]: 62.65835682245002
[2019-08-26T00:00:00.000-00:00]: 60.619570552524955
[2019-09-02T00:00:00.000-00:00]: 61.99238890590405
[2019-09-09T00:00:00.000-00:00]: 59.79382502956939
[2019-09-16T00:00:00.000-00:00]: 57.595864791815316`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('CMO - Chande Momentum Oscillator', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { ta, plotchar, math } = context.pine;

            const res = ta.cmo(close, 28);
            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: NaN
[2019-05-27T00:00:00.000-00:00]: NaN
[2019-06-03T00:00:00.000-00:00]: NaN
[2019-06-10T00:00:00.000-00:00]: NaN
[2019-06-17T00:00:00.000-00:00]: NaN
[2019-06-24T00:00:00.000-00:00]: 63.331717113420055
[2019-07-01T00:00:00.000-00:00]: 63.26274704919301
[2019-07-08T00:00:00.000-00:00]: 48.658108970581715
[2019-07-15T00:00:00.000-00:00]: 49.400983315019054
[2019-07-22T00:00:00.000-00:00]: 43.71689916451678
[2019-07-29T00:00:00.000-00:00]: 48.94875172904841
[2019-08-05T00:00:00.000-00:00]: 50.82198179353483
[2019-08-12T00:00:00.000-00:00]: 40.93884585321535
[2019-08-19T00:00:00.000-00:00]: 38.590838869700384
[2019-08-26T00:00:00.000-00:00]: 35.72522135833272
[2019-09-02T00:00:00.000-00:00]: 37.70950493718595
[2019-09-09T00:00:00.000-00:00]: 36.84115511245807
[2019-09-16T00:00:00.000-00:00]: 34.2323777774178`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('COG - Center of Gravity', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { ta, plotchar, math } = context.pine;

            const res = ta.cog(close, 28);
            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: NaN
[2019-05-27T00:00:00.000-00:00]: NaN
[2019-06-03T00:00:00.000-00:00]: NaN
[2019-06-10T00:00:00.000-00:00]: NaN
[2019-06-17T00:00:00.000-00:00]: -11.671323679951412
[2019-06-24T00:00:00.000-00:00]: -11.516610744295422
[2019-07-01T00:00:00.000-00:00]: -11.293746385828868
[2019-07-08T00:00:00.000-00:00]: -11.227916400133612
[2019-07-15T00:00:00.000-00:00]: -11.157248937668422
[2019-07-22T00:00:00.000-00:00]: -11.239637215990703
[2019-07-29T00:00:00.000-00:00]: -11.267218106749128
[2019-08-05T00:00:00.000-00:00]: -11.301374000715956
[2019-08-12T00:00:00.000-00:00]: -11.44496581918344
[2019-08-19T00:00:00.000-00:00]: -11.601381620824176
[2019-08-26T00:00:00.000-00:00]: -11.79921530572303
[2019-09-02T00:00:00.000-00:00]: -11.974916269315022
[2019-09-09T00:00:00.000-00:00]: -12.168986526145522
[2019-09-16T00:00:00.000-00:00]: -12.386082310655906`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('TSI - True Strength Index', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { ta, plotchar, math } = context.pine;

            const res = ta.tsi(close, 9, 18);
            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: NaN
[2019-05-27T00:00:00.000-00:00]: NaN
[2019-06-03T00:00:00.000-00:00]: NaN
[2019-06-10T00:00:00.000-00:00]: 0.6496654843571278
[2019-06-17T00:00:00.000-00:00]: 0.6561238889165989
[2019-06-24T00:00:00.000-00:00]: 0.6525462640937058
[2019-07-01T00:00:00.000-00:00]: 0.6607935497979542
[2019-07-08T00:00:00.000-00:00]: 0.5838493495379652
[2019-07-15T00:00:00.000-00:00]: 0.5413690310379888
[2019-07-22T00:00:00.000-00:00]: 0.4576142001650734
[2019-07-29T00:00:00.000-00:00]: 0.4292336161576565
[2019-08-05T00:00:00.000-00:00]: 0.4209266349528788
[2019-08-12T00:00:00.000-00:00]: 0.36344069949364516
[2019-08-19T00:00:00.000-00:00]: 0.31736672521656606
[2019-08-26T00:00:00.000-00:00]: 0.2702080502053022
[2019-09-02T00:00:00.000-00:00]: 0.25019592569545795
[2019-09-09T00:00:00.000-00:00]: 0.2324156416235923
[2019-09-16T00:00:00.000-00:00]: 0.2080344498140453`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('WPR - Williams %R', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { ta, plotchar, math } = context.pine;

            const res = ta.wpr(14);
            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: -1.0415357820120352
[2019-05-27T00:00:00.000-00:00]: -6.3393309097602435
[2019-06-03T00:00:00.000-00:00]: -26.737550719291775
[2019-06-10T00:00:00.000-00:00]: -7.1120300980114
[2019-06-17T00:00:00.000-00:00]: -5.9599528857479385
[2019-06-24T00:00:00.000-00:00]: -31.14502702643262
[2019-07-01T00:00:00.000-00:00]: -24.28722227090342
[2019-07-08T00:00:00.000-00:00]: -40.672813257560705
[2019-07-15T00:00:00.000-00:00]: -36.15427413265509
[2019-07-22T00:00:00.000-00:00]: -47.793166333284766
[2019-07-29T00:00:00.000-00:00]: -32.803494778035294
[2019-08-05T00:00:00.000-00:00]: -28.010568025338205
[2019-08-12T00:00:00.000-00:00]: -50.51485035737679
[2019-08-19T00:00:00.000-00:00]: -58.03998312370295
[2019-08-26T00:00:00.000-00:00]: -63.92208879983685
[2019-09-02T00:00:00.000-00:00]: -53.96289394243687
[2019-09-09T00:00:00.000-00:00]: -55.98408219467609
[2019-09-16T00:00:00.000-00:00]: -77.92766730615021`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('MOM - Momentum', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { ta, plotchar, math } = context.pine;

            const _close = close;
            const res = ta.mom(_close, 9);
            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2018-12-10').getTime();
        const endDate = new Date('2019-04-18').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: NaN
[2018-12-17T00:00:00.000-00:00]: NaN
[2018-12-24T00:00:00.000-00:00]: NaN
[2018-12-31T00:00:00.000-00:00]: NaN
[2019-01-07T00:00:00.000-00:00]: NaN
[2019-01-14T00:00:00.000-00:00]: NaN
[2019-01-21T00:00:00.000-00:00]: NaN
[2019-01-28T00:00:00.000-00:00]: NaN
[2019-02-04T00:00:00.000-00:00]: NaN
[2019-02-11T00:00:00.000-00:00]: 429.27
[2019-02-18T00:00:00.000-00:00]: -231.8499999999999
[2019-02-25T00:00:00.000-00:00]: -37.029999999999745
[2019-03-04T00:00:00.000-00:00]: -141.57999999999993
[2019-03-11T00:00:00.000-00:00]: 457.8000000000002
[2019-03-18T00:00:00.000-00:00]: 437.27
[2019-03-25T00:00:00.000-00:00]: 561.7599999999998
[2019-04-01T00:00:00.000-00:00]: 1778.8400000000001
[2019-04-08T00:00:00.000-00:00]: 1509.9900000000002
[2019-04-15T00:00:00.000-00:00]: 1668.46`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });


       
});
