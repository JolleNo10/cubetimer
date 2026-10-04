import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { moveGuideForToken } from "../../../cube/moveGuide";
import { TrainingAlgorithmGuide } from "./TrainingAlgorithmGuide";

describe("Training algorithm presentation", () => {
  const guide = { moves: ["R", "U", "R'"], guideMoves: ["R", "U", "R'"].map(token => moveGuideForToken(token)!), checkpointFacelets: ["start", "after R", "after U", "end"], confirmed: 1, currentMove: moveGuideForToken("U"), finished: false };

  it("marks a preview separately from actual current and completed progress", () => {
    const html = renderToStaticMarkup(<TrainingAlgorithmGuide algorithm="R U R'" guide={guide} active previewIndex={2} />);
    expect(html).toMatch(/class="move-sequence-token current" aria-current="step"[^>]*>U<\/button>/);
    expect(html).toMatch(/class="move-sequence-token upcoming previewed" aria-label="View move 3: R&#x27;">/);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain("Viewing 3 / 3 · current 2 / 3");
    expect(html).toContain("Follow current");
  });

  it.each([0, 2])("disables only the boundary control when viewing index %s", index => {
    const html = renderToStaticMarkup(<TrainingAlgorithmGuide algorithm="R U R'" guide={guide} active previewIndex={index} />);
    const previous = html.match(/<button[^>]*>Previous<\/button>/)![0];
    const next = html.match(/<button[^>]*>Next<\/button>/)![0];
    expect(previous.includes("disabled")).toBe(index === 0);
    expect(next.includes("disabled")).toBe(index === 2);
  });

  it.each([null, 1])("does not offer Follow current while viewing the actual current move (%s)", previewIndex => {
    const html = renderToStaticMarkup(<TrainingAlgorithmGuide algorithm="R U R'" guide={guide} active previewIndex={previewIndex} />);
    expect(html).not.toContain("Follow current");
    expect(html).not.toContain("previewed");
    expect(html).toContain("Move 2 / 3");
  });

  it("distinguishes completed, accessible current, and upcoming tokens", () => {
    const guide = { moves: ["R", "U", "R'"], guideMoves: ["R", "U", "R'"].map(token => moveGuideForToken(token)!), checkpointFacelets: ["start", "after R", "after U", "end"], confirmed: 1, currentMove: moveGuideForToken("U"), finished: false };
    const html = renderToStaticMarkup(<TrainingAlgorithmGuide algorithm="R U R'" guide={guide} active />);
    expect(html).toMatch(/<button[^>]*class="move-sequence-token completed"[^>]*>R<\/button>/);
    expect(html).toMatch(/<button[^>]*class="move-sequence-token current" aria-current="step"[^>]*>U<\/button>/);
    expect(html).toMatch(/<button[^>]*class="move-sequence-token upcoming"[^>]*>R&#x27;<\/button>/);
    expect(html).toContain("Move 2 / 3");
  });

  it("keeps reference tokens readable without an active attempt", () => {
    const html = renderToStaticMarkup(<TrainingAlgorithmGuide algorithm="(R U)2" guide={null} active={false} />);
    expect(html.match(/move-sequence-token upcoming/g)).toHaveLength(4);
    expect(html).not.toContain("aria-current");
    expect(html).not.toContain("<button");
  });

  it.each([false, true])("hides progress and completed styling for an inactive guide (finished=%s)", (finished) => {
    const guide = { moves: ["R", "U", "R'"], guideMoves: ["R", "U", "R'"].map(token => moveGuideForToken(token)!), checkpointFacelets: ["start", "after R", "after U", "end"], confirmed: finished ? 3 : 1, currentMove: moveGuideForToken("U"), finished };
    const html = renderToStaticMarkup(<TrainingAlgorithmGuide algorithm="R U R'" guide={guide} active={false} />);
    expect(html.match(/move-sequence-token upcoming/g)).toHaveLength(3);
    expect(html).not.toContain("aria-current");
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/Move \d+ \/|Guide complete/);
  });

});
