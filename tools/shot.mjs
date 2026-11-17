// Usage: node shot.mjs <url> <outfile.jpg> [w] [h] [quality]
import { chromium } from 'playwright';
import fs from 'node:fs';
const [,,url,out,w='1280',h='720',q='92']=process.argv;
if(!url||!out){console.error('usage: node shot.mjs <url> <out.jpg> [w] [h] [q]');process.exit(2);}
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--hide-scrollbars','--mute-audio']});
const ctx=await b.newContext({viewport:{width:+w,height:+h},deviceScaleFactor:1});
const p=await ctx.newPage();
const errs=[];
p.on('pageerror',e=>errs.push('PAGEERROR: '+String(e)));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text());});
try{
  await p.goto(url,{waitUntil:'load',timeout:60000});
  await p.waitForFunction(()=>window.__shotReady===true,{timeout:90000});
}catch(e){ errs.push('READY-TIMEOUT: '+e.message.slice(0,200)); }
await p.waitForTimeout(400);
const cdp=await ctx.newCDPSession(p);
const {data}=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:+q,fromSurface:true});
fs.writeFileSync(out,Buffer.from(data,'base64'));
const sz=fs.statSync(out).size;
console.log(JSON.stringify({out,bytes:sz,errors:errs.slice(0,8)},null,1));
await b.close();
process.exit(errs.some(e=>e.startsWith('PAGEERROR'))?1:0);
