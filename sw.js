// Portfolio V2 service worker — generated into /sw.js by build-preview.py --production.
// Pages: network first (4 s), so a deploy shows up on the next visit; offline falls
// back to the last saved copy. Versioned 3D assets, fonts and viewed covers are
// cache first. Supabase REST data is not touched: the page keeps its own copy.
const VERSION = '9fafb78f8f';
const SHELL = 'portfolio-shell-' + VERSION;
const STATIC = 'portfolio-static-v1';
const IMAGES = 'portfolio-images-v1';
const PRECACHE = ["index.html", "orbit-assets/three.module.min.js?v=f7cee3c753", "orbit-assets/david-mesh.bin.gz?v=993cc4898d"];
const SCOPE = new URL(self.registration.scope).pathname;
const PAGE_TIMEOUT = 4000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const [home, ...assets] = PRECACHE;
    await (await caches.open(SHELL)).add(home);
    // Versioned assets survive deploys; only download the ones not cached yet.
    const cache = await caches.open(STATIC);
    for (const asset of assets) if (!(await cache.match(asset))) await cache.add(asset);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, STATIC, IMAGES]);
    for (const key of await caches.keys()) if (key.startsWith('portfolio-') && !keep.has(key)) await caches.delete(key);
    // Drop superseded versions of the 3D assets.
    const current = new Set(PRECACHE.map(path => new URL(path, self.registration.scope).href));
    const cache = await caches.open(STATIC);
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (url.pathname.startsWith(SCOPE + 'orbit-assets/') && url.search && !current.has(url.href)) await cache.delete(request);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (request.mode === 'navigate') {
    if (sameOrigin && (url.pathname === SCOPE || url.pathname === SCOPE + 'index.html')) event.respondWith(page(request));
    return;
  }
  if (sameOrigin && url.pathname.startsWith(SCOPE + 'orbit-assets/')) {
    event.respondWith(url.search ? cacheFirst(request, STATIC, 0) : staleWhileRevalidate(request, STATIC));
  } else if (url.hostname.endsWith('.supabase.co') && url.pathname.includes('/storage/v1/object/public/')) {
    event.respondWith(cacheFirst(request, IMAGES, 60));
  } else if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, STATIC, 0));
  } else if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(request, STATIC));
  }
});

async function page(request) {
  const cache = await caches.open(SHELL);
  // Revalidate with the server (a cheap 304 when unchanged) instead of reusing
  // GitHub Pages' 10-minute HTTP cache, so a deploy shows on the next visit.
  const network = fetch(request, { cache: 'no-cache' }).then(response => {
    if (response.ok) cache.put('index.html', response.clone());
    return response;
  });
  network.catch(() => {});
  try {
    return await Promise.race([network, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PAGE_TIMEOUT))]);
  } catch (error) {
    return (await cache.match('index.html')) || network;
  }
}

// Only CORS/same-origin responses are stored; opaque ones would inflate quota.
function storable(response) {
  return response.ok && (response.type === 'basic' || response.type === 'cors');
}

async function cacheFirst(request, name, limit) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (storable(response)) {
    await cache.put(request, response.clone());
    if (limit) trim(cache, limit);
  }
  return response;
}

async function staleWhileRevalidate(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  const update = fetch(request).then(response => {
    if (storable(response)) cache.put(request, response.clone());
    return response;
  });
  if (hit) { update.catch(() => {}); return hit; }
  return update;
}

async function trim(cache, limit) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}
