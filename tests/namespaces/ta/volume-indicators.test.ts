import { describe, expect, it } from 'vitest';
import { arrayPrecision, getKlines, runNSFunctionWithArgs } from '../../utils';

import { Context, PineTS, Provider } from 'index';

describe('Technical Analysis - Volume Indicators', () => {
    it('OBV - On-Balance Volume', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, volume } = context.data;
            const { ta, plotchar } = context.pine;

            const res = ta.obv;
            plotchar(res, 'plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const data = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${data}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: 89446.284892
[2019-05-27T00:00:00.000-00:00]: 104957.474839
[2019-06-03T00:00:00.000-00:00]: 90871.2614
[2019-06-10T00:00:00.000-00:00]: 104957.190506
[2019-06-17T00:00:00.000-00:00]: 121253.136353
[2019-06-24T00:00:00.000-00:00]: 92141.776478
[2019-07-01T00:00:00.000-00:00]: 112223.38526
[2019-07-08T00:00:00.000-00:00]: 91276.42289999999
[2019-07-15T00:00:00.000-00:00]: 113561.791623
[2019-07-22T00:00:00.000-00:00]: 102675.475375
[2019-07-29T00:00:00.000-00:00]: 115455.85888799999
[2019-08-05T00:00:00.000-00:00]: 135776.055283
[2019-08-12T00:00:00.000-00:00]: 117985.645096
[2019-08-19T00:00:00.000-00:00]: 102110.835788
[2019-08-26T00:00:00.000-00:00]: 89352.97573199999
[2019-09-02T00:00:00.000-00:00]: 103126.65808699999
[2019-09-09T00:00:00.000-00:00]: 92166.30263199999
[2019-09-16T00:00:00.000-00:00]: 80304.05413599999`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('PVT - Price Volume Trend', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, volume } = context.data;
            const { ta, plotchar } = context.pine;

            const res = ta.pvt;
            plotchar(res, 'plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const data = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${data}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: 15337.802315843166
[2019-05-27T00:00:00.000-00:00]: 15356.416198469828
[2019-06-03T00:00:00.000-00:00]: 13575.727171494544
[2019-06-10T00:00:00.000-00:00]: 16064.884481402478
[2019-06-17T00:00:00.000-00:00]: 19435.696746975118
[2019-06-24T00:00:00.000-00:00]: 19171.829969413066
[2019-07-01T00:00:00.000-00:00]: 20539.08462369204
[2019-07-08T00:00:00.000-00:00]: 18165.796052540696
[2019-07-15T00:00:00.000-00:00]: 19061.85176233425
[2019-07-22T00:00:00.000-00:00]: 17977.951208780873
[2019-07-29T00:00:00.000-00:00]: 19906.95341398183
[2019-08-05T00:00:00.000-00:00]: 20953.594020523
[2019-08-12T00:00:00.000-00:00]: 19068.32917199785
[2019-08-19T00:00:00.000-00:00]: 18791.089046120393
[2019-08-26T00:00:00.000-00:00]: 18315.557354230292
[2019-09-02T00:00:00.000-00:00]: 19218.458558248247
[2019-09-09T00:00:00.000-00:00]: 19130.676802024143
[2019-09-16T00:00:00.000-00:00]: 18798.131021796697`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('WAD - Williams Accumulation/Distribution', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, volume } = context.data;
            const { ta, plotchar } = context.pine;

            const res = ta.wad;
            plotchar(res, 'plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const data = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${data}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: 6479.750000000001
[2019-05-27T00:00:00.000-00:00]: 7234.470000000001
[2019-06-03T00:00:00.000-00:00]: 6120.31
[2019-06-10T00:00:00.000-00:00]: 7584.03
[2019-06-17T00:00:00.000-00:00]: 9492.71
[2019-06-24T00:00:00.000-00:00]: 6377.219999999999
[2019-07-01T00:00:00.000-00:00]: 8189.66
[2019-07-08T00:00:00.000-00:00]: 5194.67
[2019-07-15T00:00:00.000-00:00]: 6706.99
[2019-07-22T00:00:00.000-00:00]: 5550.389999999999
[2019-07-29T00:00:00.000-00:00]: 7168.259999999998
[2019-08-05T00:00:00.000-00:00]: 7735.989999999998
[2019-08-12T00:00:00.000-00:00]: 6501.769999999997
[2019-08-19T00:00:00.000-00:00]: 5686.059999999996
[2019-08-26T00:00:00.000-00:00]: 4805.779999999995
[2019-09-02T00:00:00.000-00:00]: 5462.5899999999965
[2019-09-09T00:00:00.000-00:00]: 5238.669999999996
[2019-09-16T00:00:00.000-00:00]: 4881.739999999996`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('WVAD - Williams Variable Accumulation/Distribution', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, volume } = context.data;
            const { ta, plotchar } = context.pine;

            const res = ta.wvad;
            plotchar(res, 'plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const data = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${data}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: 6372.573213078506
[2019-05-27T00:00:00.000-00:00]: 137.31337632315237
[2019-06-03T00:00:00.000-00:00]: -11873.976218130234
[2019-06-10T00:00:00.000-00:00]: 10210.827235693283
[2019-06-17T00:00:00.000-00:00]: 12964.03086576702
[2019-06-24T00:00:00.000-00:00]: -659.0936931990249
[2019-07-01T00:00:00.000-00:00]: 6196.698769651293
[2019-07-08T00:00:00.000-00:00]: -8835.299375193936
[2019-07-15T00:00:00.000-00:00]: 4467.649104943089
[2019-07-22T00:00:00.000-00:00]: -7365.350507025323
[2019-07-29T00:00:00.000-00:00]: 10748.410082409004
[2019-08-05T00:00:00.000-00:00]: 8527.381878533937
[2019-08-12T00:00:00.000-00:00]: -11952.018587761146
[2019-08-19T00:00:00.000-00:00]: -2350.143587241499
[2019-08-26T00:00:00.000-00:00]: -3628.8844260271712
[2019-09-02T00:00:00.000-00:00]: 7564.6023130685735
[2019-09-09T00:00:00.000-00:00]: -1411.3721935498008
[2019-09-16T00:00:00.000-00:00]: -4382.250268397727`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('ACCDIST - Accumulation/Distribution', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, volume } = context.data;
            const { ta, plotchar } = context.pine;

            const res = ta.accdist;
            plotchar(res, 'plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const data = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${data}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: 58083.38520674319
[2019-05-27T00:00:00.000-00:00]: 63873.973549283626
[2019-06-03T00:00:00.000-00:00]: 54022.08936283559
[2019-06-10T00:00:00.000-00:00]: 62081.847361199994
[2019-06-17T00:00:00.000-00:00]: 72241.07638162277
[2019-06-24T00:00:00.000-00:00]: 50462.72596604885
[2019-07-01T00:00:00.000-00:00]: 61074.01376818415
[2019-07-08T00:00:00.000-00:00]: 41203.704244686545
[2019-07-15T00:00:00.000-00:00]: 52237.77084266267
[2019-07-22T00:00:00.000-00:00]: 47100.67974849734
[2019-07-29T00:00:00.000-00:00]: 58353.25810515342
[2019-08-05T00:00:00.000-00:00]: 55201.83436743435
[2019-08-12T00:00:00.000-00:00]: 48865.75150319858
[2019-08-19T00:00:00.000-00:00]: 43165.68460222041
[2019-08-26T00:00:00.000-00:00]: 38956.24034769195
[2019-09-02T00:00:00.000-00:00]: 40495.949511536106
[2019-09-09T00:00:00.000-00:00]: 44258.16212222058
[2019-09-16T00:00:00.000-00:00]: 45302.1612265188`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('NVI - Negative Volume Index', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, volume } = context.data;
            const { ta, plotchar } = context.pine;

            const res = ta.nvi;
            plotchar(res, 'plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const data = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${data}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: 1.229032469680105
[2019-05-27T00:00:00.000-00:00]: 1.2305073446712016
[2019-06-03T00:00:00.000-00:00]: 1.0749544747848245
[2019-06-10T00:00:00.000-00:00]: 1.2649121814148503
[2019-06-17T00:00:00.000-00:00]: 1.2649121814148503
[2019-06-24T00:00:00.000-00:00]: 1.2649121814148503
[2019-07-01T00:00:00.000-00:00]: 1.3510336214881082
[2019-07-08T00:00:00.000-00:00]: 1.3510336214881082
[2019-07-15T00:00:00.000-00:00]: 1.3510336214881082
[2019-07-22T00:00:00.000-00:00]: 1.2165174034359993
[2019-07-29T00:00:00.000-00:00]: 1.2165174034359993
[2019-08-05T00:00:00.000-00:00]: 1.2165174034359993
[2019-08-12T00:00:00.000-00:00]: 1.0876020229467471
[2019-08-19T00:00:00.000-00:00]: 1.0686079729461349
[2019-08-26T00:00:00.000-00:00]: 1.0287770800603533
[2019-09-02T00:00:00.000-00:00]: 1.0287770800603533
[2019-09-09T00:00:00.000-00:00]: 1.0205375791407363
[2019-09-16T00:00:00.000-00:00]: 1.0205375791407363`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('PVI - Positive Volume Index', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, volume } = context.data;
            const { ta, plotchar } = context.pine;

            const res = ta.pvi;
            plotchar(res, 'plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const data = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${data}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: 2.221033850070325
[2019-05-27T00:00:00.000-00:00]: 2.221033850070325
[2019-06-03T00:00:00.000-00:00]: 2.221033850070325
[2019-06-10T00:00:00.000-00:00]: 2.221033850070325
[2019-06-17T00:00:00.000-00:00]: 2.680454138672188
[2019-06-24T00:00:00.000-00:00]: 2.656158372379879
[2019-07-01T00:00:00.000-00:00]: 2.656158372379879
[2019-07-08T00:00:00.000-00:00]: 2.3552159159034773
[2019-07-15T00:00:00.000-00:00]: 2.4499150297244605
[2019-07-22T00:00:00.000-00:00]: 2.4499150297244605
[2019-07-29T00:00:00.000-00:00]: 2.8196920000388768
[2019-08-05T00:00:00.000-00:00]: 2.964927020794195
[2019-08-12T00:00:00.000-00:00]: 2.964927020794195
[2019-08-19T00:00:00.000-00:00]: 2.964927020794195
[2019-08-26T00:00:00.000-00:00]: 2.964927020794195
[2019-09-02T00:00:00.000-00:00]: 3.1592858064771434
[2019-09-09T00:00:00.000-00:00]: 3.1592858064771434
[2019-09-16T00:00:00.000-00:00]: 3.070718519775072`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });

    it('III - Intraday Intensity Index', async () => {
        const pineTS = new PineTS(Provider.Mock, 'BTCUSDC', 'W', null, new Date('2018-12-10').getTime(), new Date('2020-01-27').getTime());

        const sourceCode = (context) => {
            const { close, volume } = context.data;
            const { ta, plotchar } = context.pine;

            const res = ta.iii;
            plotchar(res, 'plot');

            return { res };
        };

        const { result, plots } = await pineTS.run(sourceCode);

        let _plotdata = plots['plot']?.data;
        const startDate = new Date('2019-05-20').getTime();
        const endDate = new Date('2019-09-16').getTime();

        let plotdata_str = '';
        for (let i = 0; i < _plotdata.length; i++) {
            const time = _plotdata[i].time;
            if (time < startDate || time > endDate) {
                continue;
            }

            const str_time = new Date(time).toISOString().slice(0, -1) + '-00:00';
            const data = _plotdata[i].value;
            plotdata_str += `[${str_time}]: ${data}\n`;
        }

        const expected_plot = `[2019-05-20T00:00:00.000-00:00]: 0.00005812109739991394
[2019-05-27T00:00:00.000-00:00]: 0.000024067581956122864
[2019-06-03T00:00:00.000-00:00]: -0.00004965131652709883
[2019-06-10T00:00:00.000-00:00]: 0.00004062103692569259
[2019-06-17T00:00:00.000-00:00]: 0.0000382561802647395
[2019-06-24T00:00:00.000-00:00]: -0.000025698039673542067
[2019-07-01T00:00:00.000-00:00]: 0.000026313043847686743
[2019-07-08T00:00:00.000-00:00]: -0.000045285850406568174
[2019-07-15T00:00:00.000-00:00]: 0.000022217539075723904
[2019-07-22T00:00:00.000-00:00]: -0.00004334663352947436
[2019-07-29T00:00:00.000-00:00]: 0.00006889128304302301
[2019-08-05T00:00:00.000-00:00]: -0.000007632222096308906
[2019-08-12T00:00:00.000-00:00]: -0.00002001930172827031
[2019-08-19T00:00:00.000-00:00]: -0.000022618454085654467
[2019-08-26T00:00:00.000-00:00]: -0.000025862416090718213
[2019-09-02T00:00:00.000-00:00]: 0.000008115935150607004
[2019-09-09T00:00:00.000-00:00]: 0.00003131800267566069
[2019-09-16T00:00:00.000-00:00]: 0.000007419353961987313`;

        console.log('expected_plot', expected_plot);
        console.log('plotdata_str', plotdata_str);
        expect(plotdata_str.trim()).toEqual(expected_plot.trim());
    });
});
