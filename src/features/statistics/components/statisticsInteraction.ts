import type { MouseEvent, KeyboardEvent } from "react";

/** Keep row/point activation consistent without reactivating a nested button. */
export function statisticsActivationProps<T extends Element = HTMLTableRowElement>(onOpen: (() => void) | undefined, label: string) {
  if (!onOpen) return {};
  return {
    tabIndex: 0,
    "aria-label": label,
    onClick: (event: MouseEvent<T>) => {
      if ((event.target as Element).closest?.("button, a, input, select, textarea")) return;
      onOpen();
    },
    onKeyDown: (event: KeyboardEvent<T>) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      onOpen();
    },
  };
}
