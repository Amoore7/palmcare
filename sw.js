/* PalmCare Service Worker — offline-first app shell + cached raster tiles */
const VERSION='palmcare-v5';
const PRECACHE='palmcare-precache-'+VERSION;
const TILES_CACHE='palmcare-tiles-v2';
const PRECACHE_URLS=[
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/i18n.js',
  './js/geo.js',
  './js/db.js',
  './js/excel.js',
  './js/map.js',
  './js/notifications.js',
  './js/sync.js',
  './js/flow-common.js',
  './js/flow-visit.js',
  './js/flow-palm.js',
  './js/flow-boundary.js',
  './js/reports.js',
  './js/app-core.js',
  './js/app-import.js',
  './js/app-profile.js',
  './js/lib/idb.js',
  './js/lib/xlsx.full.min.js',
  './js/lib/jspdf.umd.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png'
];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(PRECACHE).then(c=>c.addAll(PRECACHE_URLS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==PRECACHE && k!==TILES_CACHE).map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);

  // cross-origin: pass through, never block (tile requests network-first with cache fallback)
  if(url.origin!==location.origin){
    e.respondWith(
      fetch(e.request).then(resp=>{
        if(resp && resp.ok){
          const copy=resp.clone();
          caches.open(TILES_CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
        }
        return resp;
      }).catch(()=>caches.match(e.request).then(r=>r||Response.error()))
    );
    return;
  }

  // navigations: network-first, offline fallback to cached shell
  if(e.request.mode==='navigate'){
    e.respondWith(
      fetch(e.request).catch(()=>caches.match('./index.html').then(r=>r||caches.match('./offline.html')))
    );
    return;
  }

  // static assets: cache-first (stale-while-revalidate keeps it fresh)
  e.respondWith(
    caches.match(e.request).then(cached=>{
      const network=fetch(e.request).then(resp=>{
        if(resp && resp.status===200){
          const copy=resp.clone();
          caches.open(PRECACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
        }
        return resp;
      }).catch(()=>cached);
      return cached||network;
    })
  );
});