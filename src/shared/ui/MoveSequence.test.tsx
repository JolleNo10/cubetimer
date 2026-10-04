import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MoveSequence } from "./MoveSequence";

const scrolling = vi.hoisted(() => ({ host: null as unknown, effects: [] as (() => void)[] }));
beforeEach(() => { scrolling.host = null; scrolling.effects = []; });
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useRef: () => ({ current: scrolling.host }), useEffect: (effect: () => void) => { scrolling.effects.push(effect); },
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
    expect(html).toContain('role="group" aria-label="Instructions"');
  });

  it.each([3, 10])("reveals only the final token at terminal cursor %s without changing focus or state", currentIndex => {
    const token = { getBoundingClientRect: () => ({ left: 900, right: 944 }), focus: vi.fn() };
    const host = { querySelector: vi.fn(() => token), getBoundingClientRect: () => ({ left: 0, right: 200 }), scrollLeft: 0 };
    scrolling.host = host;
    const onSelect = vi.fn();
    MoveSequence({ moves, label: "Replay moves", layout: "scroll", currentIndex, completedCount: 3, onSelect });
    scrolling.effects.forEach(effect => effect());
    expect(host.querySelector).toHaveBeenCalledWith('.move-sequence-token:last-child');
    expect(host.scrollLeft).toBe(752);
    expect(token.focus).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not attempt terminal scrolling for an empty sequence", () => {
    const host = { querySelector: vi.fn(() => null), getBoundingClientRect: vi.fn(), scrollLeft: 0 };
    scrolling.host = host;
    MoveSequence({ moves: [], label: "Replay moves", layout: "scroll", currentIndex: 0 });
    scrolling.effects.forEach(effect => effect());
    expect(host.querySelector).not.toHaveBeenCalledWith('.move-sequence-token:last-child');
    expect(host.scrollLeft).toBe(0);
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
