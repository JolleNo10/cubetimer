/**
 * Opt-in tracing for the parts of the app that cannot be understood from their output.
 *
 * Grip tracking is the reason this exists: it turns a stream of quaternions into a
 * claim about which way the solver was holding the cube, and when that claim is wrong
 * the only way to find out why is to watch it being made. Nothing here runs unless it
 * is asked for, because the trace is one line per move.
 *
 * Three ways to turn a channel on, in order of how much they can go wrong:
 *
 *   ?debugGrip=1                        in the URL — survives nothing, breaks nothing
 *   cubeDebug.grip()                    in the console — takes effect immediately
 *   localStorage["cubetimer.debug.grip"] = "1"   — remembered, but tied to the origin
 *
 * The last one catches people out: `http://localhost` and `https://localhost` have
 * separate local storage, so a flag set on one is invisible on the other. The console
 * command says out loud what it did, which is why it exists.
 */
export type DebugChannel = "grip";

const CHANNELS: DebugChannel[] = ["grip"];
const STORAGE_PREFIX = "cubetimer.debug.";
const enabled = new Map<DebugChannel, boolean>();

function flagName(channel: DebugChannel): string {
  return `debug${channel[0].toUpperCase()}${channel.slice(1)}`;
}

function readFlag(channel: DebugChannel): boolean {
  try {
    if (
      typeof location !== "undefined" &&
      new URLSearchParams(location.search).get(flagName(channel)) === "1"
    ) {
      return true;
    }
  } catch {
    // No location to read; fall through to storage.
  }
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${channel}`) === "1";
  } catch {
    return false; // Private browsing, or no DOM at all.
  }
}

export function debugEnabled(channel: DebugChannel): boolean {
  const known = enabled.get(channel);
  if (known !== undefined) return known;
  const on = readFlag(channel);
  enabled.set(channel, on);
  return on;
}

/** Turn a channel on or off for this page, and remember it for the next one. */
export function setDebugEnabled(channel: DebugChannel, on: boolean): void {
  enabled.set(channel, on);
  try {
    if (on) localStorage.setItem(`${STORAGE_PREFIX}${channel}`, "1");
    else localStorage.removeItem(`${STORAGE_PREFIX}${channel}`);
  } catch {
    // Not remembered, but on for this page, which is what was asked for.
  }
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

/**
 * Put the switches somewhere the solver can reach them, and say so.
 *
 * Without this the only sign that a channel is off is that nothing happens, which is
 * indistinguishable from the thing being traced not happening either.
 */
export function installDebugConsole(extras: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const api: Record<string, unknown> = { ...extras };
  for (const channel of CHANNELS) {
    api[channel] = (on = true) => {
      setDebugEnabled(channel, on);
      console.log(
        `[${channel}] tracing ${on ? "on" : "off"}${on ? " — turn the cube" : ""}`,
      );
      return on;
    };
  }
  (window as unknown as Record<string, unknown>).cubeDebug = api;

  const live = CHANNELS.filter(debugEnabled);
  if (live.length > 0) {
    for (const channel of live) console.log(`[${channel}] tracing on`);
  } else {
    console.log(
      "cubetimer: tracing available — run cubeDebug.grip() to follow the grip",
    );
  }
}
