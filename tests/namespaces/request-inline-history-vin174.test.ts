import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { param } from '../../src/namespaces/request/methods/param';

// Native BCHUSDT 240, 19–20 August 2020. TV confirms inline EMA20[1]
// and a stored EMA20 series[1] are identical. The shorter fixture uses its
// own warm-up; only equality and prefix causality, not absolute TV EMA, apply.
const rows = [
    [1597795200,303.15,309.16,296.05,297.7],[1597809600,297.73,299.24,290.44,299.06],
    [1597824000,299.16,300.29,294,296.94],[1597838400,296.9,298.75,290,292.3],
    [1597852800,292.36,294.19,284.23,284.73],[1597867200,284.81,292.99,280.8,292.73],
    [1597881600,292.74,296.32,289.01,290.14],[1597896000,290.21,293.92,288.63,290.41],
    [1597910400,290.37,294.9,289.74,293.13],[1597924800,293.21,295.45,291.06,294.35],
    [1597939200,294.4,295.08,291.3,292.71],[1597953600,292.84,295.26,291.38,294.69],
];
const source = `//@version=5
indicator("VIN174 inline request history")
e = ta.ema(close, 20)
plot(request.security(syminfo.tickerid, "D", ta.ema(close, 20)[1], lookahead=barmerge.lookahead_on), "inline")
plot(request.security(syminfo.tickerid, "D", e[1], lookahead=barmerge.lookahead_on), "stored")
plot(request.security(syminfo.tickerid, "D", close, lookahead=barmerge.lookahead_on), "requested future")`;
async function run(count: number, script=source, timeframe='240') {
    const bars = rows.slice(0,count).map(([t,open,high,low,close])=>({openTime:t*1000,closeTime:t*1000+14400000-1,open,high,low,close,volume:1}));
    const daily = [0,6].filter(i=>i<bars.length).map(i=>({ ...bars[i],closeTime:bars[i].openTime+86400000-1,close:bars[Math.min(i+5,bars.length-1)].close }));
    if (timeframe === '240') {
        // Finite EMA20 before the measured bars; shared deterministic warm-up.
        daily.unshift(...Array.from({length:20},(_,i)=>({...daily[0],openTime:daily[0].openTime-(20-i)*86400000,closeTime:daily[0].openTime-(19-i)*86400000-1,close:280})));
    }
    const provider = {configure(){},async getSymbolInfo(){return {tickerid:'BINANCE:BCHUSDT',ticker:'BCHUSDT',prefix:'BINANCE',mintick:.1,pointvalue:1,timezone:'Etc/UTC',session:'24x7',type:'crypto',currency:'USDT'};},async getMarketData(_s,tf){return tf==='D'?daily:bars;}};
    return (await new PineTS(provider,'BCHUSDT',timeframe).run(script)).plots;
}
describe('VIN174 request inline history',()=>{
    it('preserves confirmed EMA history when the future daily close changes',async()=>{
        const full=await run(12),prefix=await run(8);
        expect(Number.isFinite(full.inline.data[6].value)).toBe(true);
        expect(full.inline.data.map(x=>x.value)).toEqual(full.stored.data.map(x=>x.value));
        expect(prefix.inline.data.map(x=>x.value)).toEqual(full.inline.data.slice(0,8).map(x=>x.value));
        expect(prefix.stored.data.map(x=>x.value)).toEqual(full.stored.data.slice(0,8).map(x=>x.value));
        expect(prefix['requested future'].data[7].value).not.toEqual(full['requested future'].data[7].value);
    });
    it('retains raw scalar history across offset zero and same-bar recalculation',()=>{
        const context:any={params:{}};const p=param(context);
        expect(p(10,0,'expression')[0]).toBe(10);
        for(const v of Object.values(context.params) as any[])v.push(v.at(-1));
        expect(p(20,1,'expression')[0]).toBe(10);
        expect(p(21,1,'expression')[0]).toBe(10);
        expect(context.params.expression.at(-1)).toBe(10);
    });
});

it('VIN174 LTF lookahead selects the first closed intrabar independently of gaps',async()=>{
    const plots=await run(12,`//@version=5
indicator("VIN174 LTF")
a=request.security_lower_tf(syminfo.tickerid,"240",close)
plot(array.size(a),"count")
plot(array.get(a,0),"first")
plot(array.get(a,array.size(a)-1),"last")
plot(request.security(syminfo.tickerid,"240",close,lookahead=barmerge.lookahead_on),"on")
plot(request.security(syminfo.tickerid,"240",close,lookahead=barmerge.lookahead_off),"off")`, 'D');
    expect(plots.count.data.map(x=>x.value)).toEqual([6,6]);
    expect(plots.first.data.map(x=>x.value)).toEqual([297.7,290.14]);
    expect(plots.last.data.map(x=>x.value)).toEqual([292.73,294.69]);
    expect(plots.on.data.map(x=>x.value)).toEqual(plots.first.data.map(x=>x.value));
    expect(plots.off.data.map(x=>x.value)).toEqual(plots.last.data.map(x=>x.value));
});
