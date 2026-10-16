import { describe, expect, it } from 'vitest';
import { Context, PineTS, Provider } from 'index';

describe('Array Stack & Queue Operations', () => {
    it('invalid INSERT, PUSH, SET, UNSHIFT', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        try {
            await pineTS.run((context) => {
                const { array } = context.pine;
                let a = array.new_float(5, 0);
                array.insert(a, 1, 'invalid_type');
            });
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toContain('array.insert');
        }

        try {
            await pineTS.run((context) => {
                const { array } = context.pine;
                let a = array.new_float(5, 0);
                array.push(a, 'invalid_type');
            });
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toContain('array.push');
        }

        try {
            await pineTS.run((context) => {
                const { array } = context.pine;
                let a = array.new_float(5, 0);
                array.set(a, 1, 'invalid_type');
            });
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toContain('array.set');
        }

        try {
            await pineTS.run((context) => {
                const { array } = context.pine;
                let a = array.new_float(5, 0);
                array.unshift(a, 'invalid_type');
            });
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toContain('array.unshift');
        }
    });

    it('PUSH, POP, UNSHIFT, SHIFT, INSERT, REMOVE', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume, open } = context.data;
            const { na, plotchar, math, array } = context.pine;

            let a = array.new_float(5, 0);

            array.push(a, open);
            a.push(open - close);
            let pop = a.pop();
            array.shift(a);
            a.shift();
            a.unshift(high - low);
            array.insert(a, 1, 999);
            a.insert(1, 888);
            let rem = a.remove(1);

            let res = a;

            return { pop, rem, res };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];

            const res = JSON.stringify(result.res[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const pop = result.pop[i];
            const rem = result.rem[i];

            plotdata_str += `[${str_time}]: ${pop} ${rem} ${res}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: 0.7300000000000182 888 [312.32000000000016, 999, 0, 0, 0, 3200]
[2018-12-17T00:00:00.000-00:00]: -760.7999999999997 888 [982.75, 999, 0, 0, 0, 3192.69]
[2018-12-24T00:00:00.000-00:00]: 126.35000000000036 888 [771, 999, 0, 0, 0, 3948.01]
[2018-12-31T00:00:00.000-00:00]: -206.86000000000013 888 [456.7600000000002, 999, 0, 0, 0, 3832.27]
[2019-01-07T00:00:00.000-00:00]: 529.79 888 [679.3499999999999, 999, 0, 0, 0, 4039]
[2019-01-14T00:00:00.000-00:00]: -23.84999999999991 888 [270.17999999999984, 999, 0, 0, 0, 3511.94]
[2019-01-21T00:00:00.000-00:00]: 4.529999999999745 888 [224.26999999999998, 999, 0, 0, 0, 3535.89]
[2019-01-28T00:00:00.000-00:00]: 114.19999999999982 888 [303.98, 999, 0, 0, 0, 3527.66]
[2019-02-04T00:00:00.000-00:00]: -238.33000000000038 888 [421.3000000000002, 999, 0, 0, 0, 3413.24]
[2019-02-11T00:00:00.000-00:00]: 23.0300000000002 888 [132.51000000000022, 999, 0, 0, 0, 3651.57]
[2019-02-18T00:00:00.000-00:00]: -93.09999999999991 888 [570.4000000000005, 999, 0, 0, 0, 3628.54]
[2019-02-25T00:00:00.000-00:00]: -53.84999999999991 888 [224.75, 999, 0, 0, 0, 3730.78]
[2019-03-04T00:00:00.000-00:00]: -112.92000000000007 888 [283.9899999999998, 999, 0, 0, 0, 3784.63]
[2019-03-11T00:00:00.000-00:00]: -66.70000000000027 888 [260.34000000000015, 999, 0, 0, 0, 3900.31]
[2019-03-18T00:00:00.000-00:00]: -8.090000000000146 888 [189.20000000000027, 999, 0, 0, 0, 3964.97]
[2019-03-25T00:00:00.000-00:00]: -122.48000000000002 888 [268.75, 999, 0, 0, 0, 3970.64]
[2019-04-01T00:00:00.000-00:00]: -1096.3100000000004 888 [1327.9799999999996, 999, 0, 0, 0, 4095.99]
[2019-04-08T00:00:00.000-00:00]: 35.57999999999993 888 [565.46, 999, 0, 0, 0, 5197.14]
[2019-04-15T00:00:00.000-00:00]: -133.47999999999956 888 [418.8699999999999, 999, 0, 0, 0, 5163.52]`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('PUSH, POP, UNSHIFT, SHIFT, INSERT, REMOVE, CLEAR', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2019-04-20').getTime());

        const sourceCode = (context) => {
            const { close, high, low, volume, open } = context.data;
            const { na, plotchar, math, array } = context.pine;

            let a = array.new_float(5, 0);

            array.push(a, open);
            a.push(open - close);
            let pop = a.pop();
            array.shift(a);
            a.shift();
            a.unshift(high - low);
            array.insert(a, 1, 999);
            a.insert(1, 888);
            let rem = a.remove(1);

            let res = a;
            a.clear();

            return { pop, rem, res };
        };

        const { result, data } = await pineTS.run(sourceCode);

        let plotdata_str = '';
        for (let i = 0; i < data.openTime.data.length; i++) {
            const time = data.openTime.data[i];

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            //const val = result.val[i];

            const res = JSON.stringify(result.res[i].array).replace(/null/g, 'NaN').replace(/,/g, ', ');
            const pop = result.pop[i];
            const rem = result.rem[i];

            plotdata_str += `[${str_time}]: ${pop} ${rem} ${res}\n`;
        }

        const expected_plot = `[2018-12-10T00:00:00.000-00:00]: 0.7300000000000182 888 []
[2018-12-17T00:00:00.000-00:00]: -760.7999999999997 888 []
[2018-12-24T00:00:00.000-00:00]: 126.35000000000036 888 []
[2018-12-31T00:00:00.000-00:00]: -206.86000000000013 888 []
[2019-01-07T00:00:00.000-00:00]: 529.79 888 []
[2019-01-14T00:00:00.000-00:00]: -23.84999999999991 888 []
[2019-01-21T00:00:00.000-00:00]: 4.529999999999745 888 []
[2019-01-28T00:00:00.000-00:00]: 114.19999999999982 888 []
[2019-02-04T00:00:00.000-00:00]: -238.33000000000038 888 []
[2019-02-11T00:00:00.000-00:00]: 23.0300000000002 888 []
[2019-02-18T00:00:00.000-00:00]: -93.09999999999991 888 []
[2019-02-25T00:00:00.000-00:00]: -53.84999999999991 888 []
[2019-03-04T00:00:00.000-00:00]: -112.92000000000007 888 []
[2019-03-11T00:00:00.000-00:00]: -66.70000000000027 888 []
[2019-03-18T00:00:00.000-00:00]: -8.090000000000146 888 []
[2019-03-25T00:00:00.000-00:00]: -122.48000000000002 888 []
[2019-04-01T00:00:00.000-00:00]: -1096.3100000000004 888 []
[2019-04-08T00:00:00.000-00:00]: 35.57999999999993 888 []
[2019-04-15T00:00:00.000-00:00]: -133.47999999999956 888 []`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });
});
