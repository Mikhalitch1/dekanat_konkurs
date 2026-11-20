/* Офлайн для «Цифровой деканат»: оболочка приложения и данные ТЕКУЩЕГО пользователя (расписание, «Сегодня», профиль).
   Данные пользователя лежат в кэше dekanat-user и стираются при выходе, смене пользователя и ответе 401. */
const SHELL = 'dekanat-shell-v2';
const USER = 'dekanat-user-v1';
const USER_PATHS = ['/api/schedule', '/api/today', '/api/me'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/icon.svg'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, USER].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (event) => {
  if (event.data === 'clear-user-data') event.waitUntil(caches.delete(USER));
});

const isUserData = (url) => USER_PATHS.some((p) => url.pathname === p);

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isUserData(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(USER);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        else if (response.status === 401) await caches.delete(USER);
        return response;
      } catch {
        const cached = await cache.match(request);
        if (!cached) return new Response(JSON.stringify({ error: 'Нет соединения с сервером. Проверьте интернет и повторите.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        const headers = new Headers(cached.headers);
        headers.set('X-From-Offline-Cache', '1');
        return new Response(await cached.blob(), { status: 200, headers });
      }
    })());
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // остальной API никогда не кэшируется

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) await (await caches.open(SHELL)).put('/', response.clone()); // оболочка всегда свежая
        return response;
      } catch { return (await caches.match('/')) ?? Response.error(); }
    })());
    return;
  }
  // Статика (хэшированные файлы сборки, картинки): сначала кэш, затем сеть.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
