/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
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

export default defineConfig({
  plugins: [react(), cubingSearchWorker(), ...(https ? [basicSsl()] : [])],
  server: {
    port,
    // Bind to every interface so the port is reachable when running in a container.
    host: true,
    strictPort: true,
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
