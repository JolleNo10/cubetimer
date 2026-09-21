const PATHS: Record<string, string> = {
  pencil: "M4 13.5V16h2.5l7.4-7.4-2.5-2.5L4 13.5Zm11.8-6.9a.7.7 0 0 0 0-1l-1.4-1.4a.7.7 0 0 0-1 0l-1.2 1.2 2.5 2.5 1.1-1.3Z",
  trash: "M7 3h6v2h4v2H3V5h4V3Zm-2 6h10l-.8 8.1a1 1 0 0 1-1 .9H6.8a1 1 0 0 1-1-.9L5 9Z",
  settings:
    "M10 6.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Zm7 3.2c0 .5 0 .9-.1 1.3l1.7 1.3-1.7 3-2-.8c-.7.5-1.4.9-2.2 1.2l-.3 2.1H8.6l-.3-2.1a7 7 0 0 1-2.2-1.2l-2 .8-1.7-3 1.7-1.3a7.6 7.6 0 0 1 0-2.6L2.4 7.4l1.7-3 2 .8c.7-.5 1.4-.9 2.2-1.2l.3-2.1h2.8l.3 2.1c.8.3 1.5.7 2.2 1.2l2-.8 1.7 3-1.7 1.3c.1.4.1.8.1 1.3Z",
};

/** Small inline glyphs — emoji render inconsistently across platforms. */
export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
