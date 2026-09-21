import { setSearchDebug } from "cubing/search";

/** Search worker settings. See `scripts/cubingSearchWorkerPlugin.ts` for how the
 * worker itself is emitted in production builds. */
setSearchDebug({
  // Without this, every scramble logs its timing to the console.
  logPerf: false,
});
