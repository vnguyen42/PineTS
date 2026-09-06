// VIN-156: exercise the public packaged API with real fixtures and private configuration.
import fs from 'node:fs';import assert from 'node:assert/strict';import{fork}from'node:child_process';import{createHash}from'node:crypto';
const normalize=(_k,v)=>typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0))?{number:String(v),negativeZero:Object.is(v,-0)}:v;
if(process.argv[2]){
 const variant=process.argv[2],now=Number(process.argv[3]);const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
 const{PineTS,Indicator}=await import('pinets');const{prepareBacktest}=await import('pinets/backtest');
 const candles=JSON.parse(fs.readFileSync(new URL('../fixtures/studio-inputs/btc-400.json',import.meta.url)));const rows=[];
 const provider={configure(){},async getMarketData(){return candles},async getSymbolInfo(){return{ticker:'BTCUSDT',tickerid:'FILE:BTCUSDT',type:'crypto',currency:'USDT',basecurrency:'BTC',timezone:'Etc/UTC',mintick:.01,pricescale:100,minmove:1,pointvalue:1,mincontract:.00001,session:'24x7'}}};
 const runFor=(source,options)=>{
  if(variant==='candidate')return prepareBacktest(source,options);
  const i=new Indicator(source,{...options.inputs});for(const[k,v]of Object.entries(options.props||{}))i.prop[k]=v;i.prepare();return(...args)=>new PineTS(...args).run(i);
 };
 const snapshot=(name,r)=>rows.push({name,hash:createHash('sha256').update(JSON.stringify({plots:r.plots,strategy:r.strategy},normalize)).digest('hex'),closed:r.strategy?.closedtrades.length});
 for(const name of ['volatility','webhook','pullback']){
  const source=fs.readFileSync(new URL(`../fixtures/studio-inputs/${name}.pine`,import.meta.url),'utf8').replace(/\u00a0/g,' ');
  const options={inputs:{},props:{initial_capital:20000,currency:'USDT'}};
  if(name==='volatility')options.inputs={'Average length':7,'Multiplier':1};
  if(name==='webhook')options.inputs={'Fast MA length':10,'Slow MA length':30};
  const run=runFor(source,options);options.props.initial_capital=99999;for(const key of Object.keys(options.inputs))options.inputs[key]=100;
  snapshot(name+'-first',await run(provider,'BTCUSDT','5'));
  const [a,b]=await Promise.all([run(provider,'BTCUSDT','5'),run(provider,'BTCUSDT','5')]);snapshot(name+'-parallel-a',a);snapshot(name+'-parallel-b',b);
  const other=runFor(source,{inputs:{},props:{initial_capital:50000,currency:'USDT'}});snapshot(name+'-new-configuration',await other(provider,'BTCUSDT','5'));
 }
 const asyncSource='//@version=6\nindicator("MTF")\np=request.security(syminfo.tickerid,"15",close)\nplot(p,"mtf")';
 // Self-contained market fixture: actual 5-minute timestamps and 15-minute OHLCV.
 const five=candles.slice(0,300).map((c,n)=>({...c,openTime:Date.UTC(2024,0,1)+n*300000,closeTime:Date.UTC(2024,0,1)+(n+1)*300000-1}));
 const fifteen=[];for(let n=0;n<five.length;n+=3){const group=five.slice(n,n+3);fifteen.push({...group[0],high:Math.max(...group.map(c=>c.high)),low:Math.min(...group.map(c=>c.low)),close:group.at(-1).close,closeTime:group.at(-1).closeTime,volume:group.reduce((a,c)=>a+c.volume,0)});}
 const mtfProvider={...provider,async getMarketData(_symbol,period){assert(['5','15'].includes(String(period)));return String(period)==='15'?fifteen:five;}};
 const asyncResult=await runFor(asyncSource,{inputs:{}})(mtfProvider,'BTCUSDT','5');
 assert.equal(asyncResult.plots.mtf.data.length,300);assert(asyncResult.plots.mtf.data.filter(p=>Number.isFinite(p.value)).length>250);
 snapshot('async-original-path',asyncResult);
 const callback=($)=>{const{close}=$.data;const{plot}=$.pine;plot(close,'close');};
 snapshot('javascript-original-path',await runFor(callback,{inputs:{}})(candles));
 if(variant==='candidate') {
  // Returned contexts must not expose the private configuration of future runs,
  // including asynchronous scripts whose inputs retain the ordinary runtime path.
  const fixed=prepareBacktest(asyncSource+'\nlength=input.int(3,"Length")\nplot(length,"length")',{inputs:{Length:7}});
  const first=await fixed(mtfProvider,'BTCUSDT','5');first.inputs.Length=99;
  const second=await fixed(mtfProvider,'BTCUSDT','5');
  assert.notEqual(first.inputs,second.inputs);
  assert(second.plots.length.data.every(p=>p.value===7));
 }
 if(variant==='candidate')assert.throws(()=>prepareBacktest('//@version=6\nindicator("source")\nplot(close)',{inputs:{Source:[]}}),/must be a string, number or boolean/);
 process.send(rows);
}else{
 const now=Date.now(),results={};for(const variant of ['baseline','candidate'])results[variant]=await new Promise((resolve,reject)=>{const w=fork(new URL(import.meta.url),[variant,String(now)],{stdio:['ignore','ignore','inherit','ipc']});let rows;w.on('message',r=>{rows=r;w.disconnect();});w.on('exit',code=>code?reject(Error(`${variant} exit ${code}`)):resolve(rows));w.on('error',reject);});
 assert.deepEqual(results.candidate,results.baseline);console.log(JSON.stringify({passed:true,cases:results.candidate.length,results},null,2));
}
