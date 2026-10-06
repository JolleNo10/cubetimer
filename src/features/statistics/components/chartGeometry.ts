/** Pure SVG geometry shared by the Statistics charts. Width follows the rendered plot; height is fixed. */
export const WIDTH = 1000;
export const HEIGHT = 300;
export const PAD = { top: 20, right: 24, bottom: 34, left: 64 };

export type TimeDomain = { min: number; max: number };

/** Visible finite values determine a padded domain; constant/empty series remain drawable. */
export function timeSeriesDomain(values: readonly (number | null | undefined)[]): TimeDomain {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) return { min: 0, max: 1000 };
  const low = Math.min(...finite), high = Math.max(...finite);
  const padding = high === low ? Math.max(Math.abs(low) * 0.05, 100) : Math.max((high - low) * 0.08, 1);
  return { min: Math.max(0, low - padding), max: high + padding };
}

export function chartX(index: number, length: number, width = WIDTH): number {
  return PAD.left + (length <= 1 ? 0 : (width - PAD.left - PAD.right) * index / (length - 1));
}

export function yFor(value: number, domain: TimeDomain): number {
  return HEIGHT - PAD.bottom - ((value - domain.min) / (domain.max - domain.min)) * (HEIGHT - PAD.top - PAD.bottom);
}

/** A path that breaks at missing values and wherever the segment key changes. */
export function linePath(values: readonly (number | null | undefined)[], domain: TimeDomain, segmentKeys?: readonly string[], width = WIDTH): string {
  let path = "";
  let active = false;
  let previousSegment: string | undefined;
  values.forEach((value, index) => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      active = false;
      return;
    }
    const x = chartX(index, values.length, width);
    const y = yFor(value, domain);
    if (segmentKeys && segmentKeys[index] !== previousSegment) active = false;
    path += `${active ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    active = true;
    previousSegment = segmentKeys?.[index];
  });
  return path.trim();
}

/** Indices that start a new segment. */
export function segmentBoundaries(keys: readonly string[]): number[] {
  return keys.flatMap((key, index) => index > 0 && key !== keys[index - 1] ? [index] : []);
}

/**
 * Solve-indexed x ticks placed where the formatted date changes, so the saved date format
 * and time zone decide what a "day" is. Ticks closer than an even share of the axis are skipped.
 */
export function dateTicks(createdAts: readonly number[], label: (at: number) => string, maxTicks = 6): { index: number; label: string }[] {
  if (!createdAts.length) return [];
  const minGap = (createdAts.length - 1) / maxTicks;
  const ticks: { index: number; label: string }[] = [];
  let previous: string | undefined;
  createdAts.forEach((at, index) => {
    const text = label(at);
    if (text === previous) return;
    previous = text;
    const last = ticks.at(-1);
    if (!last || index - last.index >= minGap) ticks.push({ index, label: text });
  });
  return ticks.slice(0, maxTicks);
}
