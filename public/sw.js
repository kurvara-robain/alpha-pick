const CACHE = 'alphamind-v2'
const ASSETS = ['/', '/index.html', '/manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  if (event.request.url.includes('/api/')) return

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request).then((response) => {
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()))
        }
        return response
      })
      return cached || fetched
    }),
  )
})
