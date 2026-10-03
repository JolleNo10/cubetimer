import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { trainingGuideMove } from "../cube/training";
import { TrainingAlgorithmGuide } from "./TrainingAlgorithmGuide";
import { CubeMoveGuide } from "./CubeMoveGuide";

describe("Training algorithm presentation", () => {
  it("distinguishes completed, accessible current, and upcoming tokens", () => {
    const guide = { moves: ["R", "U", "R'"], confirmed: 1, currentMove: trainingGuideMove("U"), finished: false };
    const html = renderToStaticMarkup(<TrainingAlgorithmGuide algorithm="R U R'" guide={guide} active />);
    expect(html).toContain('class="training-algorithm-token completed">R</span>');
    expect(html).toContain('class="training-algorithm-token current" aria-current="step">U</span>');
    expect(html).toContain('class="training-algorithm-token upcoming">R&#x27;</span>');
    expect(html).toContain("Move 2 / 3");
  });

  it("keeps reference tokens readable without an active attempt", () => {
    const html = renderToStaticMarkup(<TrainingAlgorithmGuide algorithm="(R U)2" guide={null} active={false} />);
    expect(html.match(/training-algorithm-token upcoming/g)).toHaveLength(4);
    expect(html).not.toContain("aria-current");
  });

  it.each([false, true])("hides progress and completed styling for an inactive guide (finished=%s)", (finished) => {
    const guide = { moves: ["R", "U", "R'"], confirmed: finished ? 3 : 1, currentMove: trainingGuideMove("U"), finished };
    const html = renderToStaticMarkup(<TrainingAlgorithmGuide algorithm="R U R'" guide={guide} active={false} />);
    expect(html.match(/training-algorithm-token upcoming/g)).toHaveLength(3);
    expect(html).not.toContain("aria-current");
    expect(html).not.toMatch(/Move \d+ \/|Guide complete/);
  });

  it.each(["R", "r", "M", "x"])("renders distinct layer guidance for %s", (token) => {
    const move = trainingGuideMove(token)!;
    const html = renderToStaticMarkup(<CubeMoveGuide move={move} />);
    expect(html).toContain(`class="cube-move-guide ${move.kind}"`);
    expect(html).toContain('viewBox="0 0 400 400"');
    expect(html).toContain("cube-guide-layer");
    expect(html).toContain("cube-guide-arc");
  });

  it("reverses a prime arrow and gives half turns two heads with an explicit 180 degree label", () => {
    const normal = renderToStaticMarkup(<CubeMoveGuide move={trainingGuideMove("R")!} />);
    const prime = renderToStaticMarkup(<CubeMoveGuide move={trainingGuideMove("R'")!} />);
    expect(normal).toContain('data-direction="-1"');
    expect(prime).toContain('data-direction="1"');
    for (const token of ["R2", "M2", "r2"]) {
      const html = renderToStaticMarkup(<CubeMoveGuide move={trainingGuideMove(token)!} />);
      expect(html.match(/class="cube-guide-arrowhead"/g)).toHaveLength(2);
      expect(html).toContain('data-direction="either"');
      expect(html).toContain("180°");
    }
  });
});
