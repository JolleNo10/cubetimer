/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { devPwaCleanup } from "./scripts/pwaPlugin";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { cubingSearchWorker } from "./scripts/cubingSearchWorkerPlugin";

/**
 * Port comes from `PORT`, so the same command works on the host and in a container:
 *   PORT=4000 npm run dev
 *   npm run dev -- --port 4000   (a flag still wins)
 */
const port = Number(process.env.PORT) || 5173;

const allowedHosts = [
  ".orb.local", // OrbStack gives every container a domain
  ".local", // mDNS names, for testing on a phone over the LAN
  ...(process.env.ALLOWED_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean) ?? []),
];

/**
 * Web Bluetooth only works in a secure context: `localhost`, or HTTPS anywhere else.
 * Set `HTTPS=1` to serve over HTTPS with a self-signed certificate, which is what makes
 * a cube usable when testing from a phone or another machine on the network.
 */
const https = process.env.HTTPS === "1" || process.env.HTTPS === "true";

// Docker Desktop can drop file change events from bind mounts, especially on Windows.
// Compose opts into polling; native dev keeps Vite’s default watcher.
const watchUsePolling = process.env.WATCH_USE_POLLING === "1" || process.env.WATCH_USE_POLLING === "true";

export default defineConfig({
  plugins: [
    devPwaCleanup(), react(), cubingSearchWorker(), ...(https ? [basicSsl()] : []),
    VitePWA({
      registerType: "prompt", injectRegister: null,
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Cubetimer", short_name: "Cubetimer", id: "/", start_url: "/", scope: "/",
        description: "Offline cube timer, smart-cube tracking, training and solve analysis.",
        display: "standalone", theme_color: "#0a0c10", background_color: "#0a0c10",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        cacheId: "cubetimer", globPatterns: ["**/*.{html,js,css,png,svg,ico,wasm,json,woff,woff2}"],
        // Current search worker is ~1.2 MB. Include every lazy chunk with headroom;
        // the build verification checks emitted assets against the precache.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "/index.html", cleanupOutdatedCaches: true,
        skipWaiting: false, clientsClaim: false,
        // Only hashed filenames can skip revisioning. The stable search worker
        // must receive a content revision and a new cache entry each deployment.
        dontCacheBustURLsMatching: /-[A-Za-z0-9_-]{8}\./,
      },
    }),
  ],
  server: {
    port,
    // Bind to every interface so the port is reachable when running in a container.
    host: true,
    strictPort: true,
    ...(watchUsePolling ? { watch: { usePolling: true } } : {}),
    // Vite rejects unknown Host headers. Allow OrbStack's container domains and
    // anything else named in ALLOWED_HOSTS (comma separated).
    allowedHosts,
  },
  preview: { port, host: true, strictPort: true, allowedHosts },
  build: {
    target: "es2022",
    // cubing.js runs its solvers in a worker that shares chunks with the main bundle.
    // Vite's module-preload helper touches `document`, which does not exist in a
    // worker, and the worker dies on load. Turning the helper off keeps chunks usable
    // from both contexts.
    modulePreload: false,
  },
  worker: { format: "es" },
  test: {
    // gan-web-bluetooth pulls in CommonJS `aes-js`; inlining lets Vite handle the interop.
    server: { deps: { inline: ["gan-web-bluetooth"] } },
  },
});
