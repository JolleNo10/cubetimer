/**
 * Keyboard layout for the virtual cube, matching the one csTimer and Twizzle use:
 * the right hand turns R/U/F/B, the left hand L/D.
 */
export const VIRTUAL_CUBE_KEYS: Record<string, string> = {
  i: "R",
  k: "R'",
  j: "U",
  f: "U'",
  h: "F",
  g: "F'",
  d: "L",
  e: "L'",
  l: "D",
  s: "D'",
  o: "B",
  w: "B'",
};

export const VIRTUAL_CUBE_HELP: { keys: string; move: string }[] = [
  { keys: "I / K", move: "R / R'" },
  { keys: "J / F", move: "U / U'" },
  { keys: "H / G", move: "F / F'" },
  { keys: "D / E", move: "L / L'" },
  { keys: "L / S", move: "D / D'" },
  { keys: "O / W", move: "B / B'" },
];
