import { describe, expect, it } from 'vitest';
import { Context, PineTS, Provider } from 'index';

describe('Array Access & Information', () => {
    it('SET, GET, FIRST', async () => {
        const pineTS = new PineTS(Provider.Binance, 'BTCUSDT', 'W', 500, 0, new Date('Jan 20 2025').getTime() - 1);

        const { result } = await pineTS.run((context) => {
            const array = context.array;
            const { close } = context.data;

            const arr = array.new(10, close);

            array.set(arr, 1, 99);

            const arr_val = array.get(arr, 1);
            const first = array.first(arr);

            return {
                arr_val,
                first,
            };
        });

        const part_arr_val = result.arr_val.reverse().slice(0, 5);
        const part_first = result.first.reverse().slice(0, 5);

        const expected_arr_val = [99, 99, 99, 99, 99];
        const expected_first = [101331.57, 94545.06, 98363.61, 93738.2, 95186.27];

        expect(part_arr_val).toEqual(expected_arr_val);
        expect(part_first).toEqual(expected_first);
    });

    it('SET, GET, FIRST from Array Object', async () => {
        const pineTS = new PineTS(Provider.Binance, 'BTCUSDT', 'W', 500, 0, new Date('Jan 20 2025').getTime() - 1);

        const { result } = await pineTS.run((context) => {
            const array = context.array;
            const { close } = context.data;

            const arr = array.new(10, close);

            arr.set(1, 99);

            const arr_val = arr.get(1);
            const first = arr.first();

            return {
                arr_val,
                first,
            };
        });

        const part_arr_val = result.arr_val.reverse().slice(0, 5);
        const part_first = result.first.reverse().slice(0, 5);

        const expected_arr_val = [99, 99, 99, 99, 99];
        const expected_first = [101331.57, 94545.06, 98363.61, 93738.2, 95186.27];

        expect(part_arr_val).toEqual(expected_arr_val);
        expect(part_first).toEqual(expected_first);
    });

    it('GET, SET, LAST, SIZE', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { na, plotchar, math, array } = context.pine;

            let a = array.new_float(0);
            for (let i = 0; i <= 9; i++) {
                array.push(a, close[i] - open[i]);
            }
            a.set(9, a.get(9) + 10);
            let res = array.get(a, 9);
            let last = a.last();
            let size = a.size();

            return { a, res, last, size };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];
            const a = JSON.stringify(result.a[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const res = result.res[i];
            const last = result.last[i];
            const size = result.size[i];

            plotdata_str += `[${str_time}]: ${last} ${res} ${size}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: NaN NaN 10
[2018-12-17T00:00:00.000-00:00]: NaN NaN 10
[2018-12-24T00:00:00.000-00:00]: NaN NaN 10
[2018-12-31T00:00:00.000-00:00]: NaN NaN 10
[2019-01-07T00:00:00.000-00:00]: NaN NaN 10
[2019-01-14T00:00:00.000-00:00]: NaN NaN 10
[2019-01-21T00:00:00.000-00:00]: NaN NaN 10
[2019-01-28T00:00:00.000-00:00]: NaN NaN 10
[2019-02-04T00:00:00.000-00:00]: NaN NaN 10
[2019-02-11T00:00:00.000-00:00]: 9.269999999999982 9.269999999999982 10
[2019-02-18T00:00:00.000-00:00]: 770.7999999999997 770.7999999999997 10
[2019-02-25T00:00:00.000-00:00]: -116.35000000000036 -116.35000000000036 10
[2019-03-04T00:00:00.000-00:00]: 216.86000000000013 216.86000000000013 10
[2019-03-11T00:00:00.000-00:00]: -519.79 -519.79 10
[2019-03-18T00:00:00.000-00:00]: 33.84999999999991 33.84999999999991 10
[2019-03-25T00:00:00.000-00:00]: 5.470000000000255 5.470000000000255 10
[2019-04-01T00:00:00.000-00:00]: -104.19999999999982 -104.19999999999982 10
[2019-04-08T00:00:00.000-00:00]: 248.33000000000038 248.33000000000038 10
[2019-04-15T00:00:00.000-00:00]: -13.0300000000002 -13.0300000000002 10`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('FILL', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, open } = context.data;
            const { na, plotchar, math, array } = context.pine;

            let a = array.new_float(5);
            a.fill(close - open);
            let res = a;

            return { a, res };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];

            const a = JSON.stringify(result.a[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const res = JSON.stringify(result.res[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');

            plotdata_str += `[${str_time}]: ${res}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: [-0.7300000000000182, -0.7300000000000182, -0.7300000000000182, -0.7300000000000182, -0.7300000000000182]
[2018-12-17T00:00:00.000-00:00]: [760.7999999999997, 760.7999999999997, 760.7999999999997, 760.7999999999997, 760.7999999999997]
[2018-12-24T00:00:00.000-00:00]: [-126.35000000000036, -126.35000000000036, -126.35000000000036, -126.35000000000036, -126.35000000000036]
[2018-12-31T00:00:00.000-00:00]: [206.86000000000013, 206.86000000000013, 206.86000000000013, 206.86000000000013, 206.86000000000013]
[2019-01-07T00:00:00.000-00:00]: [-529.79, -529.79, -529.79, -529.79, -529.79]
[2019-01-14T00:00:00.000-00:00]: [23.84999999999991, 23.84999999999991, 23.84999999999991, 23.84999999999991, 23.84999999999991]
[2019-01-21T00:00:00.000-00:00]: [-4.529999999999745, -4.529999999999745, -4.529999999999745, -4.529999999999745, -4.529999999999745]
[2019-01-28T00:00:00.000-00:00]: [-114.19999999999982, -114.19999999999982, -114.19999999999982, -114.19999999999982, -114.19999999999982]
[2019-02-04T00:00:00.000-00:00]: [238.33000000000038, 238.33000000000038, 238.33000000000038, 238.33000000000038, 238.33000000000038]
[2019-02-11T00:00:00.000-00:00]: [-23.0300000000002, -23.0300000000002, -23.0300000000002, -23.0300000000002, -23.0300000000002]
[2019-02-18T00:00:00.000-00:00]: [93.09999999999991, 93.09999999999991, 93.09999999999991, 93.09999999999991, 93.09999999999991]
[2019-02-25T00:00:00.000-00:00]: [53.84999999999991, 53.84999999999991, 53.84999999999991, 53.84999999999991, 53.84999999999991]
[2019-03-04T00:00:00.000-00:00]: [112.92000000000007, 112.92000000000007, 112.92000000000007, 112.92000000000007, 112.92000000000007]
[2019-03-11T00:00:00.000-00:00]: [66.70000000000027, 66.70000000000027, 66.70000000000027, 66.70000000000027, 66.70000000000027]
[2019-03-18T00:00:00.000-00:00]: [8.090000000000146, 8.090000000000146, 8.090000000000146, 8.090000000000146, 8.090000000000146]
[2019-03-25T00:00:00.000-00:00]: [122.48000000000002, 122.48000000000002, 122.48000000000002, 122.48000000000002, 122.48000000000002]
[2019-04-01T00:00:00.000-00:00]: [1096.3100000000004, 1096.3100000000004, 1096.3100000000004, 1096.3100000000004, 1096.3100000000004]
[2019-04-08T00:00:00.000-00:00]: [-35.57999999999993, -35.57999999999993, -35.57999999999993, -35.57999999999993, -35.57999999999993]
[2019-04-15T00:00:00.000-00:00]: [133.47999999999956, 133.47999999999956, 133.47999999999956, 133.47999999999956, 133.47999999999956]`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });
});
