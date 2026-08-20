
const APP_CACHE='geolive-app-0804-1717-v1';
const REGION_CACHE_PREFIX='geolive-region-';
const TILE_SOURCE='https://wmts.nlsc.gov.tw/wmts/EMAP6_OPENDATA/default/GoogleMapsCompatible/{z}/{y}/{x}';

const SHELL=[
 './','./index.html','./style.css','./app.js','./manifest.webmanifest',
 './icon-180.png','./icon-192.png','./icon-512.png','./town_boundaries.geojson'
];
const EXTERNAL=[
 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
 'https://unpkg.com/exifr/dist/full.umd.js'
];

self.addEventListener('install',e=>{
  e.waitUntil(
    caches.open(APP_CACHE).then(async c=>{
      await c.addAll(SHELL);
      for(const u of EXTERNAL){
        try{await c.add(u)}catch(e){}
      }
    }).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys
        .filter(k=>k.startsWith('geolive-app-') && k!==APP_CACHE)
        .map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;

  const u=new URL(req.url);

  // ★ 1712：離線行政區圖磚
  // /offline-tile/<region-id>/<z>/<x>/<y>.png
  if(u.pathname.includes('/offline-tile/')){
    e.respondWith((async()=>{
      try{
        const tail=u.pathname.split('/offline-tile/')[1];
        const parts=tail.split('/');
        if(parts.length<4)return new Response('',{status:404});

        const id=decodeURIComponent(parts[0]);
        const z=parts[1];
        const x=parts[2];
        const y=parts[3].replace(/\.png$/,'');
        const cacheName=`${REGION_CACHE_PREFIX}${id}-z15-v1`;
        const sourceUrl=TILE_SOURCE
          .replace('{z}',z)
          .replace('{x}',x)
          .replace('{y}',y);

        const c=await caches.open(cacheName);
        const hit=await c.match(sourceUrl);
        return hit || new Response('',{status:404});
      }catch(err){
        return new Response('',{status:404});
      }
    })());
    return;
  }

  // 線上道路圖：直接連網，不混進行政區離線 caches。
  if(u.hostname==='wmts.nlsc.gov.tw'){
    e.respondWith(fetch(req).catch(()=>new Response('',{status:404})));
    return;
  }

  // App shell
  e.respondWith(
    caches.match(req,{ignoreSearch:true}).then(
      hit=>hit||fetch(req).then(r=>{
        if(r.ok){
          const cp=r.clone();
          caches.open(APP_CACHE).then(c=>c.put(req,cp));
        }
        return r;
      }).catch(()=>caches.match('./index.html'))
    )
  );
});
