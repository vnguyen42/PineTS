// VIN-156: shared pivot methods also serve ordinary streaming consumers.
import {it, expect} from 'vitest';
import {PineTS} from '../../../src/PineTS.class';

it('pivot plots match full replay after last-bar corrections and extensions', async () => {
    const candles = Array.from({length:60}, (_,n) => ({openTime:n*60000,closeTime:(n+1)*60000-1,
        open:100,close:100+Math.sin(n),high:105+Math.round(Math.sin(n)*4),low:95+Math.round(Math.cos(n)*4),volume:10}));
    let count=40;
    const provider={configure(){},async getMarketData(_s,_t,_l,start){return candles.slice(0,count).filter(c=>start===undefined||c.openTime>=start);},
        async getSymbolInfo(){return {ticker:'TEST',tickerid:'FILE:TEST',type:'crypto',currency:'USD',timezone:'Etc/UTC',mintick:.01,pricescale:100,minmove:1,pointvalue:1,session:'24x7'};}};
    const source=`//@version=6
indicator("Pivot correction")
width=bar_index%3+1
ph=ta.pivothigh(high,width,2)
pl=ta.pivotlow(low,2,width)
plot(ph,"high")
plot(pl,"low")
plot(ta.pivothigh(2,1),"default")
`;
    const engine=new PineTS(provider as any,'TEST','1');const context=await engine.run(source);
    for(const next of [40,45,45,60]) {
        count=next;candles[count-1].high+=7;candles[count-1].low-=7;
        await engine.updateTail(context);
        const full=await new PineTS(provider as any,'TEST','1').run(source);
        expect(context.plots).toEqual(full.plots);
    }
});
