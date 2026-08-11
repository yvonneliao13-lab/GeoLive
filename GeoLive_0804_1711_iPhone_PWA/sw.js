
const APP_CACHE='geolive-app-0804-1711-v1';
const TILE_CACHE='geolive-tiles-z15-v1';
const SHELL=['./','./index.html','./style.css','./app.js','./manifest.webmanifest','./icon-180.png','./icon-192.png','./icon-512.png'];
const EXTERNAL=[
 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
 'https://unpkg.com/exifr/dist/full.umd.js'
];
self.addEventListener('install',e=>e.waitUntil(caches.open(APP_CACHE).then(async c=>{await c.addAll(SHELL);for(const u of EXTERNAL){try{await c.add(u)}catch(e){}}}).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>![APP_CACHE,TILE_CACHE].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const req=e.request,u=new URL(req.url);
 if(req.method!=='GET')return;
 if(u.hostname==='wmts.nlsc.gov.tw'){
   e.respondWith(caches.open(TILE_CACHE).then(async c=>{
     const hit=await c.match(req.url);if(hit)return hit;
     try{const r=await fetch(req);if(r.ok||r.type==='opaque')c.put(req.url,r.clone());return r}catch(err){return new Response('',{status:404})}
   }));return;
 }
 e.respondWith(caches.match(req,{ignoreSearch:true}).then(hit=>hit||fetch(req).then(r=>{if(r.ok){const cp=r.clone();caches.open(APP_CACHE).then(c=>c.put(req,cp))}return r}).catch(()=>caches.match('./index.html'))));
});
