import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { MoveSequence } from "./MoveSequence";

vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useRef: () => ({ current: null }), useEffect: () => {},
}));

describe("controlled move sequence", () => {
  const moves = ["R", "y", "U"];
  it("presents completed/current/upcoming and a separate preview", () => {
    const html = renderToStaticMarkup(<MoveSequence moves={moves} currentIndex={1}
      completedCount={1} selectedIndex={2} label="Instructions" onSelect={() => {}} />);
    expect(html).toContain('class="move-sequence-token completed"');
    expect(html).toContain('class="move-sequence-token current" aria-current="step"');
    expect(html).toContain('class="move-sequence-token upcoming previewed"');
    expect(html.match(/aria-current/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Instructions"');
  });

  it("sends the exact array index on click", () => {
    const onSelect = vi.fn();
    const element = MoveSequence({ moves, label: "Instructions", onSelect });
    const tokens = element.props.children as ReactElement<{ onClick(): void }>[];
    tokens[2].props.onClick();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("can present noninteractive tokens with an accessible current instruction", () => {
    const html = renderToStaticMarkup(<MoveSequence moves={moves} label="Instructions" currentIndex={0} />);
    expect(html).not.toContain("<button");
    expect(html).toContain('aria-current="step"');
  });

  it("keeps rotation actions visible in the compact scrolling variant, including at the end", () => {
    const html = renderToStaticMarkup(<MoveSequence moves={moves} label="Replay moves" layout="scroll"
      currentIndex={3} completedCount={3} tokenKind={i => i === 1 ? "rotation" : undefined} onSelect={() => {}} />);
    expect(html).toContain('move-sequence scroll mono');
    expect(html).toContain('move-sequence-token completed rotation');
    expect(html).toContain('View move 2: y (grip rotation)');
    expect(html.match(/completed/g)).toHaveLength(3);
    expect(html).not.toContain("aria-current");
  });
});
