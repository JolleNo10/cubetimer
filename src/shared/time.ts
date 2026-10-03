/** `12.34`, `1:02.34`, or `DNF`. */
export function formatTime(
  ms: number | null | undefined,
  options: { decimals?: number } = {},
): string {
  if (ms === undefined) return "—";
  if (ms === null) return "DNF";
  const decimals = options.decimals ?? 2;
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  if (minutes === 0) return seconds.toFixed(decimals);
  return `${minutes}:${seconds.toFixed(decimals).padStart(decimals + 3, "0")}`;
}
