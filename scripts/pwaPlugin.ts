import type { Plugin } from "vite";

// Only disposable Cubetimer asset caches in this worker's scope are eligible.
export const DEV_PWA_CLEANUP_WORKER = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const scope = self.registration.scope;
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith('cubetimer-') && key.endsWith(scope))
        .map(key => caches.delete(key)));
    } finally {
      await self.clients.claim();
      await self.registration.unregister();
    }
  })());
});
`;

export function devPwaCleanup(): Plugin {
  return {
    name: "cubetimer-dev-pwa-cleanup", apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (new URL(req.url ?? "/", "http://localhost").pathname !== "/sw.js") return next();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Service-Worker-Allowed", "/");
        res.end(req.method === "HEAD" ? undefined : DEV_PWA_CLEANUP_WORKER);
      });
    },
  };
}
