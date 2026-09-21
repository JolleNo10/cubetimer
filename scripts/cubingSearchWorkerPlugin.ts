import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Plugin } from "vite";

/**
 * Ship cubing.js's search worker as one self-contained file.
 *
 * cubing.js starts its solver worker with
 * `new Worker(import.meta.resolve("./search-worker-entry.js"))`. Vite cannot rewrite
 * that call, and two things go wrong in a production build:
 *
 *  - the resolved path does not exist, because Vite emitted the entry under a hashed
 *    name; and
 *  - when cubing.js falls back to a dynamic import, the worker ends up loading chunks
 *    that Rollup shares with the main bundle, which reference `window` and `document`
 *    and throw immediately inside a worker.
 *
 * So the worker is built separately, with esbuild, and emitted under exactly the name
 * cubing.js asks for. Its dependency graph is then entirely its own.
 */
export function cubingSearchWorker(): Plugin {
  return {
    name: "cubing-search-worker",
    apply: "build",
    async generateBundle(_options, bundle) {
      // `cubing`'s `exports` map hides the chunk directory, so find it relative to an
      // entry point that is exported.
      const entry = resolve(
        dirname(fileURLToPath(import.meta.resolve("cubing/search"))),
        "../chunks/search-worker-entry.js",
      );

      // Emit beside our own JS, because cubing.js resolves the worker relative to the
      // chunk that asks for it.
      const assetsDir =
        Object.keys(bundle)
          .find((name) => name.endsWith(".js") && name.includes("/"))
          ?.split("/")
          .slice(0, -1)
          .join("/") ?? "assets";

      const result = await build({
        entryPoints: [entry],
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        minify: true,
        write: false,
        logLevel: "silent",
      });

      const output = result.outputFiles?.[0];
      if (!output) throw new Error("esbuild produced no search worker output");

      this.emitFile({
        type: "asset",
        fileName: `${assetsDir}/search-worker-entry.js`,
        source: output.text,
      });
      this.info(
        `built search worker (${Math.round(output.text.length / 1024)} kB)`,
      );
    },
  };
}
