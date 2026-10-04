import { useEffect, useRef } from "react";

/** Controlled token presentation; callers own progress and cursor semantics. */
export function MoveSequence({
  moves, currentIndex, completedCount = 0, selectedIndex, onSelect, label,
  layout = "wrap", tokenKind,
}: {
  moves: readonly string[];
  currentIndex?: number | null;
  completedCount?: number;
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
  label: string;
  layout?: "wrap" | "scroll";
  tokenKind?: (index: number) => "rotation" | undefined;
}) {
  const sequenceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (layout !== "scroll") return;
    const sequence = sequenceRef.current;
    const token = sequence?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!sequence || !token) return;
    // Scroll only this strip; never move the dialog/page or steal keyboard focus.
    const stripBounds = sequence.getBoundingClientRect();
    const tokenBounds = token.getBoundingClientRect();
    if (tokenBounds.left < stripBounds.left) sequence.scrollLeft -= stripBounds.left - tokenBounds.left + 8;
    else if (tokenBounds.right > stripBounds.right) sequence.scrollLeft += tokenBounds.right - stripBounds.right + 8;
  }, [currentIndex, layout, moves]);

  return <div ref={sequenceRef} className={`move-sequence ${layout} mono`} aria-label={label}>
    {moves.map((move, index) => {
      const kind = tokenKind?.(index);
      const className = `move-sequence-token ${index === currentIndex ? "current" : index < completedCount ? "completed" : "upcoming"}${index === selectedIndex ? " previewed" : ""}${kind ? ` ${kind}` : ""}`;
      const current = index === currentIndex ? "step" as const : undefined;
      return onSelect ? <button key={index} type="button" className={className}
        aria-current={current} aria-label={`View move ${index + 1}: ${move}${kind === "rotation" ? " (grip rotation)" : ""}`}
        onClick={() => onSelect(index)}>{move}</button>
        : <span key={index} className={className} aria-current={current}>{move}</span>;
    })}
  </div>;
}
