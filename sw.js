// Change this to your repository name
const GHPATH = '/dental-records'; // Your repo name
const APP_PREFIX = 'dental_';
const VERSION = 'version_01';

// Files to cache for offline use [citation:1]
const URLS = [
    `${GHPATH}/`,
    `${GHPATH}/index.html`,
    `${GHPATH}/dental/index.html`,
    `${GHPATH}/manifest.json`
];

// Install service worker and cache files [citation:3]
self.addEventListener('install', function(e) {
    e.waitUntil(
        caches.open(APP_PREFIX + VERSION)
            .then(function(cache) {
                return cache.addAll(URLS);
            })
    );
});

// Serve cached files when offline [citation:9]
self.addEventListener('fetch', function(e) {
    e.respondWith(
        caches.match(e.request).then(function(request) {
            return request || fetch(e.request);
        })
    );
});

// Background sync for pending records [citation:3][citation:7]
self.addEventListener('sync', function(e) {
    if (e.tag === 'sync-dental') {
        e.waitUntil(syncRecords());
    }
});

async function syncRecords() {
    // This will be handled by the page's JavaScript
    // The service worker just wakes up the page
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
        client.postMessage({ type: 'SYNC_RECORDS' });
    });
}
