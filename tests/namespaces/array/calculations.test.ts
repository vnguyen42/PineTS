import { describe, expect, it } from 'vitest';
import { Context, PineTS, Provider } from 'index';

describe('Array Calculations & Statistics', () => {
    it('AVG, VARIANCE', async () => {
        const pineTS = new PineTS(Provider.Binance, 'BTCUSDT', 'W', 500, 0, new Date('Jan 20 2025').getTime() - 1);

        const { result } = await pineTS.run((context) => {
            const array = context.array;
            const { close } = context.data;

            const arr = array.new(10, close);
            array.set(arr, 1, 99);

            const avg = array.avg(arr);
            const variance = array.variance(arr, false);
            const variance_biased = array.variance(arr);

            return {
                avg,
                variance,
                variance_biased,
            };
        });

        const part_avg = result.avg.reverse().slice(0, 5);
        const part_variance = result.variance.reverse().slice(0, 5);
        const part_variance_biased = result.variance_biased.reverse().slice(0, 5);

        const expected_avg = [91208.313, 85100.45400000001, 88537.149, 84374.28, 85677.543];
        const expected_variance = [1024803322.8804907, 892005824.9523604, 965593357.8452102, 876829977.664, 904158891.6052902];
        const expected_variance_biased = [922322990.5924416, 802805242.4571244, 869034022.0606892, 789146979.8976, 813743002.4447612];

        expect(part_avg).toEqual(expected_avg);
        expect(part_variance).toEqual(expected_variance);
        expect(part_variance_biased).toEqual(expected_variance_biased);
    });

    it('AVG, VARIANCE from Array Object', async () => {
        const pineTS = new PineTS(Provider.Binance, 'BTCUSDT', 'W', 500, 0, new Date('Jan 20 2025').getTime() - 1);

        const { result } = await pineTS.run((context) => {
            const array = context.array;
            const { close } = context.data;

            const arr = array.new(10, close);
            arr.set(1, 99);

            const avg = arr.avg();
            const variance = arr.variance(false);
            const variance_biased = arr.variance();

            return {
                avg,
                variance,
                variance_biased,
            };
        });

        const part_avg = result.avg.reverse().slice(0, 5);
        const part_variance = result.variance.reverse().slice(0, 5);
        const part_variance_biased = result.variance_biased.reverse().slice(0, 5);

        const expected_avg = [91208.313, 85100.45400000001, 88537.149, 84374.28, 85677.543];
        const expected_variance = [1024803322.8804907, 892005824.9523604, 965593357.8452102, 876829977.664, 904158891.6052902];
        const expected_variance_biased = [922322990.5924416, 802805242.4571244, 869034022.0606892, 789146979.8976, 813743002.4447612];

        expect(part_avg).toEqual(expected_avg);
        expect(part_variance).toEqual(expected_variance);
        expect(part_variance_biased).toEqual(expected_variance_biased);
    });

    it('SUM, STDEV', async () => {
        //const pineTS = new PineTS(Provider.Mock, 'BTCUSDT', 'W', 500, 0, new Date('Jan 20 2025').getTime() - 1);
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());
        const { result } = await pineTS.run((context) => {
            const array = context.array;
            const { close } = context.data;

            const arr = array.new(5, close);
            array.set(arr, 1, 99);

            const sum = array.sum(arr);
            const stdev = array.stdev(arr, false);
            const stdev_biased = array.stdev(arr);

            return {
                sum,
                stdev,
                stdev_biased,
            };
        });

        const part_sum = result.sum;
        const part_stdev = result.stdev;
        const part_stdev_biased = result.stdev_biased;

        const expected_sum = [
            12896.08, 15912.96, 15385.64, 16255.52, 14135.84, 14242.16, 14224.44, 13752.84, 14705.28, 14613.16, 14985.56, 15237.52, 15689.2, 15967.04,
            15991.24, 16471.48, 20868.2, 20745.24, 21287,
        ];
        const expected_stdev = [
            1386.482893720655, 1723.780331718633, 1664.824163423874, 1762.0797040372497, 1525.0922755099118, 1536.9792128783006, 1534.9980566502368, 1482.2715737407905,
            1588.7576029652862, 1578.4582738609217, 1620.0938596019678, 1648.2638439825103, 1698.763203186365, 1729.826659529792, 1732.5323017825672, 1786.224766058292,
            2277.793005959936, 2264.0456600342673, 2324.6162694087816,
        ];
        const expected_stdev_biased = [
            1240.1080000000004, 1541.796, 1489.0640000000005, 1576.0520000000004, 1364.084, 1374.7160000000001, 1372.944000000001, 1325.784, 1421.0280000000005, 1411.816, 1449.056, 1474.2520000000002, 1519.4199999999998, 1547.2039999999997,
            1549.624, 1597.6480000000001, 2037.3200000000002, 2025.024, 2079.2000000000003,
        ];

        expect(part_sum).toEqual(expected_sum);
        expect(part_stdev).toEqual(expected_stdev);
        expect(part_stdev_biased).toEqual(expected_stdev_biased);
    });

    it('SUM, STDEV from Array Object', async () => {
        //const pineTS = new PineTS(Provider.Mock, 'BTCUSDT', 'W', 500, 0, new Date('Jan 20 2025').getTime() - 1);
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());
        const { result } = await pineTS.run((context) => {
            const array = context.array;
            const { close } = context.data;

            const arr = array.new(5, close);
            arr.set(1, 99);

            const sum = arr.sum();
            const stdev = arr.stdev(false);
            const stdev_biased = arr.stdev();

            return {
                sum,
                stdev,
                stdev_biased,
            };
        });

        const part_sum = result.sum;
        const part_stdev = result.stdev;
        const part_stdev_biased = result.stdev_biased;

        const expected_sum = [
            12896.08, 15912.96, 15385.64, 16255.52, 14135.84, 14242.16, 14224.44, 13752.84, 14705.28, 14613.16, 14985.56, 15237.52, 15689.2, 15967.04,
            15991.24, 16471.48, 20868.2, 20745.24, 21287,
        ];
        const expected_stdev = [
            1386.482893720655, 1723.780331718633, 1664.824163423874, 1762.0797040372497, 1525.0922755099118, 1536.9792128783006, 1534.9980566502368, 1482.2715737407905,
            1588.7576029652862, 1578.4582738609217, 1620.0938596019678, 1648.2638439825103, 1698.763203186365, 1729.826659529792, 1732.5323017825672, 1786.224766058292,
            2277.793005959936, 2264.0456600342673, 2324.6162694087816,
        ];
        const expected_stdev_biased = [
            1240.1080000000004, 1541.796, 1489.0640000000005, 1576.0520000000004, 1364.084, 1374.7160000000001, 1372.944000000001, 1325.784, 1421.0280000000005, 1411.816, 1449.056, 1474.2520000000002, 1519.4199999999998, 1547.2039999999997,
            1549.624, 1597.6480000000001, 2037.3200000000002, 2025.024, 2079.2000000000003,
        ];

        expect(part_sum).toEqual(expected_sum);
        expect(part_stdev).toEqual(expected_stdev);
        expect(part_stdev_biased).toEqual(expected_stdev_biased);
    });

    it('MEDIAN, MODE, STANDARDIZE', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { ta, plotchar, math, array, na } = context.pine;

            //let val = na;
            //val = na(val[1]) ? 1 : val[1] + 0.1;

            let arr = array.new(5, close);

            let median = array.median(arr);
            let mode = array.mode(arr);
            let standardize = array.standardize(arr);
            return { median, mode, standardize };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];
            const median = result.median[i];
            const mode = result.mode[i];
            const standardize = JSON.stringify(result.standardize[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            plotdata_str += `[${str_time}]: ${median} ${mode} ${standardize}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: 3199.27 3199.27 [1, 1, 1, 1, 1]
[2018-12-17T00:00:00.000-00:00]: 3953.49 3953.49 [0, 0, 0, 0, 0]
[2018-12-24T00:00:00.000-00:00]: 3821.66 3821.66 [0, 0, 0, 0, 0]
[2018-12-31T00:00:00.000-00:00]: 4039.13 4039.13 [NaN, NaN, NaN, NaN, NaN]
[2019-01-07T00:00:00.000-00:00]: 3509.21 3509.21 [1, 1, 1, 1, 1]
[2019-01-14T00:00:00.000-00:00]: 3535.79 3535.79 [1, 1, 1, 1, 1]
[2019-01-21T00:00:00.000-00:00]: 3531.36 3531.36 [0, 0, 0, 0, 0]
[2019-01-28T00:00:00.000-00:00]: 3413.46 3413.46 [1, 1, 1, 1, 1]
[2019-02-04T00:00:00.000-00:00]: 3651.57 3651.57 [NaN, NaN, NaN, NaN, NaN]
[2019-02-11T00:00:00.000-00:00]: 3628.54 3628.54 [1, 1, 1, 1, 1]
[2019-02-18T00:00:00.000-00:00]: 3721.64 3721.64 [NaN, NaN, NaN, NaN, NaN]
[2019-02-25T00:00:00.000-00:00]: 3784.63 3784.63 [NaN, NaN, NaN, NaN, NaN]
[2019-03-04T00:00:00.000-00:00]: 3897.55 3897.55 [1, 1, 1, 1, 1]
[2019-03-11T00:00:00.000-00:00]: 3967.01 3967.01 [NaN, NaN, NaN, NaN, NaN]
[2019-03-18T00:00:00.000-00:00]: 3973.06 3973.06 [NaN, NaN, NaN, NaN, NaN]
[2019-03-25T00:00:00.000-00:00]: 4093.12 4093.12 [1, 1, 1, 1, 1]
[2019-04-01T00:00:00.000-00:00]: 5192.3 5192.3 [1, 1, 1, 1, 1]
[2019-04-08T00:00:00.000-00:00]: 5161.56 5161.56 [1, 1, 1, 1, 1]
[2019-04-15T00:00:00.000-00:00]: 5297 5297 [1, 1, 1, 1, 1]`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('STDEV', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { na, plotchar, math, array } = context.pine;

            let a = array.new_float(0);
            for (let i = 0; i <= 3; i++) {
                array.push(a, close[i]);
            }
            let stdev = array.stdev(a);

            return { a, stdev };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];
            const a = JSON.stringify(result.a[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const stdev = result.stdev[i];

            plotdata_str += `[${str_time}]: ${a} ${stdev}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: [3199.27, NaN, NaN, NaN] 0
[2018-12-17T00:00:00.000-00:00]: [3953.49, 3199.27, NaN, NaN] 377.1099999999992
[2018-12-24T00:00:00.000-00:00]: [3821.66, 3953.49, 3199.27, NaN] 328.9032734204197
[2018-12-31T00:00:00.000-00:00]: [4039.13, 3821.66, 3953.49, 3199.27] 329.1645199877237
[2019-01-07T00:00:00.000-00:00]: [3509.21, 4039.13, 3821.66, 3953.49] 201.21994910731365
[2019-01-14T00:00:00.000-00:00]: [3535.79, 3509.21, 4039.13, 3821.66] 218.16174027255013
[2019-01-21T00:00:00.000-00:00]: [3531.36, 3535.79, 3509.21, 4039.13] 222.6563325368243
[2019-01-28T00:00:00.000-00:00]: [3413.46, 3531.36, 3535.79, 3509.21] 49.52893422033226
[2019-02-04T00:00:00.000-00:00]: [3651.57, 3413.46, 3531.36, 3535.79] 84.20083446736598
[2019-02-11T00:00:00.000-00:00]: [3628.54, 3651.57, 3413.46, 3531.36] 93.96840090557168
[2019-02-18T00:00:00.000-00:00]: [3721.64, 3628.54, 3651.57, 3413.46] 115.1190923294297
[2019-02-25T00:00:00.000-00:00]: [3784.63, 3721.64, 3628.54, 3651.57] 61.31098372231263
[2019-03-04T00:00:00.000-00:00]: [3897.55, 3784.63, 3721.64, 3628.54] 97.80755108885403
[2019-03-11T00:00:00.000-00:00]: [3967.01, 3897.55, 3784.63, 3721.64] 95.51066285368546
[2019-03-18T00:00:00.000-00:00]: [3973.06, 3967.01, 3897.55, 3784.63] 75.86266781989
[2019-03-25T00:00:00.000-00:00]: [4093.12, 3973.06, 3967.01, 3897.55] 70.32461109025712
[2019-04-01T00:00:00.000-00:00]: [5192.3, 4093.12, 3973.06, 3967.01] 513.9572679403963
[2019-04-08T00:00:00.000-00:00]: [5161.56, 5192.3, 4093.12, 3973.06] 573.596029710805
[2019-04-15T00:00:00.000-00:00]: [5297, 5161.56, 5192.3, 4093.12] 489.21741023291787`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });
    it('AVG', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { na, plotchar, math, array } = context.pine;

            let a = array.new_float(0);
            for (let i = 0; i <= 3; i++) {
                array.push(a, close[i]);
            }
            let avg = array.avg(a);

            return { a, avg };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];
            const a = JSON.stringify(result.a[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const avg = result.avg[i];

            plotdata_str += `[${str_time}]: ${a} ${avg}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: [3199.27, NaN, NaN, NaN] 3199.27
[2018-12-17T00:00:00.000-00:00]: [3953.49, 3199.27, NaN, NaN] 3576.38
[2018-12-24T00:00:00.000-00:00]: [3821.66, 3953.49, 3199.27, NaN] 3658.14
[2018-12-31T00:00:00.000-00:00]: [4039.13, 3821.66, 3953.49, 3199.27] 3753.3875
[2019-01-07T00:00:00.000-00:00]: [3509.21, 4039.13, 3821.66, 3953.49] 3830.8725
[2019-01-14T00:00:00.000-00:00]: [3535.79, 3509.21, 4039.13, 3821.66] 3726.4475
[2019-01-21T00:00:00.000-00:00]: [3531.36, 3535.79, 3509.21, 4039.13] 3653.8725
[2019-01-28T00:00:00.000-00:00]: [3413.46, 3531.36, 3535.79, 3509.21] 3497.455
[2019-02-04T00:00:00.000-00:00]: [3651.57, 3413.46, 3531.36, 3535.79] 3533.045
[2019-02-11T00:00:00.000-00:00]: [3628.54, 3651.57, 3413.46, 3531.36] 3556.2325
[2019-02-18T00:00:00.000-00:00]: [3721.64, 3628.54, 3651.57, 3413.46] 3603.8025
[2019-02-25T00:00:00.000-00:00]: [3784.63, 3721.64, 3628.54, 3651.57] 3696.5950000000003
[2019-03-04T00:00:00.000-00:00]: [3897.55, 3784.63, 3721.64, 3628.54] 3758.09
[2019-03-11T00:00:00.000-00:00]: [3967.01, 3897.55, 3784.63, 3721.64] 3842.7075
[2019-03-18T00:00:00.000-00:00]: [3973.06, 3967.01, 3897.55, 3784.63] 3905.5625
[2019-03-25T00:00:00.000-00:00]: [4093.12, 3973.06, 3967.01, 3897.55] 3982.6850000000004
[2019-04-01T00:00:00.000-00:00]: [5192.3, 4093.12, 3973.06, 3967.01] 4306.3725
[2019-04-08T00:00:00.000-00:00]: [5161.56, 5192.3, 4093.12, 3973.06] 4605.01
[2019-04-15T00:00:00.000-00:00]: [5297, 5161.56, 5192.3, 4093.12] 4935.995000000001`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('VARIANCE', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { na, plotchar, math, array } = context.pine;

            let a = array.new_float(0);
            for (let i = 0; i <= 3; i++) {
                array.push(a, close[i] * 0.0001);
            }
            let variance = array.variance(a);
            let variance_unbiased = array.variance(a, false);

            return { a, variance, variance_unbiased };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];
            const a = JSON.stringify(result.a[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const variance = result.variance[i];
            const variance_unbiased = result.variance_unbiased[i];

            plotdata_str += `[${str_time}]: ${variance} ${variance_unbiased}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: 0 NaN
[2018-12-17T00:00:00.000-00:00]: 0.0014221195209999996 0.002844239041999999
[2018-12-24T00:00:00.000-00:00]: 0.0010817736326666665 0.0016226604489999997
[2018-12-31T00:00:00.000-00:00]: 0.0010834928121875 0.0014446570829166666
[2019-01-07T00:00:00.000-00:00]: 0.00040489467918749963 0.0005398595722499995
[2019-01-14T00:00:00.000-00:00]: 0.00047594544918749967 0.0006345939322499996
[2019-01-21T00:00:00.000-00:00]: 0.0004957584241874999 0.0006610112322499999
[2019-01-28T00:00:00.000-00:00]: 0.000024531153249999933 0.000032708204333333246
[2019-02-04T00:00:00.000-00:00]: 0.00007089780524999983 0.00009453040699999977
[2019-02-11T00:00:00.000-00:00]: 0.0000883006036874998 0.00011773413824999974
[2019-02-18T00:00:00.000-00:00]: 0.00013252405418749964 0.0001766987389166662
[2019-02-25T00:00:00.000-00:00]: 0.000037590367250000156 0.000050120489666666875
[2019-03-04T00:00:00.000-00:00]: 0.00009566317050000014 0.00012755089400000018
[2019-03-11T00:00:00.000-00:00]: 0.0000912228671875001 0.00012163048958333347
[2019-03-18T00:00:00.000-00:00]: 0.00005755144368749975 0.00007673525824999966
[2019-03-25T00:00:00.000-00:00]: 0.000049455509249999964 0.00006594067899999995
[2019-04-01T00:00:00.000-00:00]: 0.002641520732687503 0.0035220276435833377
[2019-04-08T00:00:00.000-00:00]: 0.003290124053000004 0.0043868320706666715
[2019-04-15T00:00:00.000-00:00]: 0.0023933367447500024 0.00319111565966667`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('COVARIANCE', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { na, plotchar, math, array } = context.pine;

            let a = array.new_float(0);
            let b = array.new_float(0);
            for (let i = 0; i <= 3; i++) {
                array.push(a, close[i]);
                array.push(b, open[i]);
            }
            let covariance = array.covariance(a, b);
            let covariance_unbiased = array.covariance(a, b, false);

            return { a, b, covariance, covariance_unbiased };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];
            const a = JSON.stringify(result.a[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const b = JSON.stringify(result.b[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const covariance = result.covariance[i];
            const covariance_unbiased = result.covariance_unbiased[i];

            plotdata_str += `[${str_time}]: ${covariance} ${covariance_unbiased}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: 0 NaN
[2018-12-17T00:00:00.000-00:00]: -1378.3370499999892 -2756.6740999999784
[2018-12-24T00:00:00.000-00:00]: 40051.86223333334 60077.793350000014
[2018-12-31T00:00:00.000-00:00]: 57568.04348125002 76757.39130833336
[2019-01-07T00:00:00.000-00:00]: -36496.81100624997 -48662.414674999956
[2019-01-14T00:00:00.000-00:00]: 6795.925837500003 9061.234450000004
[2019-01-21T00:00:00.000-00:00]: 11057.385837500004 14743.181116666672
[2019-01-28T00:00:00.000-00:00]: 1421.8034125000022 1895.7378833333362
[2019-02-04T00:00:00.000-00:00]: -3404.662362500004 -4539.549816666672
[2019-02-11T00:00:00.000-00:00]: -538.3987750000024 -717.8650333333366
[2019-02-18T00:00:00.000-00:00]: 2371.7783187499954 3162.3710916666605
[2019-02-25T00:00:00.000-00:00]: 4281.818562499999 5709.091416666665
[2019-03-04T00:00:00.000-00:00]: 5374.556125000007 7166.074833333343
[2019-03-11T00:00:00.000-00:00]: 9101.053162500011 12134.737550000014
[2019-03-18T00:00:00.000-00:00]: 6448.240268749985 8597.653691666646
[2019-03-25T00:00:00.000-00:00]: 4248.239462499986 5664.319283333315
[2019-04-01T00:00:00.000-00:00]: 34202.06465624998 45602.75287499998
[2019-04-08T00:00:00.000-00:00]: 189952.13325000016 253269.5110000002
[2019-04-15T00:00:00.000-00:00]: 184854.7371625001 246472.98288333346`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('RANGE', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { na, plotchar, math, array } = context.pine;

            let a = array.new_float(0);
            for (let i = 0; i <= 3; i++) {
                array.push(a, close[i]);
            }
            let range = array.range(a);

            return { a, range };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];
            const a = JSON.stringify(result.a[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const range = result.range[i];

            plotdata_str += `[${str_time}]: ${range}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: 0
[2018-12-17T00:00:00.000-00:00]: 754.2199999999998
[2018-12-24T00:00:00.000-00:00]: 754.2199999999998
[2018-12-31T00:00:00.000-00:00]: 839.8600000000001
[2019-01-07T00:00:00.000-00:00]: 529.9200000000001
[2019-01-14T00:00:00.000-00:00]: 529.9200000000001
[2019-01-21T00:00:00.000-00:00]: 529.9200000000001
[2019-01-28T00:00:00.000-00:00]: 122.32999999999993
[2019-02-04T00:00:00.000-00:00]: 238.11000000000013
[2019-02-11T00:00:00.000-00:00]: 238.11000000000013
[2019-02-18T00:00:00.000-00:00]: 308.17999999999984
[2019-02-25T00:00:00.000-00:00]: 156.09000000000015
[2019-03-04T00:00:00.000-00:00]: 269.0100000000002
[2019-03-11T00:00:00.000-00:00]: 245.37000000000035
[2019-03-18T00:00:00.000-00:00]: 188.42999999999984
[2019-03-25T00:00:00.000-00:00]: 195.5699999999997
[2019-04-01T00:00:00.000-00:00]: 1225.29
[2019-04-08T00:00:00.000-00:00]: 1219.2400000000002
[2019-04-15T00:00:00.000-00:00]: 1203.88`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('percentrank', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { na, plotchar, math, array } = context.pine;

            let a = array.new_float(0);
            for (let i = 0; i <= 10; i++) {
                array.push(a, close[i]);
            }
            let percentrank = array.percentrank(a, 3);

            return { a, percentrank };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];
            const a = JSON.stringify(result.a[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const percentrank = result.percentrank[i];

            plotdata_str += `[${str_time}]: ${a} ${percentrank}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: [3199.27, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN] NaN
[2018-12-17T00:00:00.000-00:00]: [3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN] NaN
[2018-12-24T00:00:00.000-00:00]: [3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN] NaN
[2018-12-31T00:00:00.000-00:00]: [4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN, NaN, NaN] 0
[2019-01-07T00:00:00.000-00:00]: [3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN, NaN] 30
[2019-01-14T00:00:00.000-00:00]: [3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN] 30
[2019-01-21T00:00:00.000-00:00]: [3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN] 60
[2019-01-28T00:00:00.000-00:00]: [3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN] 20
[2019-02-04T00:00:00.000-00:00]: [3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN] 40
[2019-02-11T00:00:00.000-00:00]: [3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN] 30
[2019-02-18T00:00:00.000-00:00]: [3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27] 10
[2019-02-25T00:00:00.000-00:00]: [3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49] 50
[2019-03-04T00:00:00.000-00:00]: [3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66] 40
[2019-03-11T00:00:00.000-00:00]: [3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13] 60
[2019-03-18T00:00:00.000-00:00]: [3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21] 70
[2019-03-25T00:00:00.000-00:00]: [4093.12, 3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79] 70
[2019-04-01T00:00:00.000-00:00]: [5192.3, 4093.12, 3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36] 70
[2019-04-08T00:00:00.000-00:00]: [5161.56, 5192.3, 4093.12, 3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46] 70
[2019-04-15T00:00:00.000-00:00]: [5297, 5161.56, 5192.3, 4093.12, 3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57] 70`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('percentile_linear_interpolation', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { na, plotchar, math, array } = context.pine;

            let a = array.new_float(0);
            for (let i = 0; i <= 10; i++) {
                array.push(a, close[i]);
            }
            let percentile_linear_interpolation = array.percentile_linear_interpolation(a, 30);

            return { a, percentile_linear_interpolation };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];
            const a = JSON.stringify(result.a[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const percentile_linear_interpolation = result.percentile_linear_interpolation[i];

            plotdata_str += `[${str_time}]: ${a} ${percentile_linear_interpolation}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: [3199.27, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN] NaN
[2018-12-17T00:00:00.000-00:00]: [3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN] NaN
[2018-12-24T00:00:00.000-00:00]: [3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN] NaN
[2018-12-31T00:00:00.000-00:00]: [4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN, NaN, NaN] NaN
[2019-01-07T00:00:00.000-00:00]: [3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN, NaN] NaN
[2019-01-14T00:00:00.000-00:00]: [3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN] NaN
[2019-01-21T00:00:00.000-00:00]: [3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN] NaN
[2019-01-28T00:00:00.000-00:00]: [3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN] NaN
[2019-02-04T00:00:00.000-00:00]: [3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN] NaN
[2019-02-11T00:00:00.000-00:00]: [3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN] NaN
[2019-02-18T00:00:00.000-00:00]: [3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27] 3526.93
[2019-02-25T00:00:00.000-00:00]: [3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49] 3534.9039999999995
[2019-03-04T00:00:00.000-00:00]: [3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66] 3534.9039999999995
[2019-03-11T00:00:00.000-00:00]: [3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13] 3534.9039999999995
[2019-03-18T00:00:00.000-00:00]: [3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21] 3534.9039999999995
[2019-03-25T00:00:00.000-00:00]: [4093.12, 3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79] 3609.99
[2019-04-01T00:00:00.000-00:00]: [5192.3, 4093.12, 3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36] 3646.964
[2019-04-08T00:00:00.000-00:00]: [5161.56, 5192.3, 4093.12, 3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46] 3707.626
[2019-04-15T00:00:00.000-00:00]: [5297, 5161.56, 5192.3, 4093.12, 3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57] 3772.032`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('percentile_nearest_rank', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume } = context.data;
            const { na, plotchar, math, array } = context.pine;

            let a = array.new_float(0);
            for (let i = 0; i <= 10; i++) {
                array.push(a, close[i]);
            }
            let percentile_nearest_rank = array.percentile_nearest_rank(a, 30);

            return { a, percentile_nearest_rank };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];
            const a = JSON.stringify(result.a[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const percentile_nearest_rank = result.percentile_nearest_rank[i];

            plotdata_str += `[${str_time}]: ${a} ${percentile_nearest_rank}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: [3199.27, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN] NaN
[2018-12-17T00:00:00.000-00:00]: [3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN] NaN
[2018-12-24T00:00:00.000-00:00]: [3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN] NaN
[2018-12-31T00:00:00.000-00:00]: [4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN, NaN, NaN] 4039.13
[2019-01-07T00:00:00.000-00:00]: [3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN, NaN] 3953.49
[2019-01-14T00:00:00.000-00:00]: [3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN, NaN] 3821.66
[2019-01-21T00:00:00.000-00:00]: [3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN, NaN] 3535.79
[2019-01-28T00:00:00.000-00:00]: [3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN, NaN] 3531.36
[2019-02-04T00:00:00.000-00:00]: [3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN, NaN] 3531.36
[2019-02-11T00:00:00.000-00:00]: [3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27, NaN] 3531.36
[2019-02-18T00:00:00.000-00:00]: [3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49, 3199.27] 3531.36
[2019-02-25T00:00:00.000-00:00]: [3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66, 3953.49] 3535.79
[2019-03-04T00:00:00.000-00:00]: [3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13, 3821.66] 3535.79
[2019-03-11T00:00:00.000-00:00]: [3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21, 4039.13] 3535.79
[2019-03-18T00:00:00.000-00:00]: [3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79, 3509.21] 3535.79
[2019-03-25T00:00:00.000-00:00]: [4093.12, 3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36, 3535.79] 3628.54
[2019-04-01T00:00:00.000-00:00]: [5192.3, 4093.12, 3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46, 3531.36] 3651.57
[2019-04-08T00:00:00.000-00:00]: [5161.56, 5192.3, 4093.12, 3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57, 3413.46] 3721.64
[2019-04-15T00:00:00.000-00:00]: [5297, 5161.56, 5192.3, 4093.12, 3973.06, 3967.01, 3897.55, 3784.63, 3721.64, 3628.54, 3651.57] 3784.63`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });
});
