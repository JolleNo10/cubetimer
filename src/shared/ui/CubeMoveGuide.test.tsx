import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { trainingGuideMove } from "../../cube/training";
import { CubeMoveGuide } from "./CubeMoveGuide";

function render(token: string) {
  return renderToStaticMarkup(<CubeMoveGuide move={trainingGuideMove(token)!} />);
}

describe("Cube move surface guidance", () => {
  it.each(["M", "M'", "M2", "E", "E'", "E2", "S", "S'", "S2"])("draws only exterior middle bands for %s", token => {
    const move = trainingGuideMove(token)!;
    const html = render(token);
    expect(html).toContain(`cube-move-guide slice`);
    expect(html).toContain(`data-axis="${move.axis}"`);
    expect(html).not.toContain(`data-surface="${move.axis}"`);
    expect([...html.matchAll(/data-surface="([xyz])"/g)].map(match => match[1]))
      .toEqual(["x", "y", "z"].filter(axis => axis !== move.axis));
    expect(html.match(/data-normal="1"/g)).toHaveLength(2);
    expect(html.match(/data-layer-min="-0.3333333333333333"/g)).toHaveLength(2);
    expect(html.match(/data-layer-max="0.3333333333333333"/g)).toHaveLength(2);
  });

  it.each(["R", "L", "U", "D", "F", "B", "r", "Rw", "l", "u", "f", "x", "y", "z"])("uses the domain-provided interval for %s", token => {
    const move = trainingGuideMove(token)!;
    const html = render(token);
    expect(html).toContain(`cube-move-guide ${move.kind}`);
    expect(html).toContain(`data-layer-min="${move.layers[0]}"`);
    expect(html).toContain(`data-layer-max="${move.layers[1]}"`);
    const surfaces = [...html.matchAll(/data-surface="([xyz])"/g)].map(match => match[1]);
    expect(surfaces.includes(move.axis)).toBe(move.layers[1] === 1);
    expect(html.match(/data-normal="1"/g)).toHaveLength(surfaces.length);
  });

  it("reverses the same near-side arc for a prime move", () => {
    const coordinates = (html: string) => html.match(/class="cube-guide-arc" d="([^"]+)"/)![1].split(" ");
    const normal = coordinates(render("R")), prime = coordinates(render("R'"));
    expect(normal[0].slice(1)).toBe(prime.at(-1)!.slice(1));
    expect(normal.at(-1)!.slice(1)).toBe(prime[0].slice(1));
    expect(render("R")).toContain('data-direction="-1"');
    expect(render("R'")).toContain('data-direction="1"');
  });

  it.each(["R2", "M2", "r2", "x2"])("keeps %s direction-neutral with two heads and an explicit label", token => {
    const html = render(token);
    expect(html.match(/class="cube-guide-arrowhead"/g)).toHaveLength(2);
    expect(html).toContain('data-direction="either"');
    expect(html).toContain("180°");
  });
});
