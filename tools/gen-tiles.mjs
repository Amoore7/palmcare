#!/usr/bin/env node
// PalmCare offline-tile generator
// Run ONCE while online on any machine with Node 18+: download the region's
// tiles as PNG into ./tiles/{z}/{x}/{y}.png (or --out). Then ship/host that
// folder next to the app, open Settings -> «خرائط المنطقة أوفلاين» -> Prepare.
//
// Usage:
//   node tools/gen-tiles.mjs --bbox 46.60,24.68,46.75,24.75 --zoom 10-17
//   node tools/gen-tiles.mjs --bbox 46.60,24.68,46.75,24.75 --zoom 10-17 --source https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png
//
// bbox order: minLng,minLat,maxLng,maxLat  (W,S,E,N)

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import https from 'node:https';

function arg(name){ const i=process.argv.indexOf(name); return i>=0?process.argv[i+1]:null; }
const help=()=>{ console.log('node tools/gen-tiles.mjs --bbox <minLng,minLat,maxLng,maxLat> [--zoom 10-17] [--out ./tiles] [--source URL]'); };

const bbox=(arg('--bbox')||'').split(',').map(Number);
if(bbox.length!==4||bbox.some(isNaN)){ help(); process.exit(1); }
const [minLng,minLat,maxLng,maxLat]=bbox;
const [minZ,maxZ]=(arg('--zoom')||'10-17').split('-').map(Number);
const out=resolve(arg('--out')||'./tiles');
const source=(arg('--source')||'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png').trim();

function lon2z(lon,z){ return (lon+180)/360*Math.pow(2,z); }
function lat2z(lat,z){ return (1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*Math.pow(2,z); }

function get(url){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{'User-Agent':'PalmCare-offline-tiles/1.0'}},res=>{
      if(res.statusCode!==200){ res.resume(); reject(new Error('HTTP '+res.statusCode)); return; }
      const ch=[];
      res.on('data',d=>ch.push(d));
      res.on('end',()=>resolve(Buffer.concat(ch)));
    });
    req.on('error',reject);
    req.setTimeout(15000,()=>{ req.destroy(new Error('timeout')); });
  });
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  let total=0, ok=0, fails=0;
  for(const z of Array.from({length:(maxZ-minZ+1)},(_,i)=>minZ+i)){
    const w=Math.floor(lon2z(minLng,z)), e=Math.floor(lon2z(maxLng,z));
    const s=Math.floor(lat2z(minLat,z)), n=Math.floor(lat2z(maxLat,z));
    for(let x=w;x<=e;x++) for(let y=s;y<=n;y++){
      total++;
      const url=source.replace('{z}',z).replace('{x}',x).replace('{y}',y);
      const rel=`${z}/${x}/${y}.png`, full=resolve(out,rel);
      try{
        if(existsSync(full)){ ok++; continue; }
        const buf=await get(url);
        await mkdir(dirname(full),{recursive:true});
        await writeFile(full,buf);
        ok++;
        if(ok%50===0) console.log('  … '+z+'/'+x+'/'+y+' ('+ok+' ok)');
        await sleep(40);
      }catch(err){ fails++; if(fails<=3) console.error('  FAIL '+url+' — '+err.message); }
    }
  }
  console.log(`Done: ${ok}/${total} tiles -> ${out}${fails?' ('+fails+' failed)':''}`);
})();