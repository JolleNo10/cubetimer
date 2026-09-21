import { FACE_OFFSET, type Face } from "../cube/moves";

const COLORS: Record<string, string> = {
  U: "#f2f4f8",
  R: "#e5484d",
  F: "#30a46c",
  D: "#ffd400",
  L: "#ff8b3d",
  B: "#3b82f6",
};

/** Grid position of each face in the unfolded net. */
const LAYOUT: { face: Face; column: number; row: number }[] = [
  { face: "U", column: 2, row: 1 },
  { face: "L", column: 1, row: 2 },
  { face: "F", column: 2, row: 2 },
  { face: "R", column: 3, row: 2 },
  { face: "B", column: 4, row: 2 },
  { face: "D", column: 2, row: 3 },
];

/** Flat unfolded view of a cube state — used as the 2D visualisation and in replays. */
export function FaceletNet({
  facelets,
  size = 14,
}: {
  facelets: string;
  size?: number;
}) {
  const valid = facelets.length === 54;
  return (
    <div
      className="facelet-net"
      style={{ gridTemplateColumns: `repeat(4, auto)`, alignContent: "center" }}
      role="img"
      aria-label="Current cube state"
    >
      {LAYOUT.map(({ face, column, row }) => (
        <div
          key={face}
          className="facelet-face"
          style={{ gridColumn: column, gridRow: row }}
        >
          {Array.from({ length: 9 }, (_, i) => {
            const color = valid
              ? COLORS[facelets[FACE_OFFSET[face] + i]]
              : undefined;
            return (
              <div
                key={i}
                style={{
                  width: size,
                  height: size,
                  background: color ?? "var(--panel-2)",
                  boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.25)",
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
