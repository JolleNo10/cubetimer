import type { MouseEvent, KeyboardEvent } from "react";

/** Hover/focus preview, such as a chart tooltip. */
export type StatisticsPreview = { onEnter: () => void; onLeave: () => void };

/** Keep row/point activation consistent without reactivating a nested button. */
export function statisticsActivationProps<T extends Element = HTMLTableRowElement>(onOpen: (() => void) | undefined, label: string, preview?: StatisticsPreview) {
  const hover = preview ? { onMouseEnter: preview.onEnter, onMouseLeave: preview.onLeave, onFocus: preview.onEnter, onBlur: preview.onLeave } : {};
  if (!onOpen) return hover;
  return {
    ...hover,
    tabIndex: 0,
    "aria-label": label,
    onClick: (event: MouseEvent<T>) => {
      if ((event.target as Element).closest?.("button, a, input, select, textarea")) return;
      onOpen();
    },
    onKeyDown: (event: KeyboardEvent<T>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Escape") { preview?.onLeave(); return; }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onOpen();
    },
  };
}
