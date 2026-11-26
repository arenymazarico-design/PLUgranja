const C='plugranja-202611261242';
const SHELL=['./','index.html','logo.png','logo-white.png','icon-192.png','icon-180.png','manifest.json','qrcode.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL.map(u=>new Request(u,{cache:'reload'})))).catch(()=>{}));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const req=e.request,u=new URL(req.url);
 if(req.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api')||u.pathname==='/version.json')return;
 if(req.mode==='navigate'){ // pàgina: sempre de la xarxa (sense memòria cau); si no hi ha cobertura, la còpia guardada
  e.respondWith(fetch(req,{cache:'no-store'}).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put('index.html',cp));return r}).catch(()=>caches.match('index.html')));return}
 e.respondWith(fetch(req,{cache:'no-cache'}).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(req,cp))}return r}).catch(()=>caches.match(req,{ignoreSearch:true})))});
