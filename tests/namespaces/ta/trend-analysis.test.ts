import { describe, expect, it } from 'vitest';
import { arrayPrecision, getKlines, runNSFunctionWithArgs } from '../../utils';

import { Context, PineTS, Provider } from 'index';

async function runTAFunctionWithArgs(taFunction: string, ...args) {
    // Use the same dataset as the original tests for consistency
    const klines = await getKlines('BTCUSDT', '1h', 500, 0, 1736071200000 - 1);

    const result = await runNSFunctionWithArgs(klines, 'ta', taFunction, ...args);

    return result;
}

describe('Technical Analysis - Trend Analysis', () => {
    it('SUPERTREND - SuperTrend Native Indicator', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { ta, plotchar, math } = context.pine;

            //const res = ta.wpr(14);
            const [supertrend, direction] = ta.supertrend(3, 10);
            plotchar(supertrend, '_plot');

            return { supertrend, direction };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-07-20').getTime();
        const endDate = new Date('2019-11-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const res = _plotdata[i].value;
            const direction = result.direction[i];
            plotdata_str += `[${str_time}]: ${res} ${direction}\n`;
        }

        const expected_plot = `[2019-07-22T00:00:00.000-00:00]: 7963.315264029399 -1
[2019-07-29T00:00:00.000-00:00]: 7963.315264029399 -1
[2019-08-05T00:00:00.000-00:00]: 7963.315264029399 -1
[2019-08-12T00:00:00.000-00:00]: 7963.315264029399 -1
[2019-08-19T00:00:00.000-00:00]: 7963.315264029399 -1
[2019-08-26T00:00:00.000-00:00]: 7963.315264029399 -1
[2019-09-02T00:00:00.000-00:00]: 7963.315264029399 -1
[2019-09-09T00:00:00.000-00:00]: 7963.315264029399 -1
[2019-09-16T00:00:00.000-00:00]: 7963.315264029399 -1
[2019-09-23T00:00:00.000-00:00]: 7963.315264029399 -1
[2019-09-30T00:00:00.000-00:00]: 12355.596341597378 1
[2019-10-07T00:00:00.000-00:00]: 12355.596341597378 1
[2019-10-14T00:00:00.000-00:00]: 12015.300936693875 1
[2019-10-21T00:00:00.000-00:00]: 12015.300936693875 1
[2019-10-28T00:00:00.000-00:00]: 12015.300936693875 1
[2019-11-04T00:00:00.000-00:00]: 12015.300936693875 1
[2019-11-11T00:00:00.000-00:00]: 12015.300936693875 1`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('CROSSOVER - Crossover Detection', async () => {
        // Crossover returns a boolean per bar, need to collect it over time
        //const klines = await getKlines('BTCUSDT', '1d', 50, 0, 1761350400000 - 1);
        //const pineTS = new PineTS(klines);
        const pineTS = new PineTS(Provider.Binance, 'BTCUSDT', 'D', null, new Date('2025-10-29').getTime(), new Date('2025-11-20').getTime());

        const sourceCode = (context: Context) => {
            const { close, open } = context.data;
            const ta = context.ta;
            const { plot, plotchar } = context.core;
            const ema9 = ta.ema(close, 9);
            const ema18 = ta.ema(close, 18);

            const crossover = ta.crossover(close, open);
            plotchar(crossover, 'crossover');
            return { crossover };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        const plotdata = plots['crossover'].data;

        plotdata.forEach((e) => {
            e.time = new Date(e.time).toISOString().slice(0, -1) + '-00:00';

            delete e.options;
        });
        const plotdata_str = plotdata.map((e) => `[${e.time}]: ${e.value}`).join('\n');

        const expected_plot = `[2025-10-29T00:00:00.000-00:00]: false
[2025-10-30T00:00:00.000-00:00]: false
[2025-10-31T00:00:00.000-00:00]: true
[2025-11-01T00:00:00.000-00:00]: false
[2025-11-02T00:00:00.000-00:00]: false
[2025-11-03T00:00:00.000-00:00]: false
[2025-11-04T00:00:00.000-00:00]: false
[2025-11-05T00:00:00.000-00:00]: true
[2025-11-06T00:00:00.000-00:00]: false
[2025-11-07T00:00:00.000-00:00]: true
[2025-11-08T00:00:00.000-00:00]: false
[2025-11-09T00:00:00.000-00:00]: true
[2025-11-10T00:00:00.000-00:00]: false
[2025-11-11T00:00:00.000-00:00]: false
[2025-11-12T00:00:00.000-00:00]: false
[2025-11-13T00:00:00.000-00:00]: false
[2025-11-14T00:00:00.000-00:00]: false
[2025-11-15T00:00:00.000-00:00]: true
[2025-11-16T00:00:00.000-00:00]: false
[2025-11-17T00:00:00.000-00:00]: false
[2025-11-18T00:00:00.000-00:00]: true
[2025-11-19T00:00:00.000-00:00]: false
[2025-11-20T00:00:00.000-00:00]: false`;

        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
        //const part = result.crossover ? result.crossover.reverse() : [];

        //console.log(' CROSSOVER ', part);
        //expect(part).toBeDefined();
        //expect(part.length).toBe(50);
        //expect(part.every((v) => typeof v === 'boolean')).toBe(true);
    });

    it('CROSSUNDER - Crossunder Detection', async () => {
        // Crossunder returns a boolean per bar, need to collect it over time

        const pineTS = new PineTS(Provider.Binance, 'BTCUSDT', 'D', null, new Date('2025-10-29').getTime(), new Date('2025-11-20').getTime());

        const sourceCode = (context) => {
            const { close, open } = context.data;
            const ta = context.ta;
            const { plotchar } = context.core;
            const crossunder = ta.crossunder(close, open);
            plotchar(crossunder, 'crossunder');

            return { crossunder };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        const plotdata = plots['crossunder']?.data;

        plotdata.forEach((e) => {
            e.time = new Date(e.time).toISOString().slice(0, -1) + '-00:00';

            delete e.options;
        });
        const plotdata_str = plotdata.map((e) => `[${e.time}]: ${e.value}`).join('\n');

        const expected_plot = `[2025-10-29T00:00:00.000-00:00]: false
[2025-10-30T00:00:00.000-00:00]: false
[2025-10-31T00:00:00.000-00:00]: false
[2025-11-01T00:00:00.000-00:00]: false
[2025-11-02T00:00:00.000-00:00]: false
[2025-11-03T00:00:00.000-00:00]: true
[2025-11-04T00:00:00.000-00:00]: false
[2025-11-05T00:00:00.000-00:00]: false
[2025-11-06T00:00:00.000-00:00]: true
[2025-11-07T00:00:00.000-00:00]: false
[2025-11-08T00:00:00.000-00:00]: true
[2025-11-09T00:00:00.000-00:00]: false
[2025-11-10T00:00:00.000-00:00]: false
[2025-11-11T00:00:00.000-00:00]: true
[2025-11-12T00:00:00.000-00:00]: false
[2025-11-13T00:00:00.000-00:00]: false
[2025-11-14T00:00:00.000-00:00]: false
[2025-11-15T00:00:00.000-00:00]: false
[2025-11-16T00:00:00.000-00:00]: true
[2025-11-17T00:00:00.000-00:00]: false
[2025-11-18T00:00:00.000-00:00]: false
[2025-11-19T00:00:00.000-00:00]: true
[2025-11-20T00:00:00.000-00:00]: false`;

        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('CROSS - Cross Detection', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, open } = context.data;
            const { ta, plotchar, math } = context.pine;

            const res = ta.cross(close, open);

            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-07-20').getTime();
        const endDate = new Date('2019-11-16').getTime();

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

        const expected_plot = `[2019-07-22T00:00:00.000-00:00]: true
[2019-07-29T00:00:00.000-00:00]: true
[2019-08-05T00:00:00.000-00:00]: false
[2019-08-12T00:00:00.000-00:00]: true
[2019-08-19T00:00:00.000-00:00]: false
[2019-08-26T00:00:00.000-00:00]: false
[2019-09-02T00:00:00.000-00:00]: true
[2019-09-09T00:00:00.000-00:00]: true
[2019-09-16T00:00:00.000-00:00]: false
[2019-09-23T00:00:00.000-00:00]: false
[2019-09-30T00:00:00.000-00:00]: false
[2019-10-07T00:00:00.000-00:00]: true
[2019-10-14T00:00:00.000-00:00]: true
[2019-10-21T00:00:00.000-00:00]: true
[2019-10-28T00:00:00.000-00:00]: true
[2019-11-04T00:00:00.000-00:00]: false
[2019-11-11T00:00:00.000-00:00]: false`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('RISING - Rising Trend Detection', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, open } = context.data;
            const { ta, plotchar, math } = context.pine;

            const res = ta.rising(close, 2);

            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-01-28').getTime();
        const endDate = new Date('2019-05-20').getTime();

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

        const expected_plot = `[2019-01-28T00:00:00.000-00:00]: false
[2019-02-04T00:00:00.000-00:00]: false
[2019-02-11T00:00:00.000-00:00]: false
[2019-02-18T00:00:00.000-00:00]: false
[2019-02-25T00:00:00.000-00:00]: true
[2019-03-04T00:00:00.000-00:00]: true
[2019-03-11T00:00:00.000-00:00]: true
[2019-03-18T00:00:00.000-00:00]: true
[2019-03-25T00:00:00.000-00:00]: true
[2019-04-01T00:00:00.000-00:00]: true
[2019-04-08T00:00:00.000-00:00]: false
[2019-04-15T00:00:00.000-00:00]: false
[2019-04-22T00:00:00.000-00:00]: false
[2019-04-29T00:00:00.000-00:00]: false
[2019-05-06T00:00:00.000-00:00]: true
[2019-05-13T00:00:00.000-00:00]: true
[2019-05-20T00:00:00.000-00:00]: true`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('FALLING - Falling Trend Detection', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, open } = context.data;
            const { ta, plotchar, math } = context.pine;

            const res = ta.falling(close, 2);

            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-07-29').getTime();
        const endDate = new Date('2019-11-20').getTime();

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

        const expected_plot = `[2019-07-29T00:00:00.000-00:00]: false
[2019-08-05T00:00:00.000-00:00]: false
[2019-08-12T00:00:00.000-00:00]: false
[2019-08-19T00:00:00.000-00:00]: true
[2019-08-26T00:00:00.000-00:00]: true
[2019-09-02T00:00:00.000-00:00]: false
[2019-09-09T00:00:00.000-00:00]: false
[2019-09-16T00:00:00.000-00:00]: true
[2019-09-23T00:00:00.000-00:00]: true
[2019-09-30T00:00:00.000-00:00]: true
[2019-10-07T00:00:00.000-00:00]: false
[2019-10-14T00:00:00.000-00:00]: false
[2019-10-21T00:00:00.000-00:00]: false
[2019-10-28T00:00:00.000-00:00]: false
[2019-11-04T00:00:00.000-00:00]: true
[2019-11-11T00:00:00.000-00:00]: true
[2019-11-18T00:00:00.000-00:00]: true`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('DMI - Directional Movement Index', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, open } = context.data;
            const { ta, plotchar, math } = context.pine;

            const [diplus, diminus, adx] = ta.dmi(17, 14);

            plotchar(diplus, '_plot');

            return { diplus, diminus, adx };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-07-29').getTime();
        const endDate = new Date('2019-11-20').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const diplus = _plotdata[i].value;
            const diminus = result.diminus[i];
            const adx = result.adx[i];

            plotdata_str += `[${str_time}]: ${diplus} ${diminus} ${adx}\n`;
        }

        const expected_plot = `[2019-07-29T00:00:00.000-00:00]: 35.39230350617305 8.206041237266605 79.0152808048108
[2019-08-05T00:00:00.000-00:00]: 38.751314182362876 7.720499441575256 78.14086147624863
[2019-08-12T00:00:00.000-00:00]: 35.71061768784104 12.46487785246332 76.00595758568024
[2019-08-19T00:00:00.000-00:00]: 33.84947706236062 11.815242196041465 74.02354683015244
[2019-08-26T00:00:00.000-00:00]: 31.901382227643506 13.033515797761595 71.73538909122966
[2019-09-02T00:00:00.000-00:00]: 31.49499922499901 12.358983961676916 69.72827214276342
[2019-09-09T00:00:00.000-00:00]: 30.526227240148934 11.978827183842153 67.86452069061619
[2019-09-16T00:00:00.000-00:00]: 29.42244430743058 12.732881606870157 65.84495767858212
[2019-09-23T00:00:00.000-00:00]: 26.40835932699 19.68850937545955 62.18300864417945
[2019-09-30T00:00:00.000-00:00]: 25.432599130080558 19.068955254388587 58.762781156987074
[2019-10-07T00:00:00.000-00:00]: 25.544423607147735 18.15469042796798 55.77333160395613
[2019-10-14T00:00:00.000-00:00]: 24.80650061900498 17.630240801879562 52.997414161855964
[2019-10-21T00:00:00.000-00:00]: 29.98292908135742 15.27323785035771 51.53353995098611
[2019-10-28T00:00:00.000-00:00]: 28.670983116723885 14.604935473685515 50.17422818374982
[2019-11-04T00:00:00.000-00:00]: 27.400116016772692 15.226387101839787 48.630287651709956
[2019-11-11T00:00:00.000-00:00]: 26.515787078224776 16.10159617039465 46.90215896510359
[2019-11-18T00:00:00.000-00:00]: 24.462187337033697 22.002165696836663 43.93017817006839`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });
    it('SAR - Parabolic SAR', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, open } = context.data;
            const { ta, plotchar, math } = context.pine;

            const res = ta.sar(0.02, 0.02, 0.2);

            plotchar(res, '_plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['_plot']?.data;
        const startDate = new Date('2019-07-29').getTime();
        const endDate = new Date('2019-11-20').getTime();

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

        const expected_plot = `[2019-07-29T00:00:00.000-00:00]: 13674.838168
[2019-08-05T00:00:00.000-00:00]: 13582.88140464
[2019-08-12T00:00:00.000-00:00]: 13492.7637765472
[2019-08-19T00:00:00.000-00:00]: 13404.448501016257
[2019-08-26T00:00:00.000-00:00]: 13317.899530995932
[2019-09-02T00:00:00.000-00:00]: 13233.081540376013
[2019-09-09T00:00:00.000-00:00]: 13149.959909568493
[2019-09-16T00:00:00.000-00:00]: 13068.500711377124
[2019-09-23T00:00:00.000-00:00]: 12988.670697149582
[2019-09-30T00:00:00.000-00:00]: 12778.1238692636
[2019-10-07T00:00:00.000-00:00]: 12473.500037107784
[2019-10-14T00:00:00.000-00:00]: 12187.153634881317
[2019-10-21T00:00:00.000-00:00]: 11917.988016788438
[2019-10-28T00:00:00.000-00:00]: 11547.748975445364
[2019-11-04T00:00:00.000-00:00]: 11207.129057409735
[2019-11-11T00:00:00.000-00:00]: 10893.758732816956
[2019-11-18T00:00:00.000-00:00]: 10605.458034191599`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });
});
