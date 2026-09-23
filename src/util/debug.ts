/**
 * Opt-in tracing for the parts of the app that cannot be understood from their output.
 *
 * Grip tracking is the reason this exists: it turns a stream of quaternions into a
 * claim about which way the solver was holding the cube, and when that claim is wrong
 * the only way to find out why is to watch it being made. Nothing here runs unless it
 * is asked for, because the trace is one line per move.
 *
 * Turn a channel on with `?debugGrip=1` in the URL, or for good with
 * `localStorage["cubetimer.debug.grip"] = "1"`.
 */
export type DebugChannel = "grip";

const STORAGE_PREFIX = "cubetimer.debug.";
const enabled = new Map<DebugChannel, boolean>();

function queryFlag(channel: DebugChannel): boolean {
  if (typeof location === "undefined") return false;
  const name = `debug${channel[0].toUpperCase()}${channel.slice(1)}`;
  return new URLSearchParams(location.search).get(name) === "1";
}

function storageFlag(channel: DebugChannel): boolean {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${channel}`) === "1";
  } catch {
    return false; // Private browsing, or no DOM at all.
  }
}

export function debugEnabled(channel: DebugChannel): boolean {
  const known = enabled.get(channel);
  if (known !== undefined) return known;
  const on = queryFlag(channel) || storageFlag(channel);
  enabled.set(channel, on);
  return on;
}

/**
 * Write a line to a channel, if it is on.
 *
 * Always `console.log`, never `console.error`: the end-to-end checks treat anything on
 * the error channel as a failed test, and a trace is not a failure.
 */
export function debugLog(channel: DebugChannel, ...parts: unknown[]): void {
  if (!debugEnabled(channel)) return;
  console.log(`[${channel}]`, ...parts);
}
