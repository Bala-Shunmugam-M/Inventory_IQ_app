/* InventoryIQ service worker — minimal offline shell for PWA / APK packaging */
var CACHE='iq-v2-2';
var CORE=['index.html','dashboard.html','manifest.webmanifest'];
self.addEventListener('install',function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(CORE).catch(function(){});}));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){return Promise.all(keys.map(function(k){if(k!==CACHE)return caches.delete(k);}));}));
  self.clients.claim();
});
self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET')return;
  e.respondWith(
    fetch(e.request).then(function(res){
      var copy=res.clone();
      caches.open(CACHE).then(function(c){c.put(e.request,copy).catch(function(){});});
      return res;
    }).catch(function(){return caches.match(e.request).then(function(m){return m||caches.match('index.html');});})
  );
});
