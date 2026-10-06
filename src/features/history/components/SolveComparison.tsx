import { formatTime } from "../../../shared/time";

export type ComparisonDelta = {
  text: string;
  direction: "faster" | "slower" | "same";
};

export function formatComparisonDelta(deltaMs: number): ComparisonDelta {
  const value = formatTime(Math.abs(deltaMs));
  if (value === "0.00") return { text: "0.00", direction: "same" };

  return {
    text: `${deltaMs >= 0 ? "+" : "-"}${value}`,
    direction: deltaMs > 0 ? "slower" : "faster",
  };
}
