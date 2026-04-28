const CACHE_NAME = 'cinehome-v1';

// Arquivos essenciais para cache (interface carrega offline)
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

// Instalar: cacheia a interface base
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Ativar: limpa caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first para API e streaming, cache-first para assets estáticos
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca cachear chamadas de API ou stream de vídeo
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/hls/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Para assets estáticos: tenta rede primeiro, fallback para cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Salva cópia no cache
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
