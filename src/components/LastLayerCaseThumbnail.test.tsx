import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FACE_COLOURS } from "../cube/colours";
import { buildLastLayerCatalogueTarget } from "../cube/lastLayerTraining";
import { getLastLayerThumbnailModel } from "../cube/lastLayerThumbnail";
import { get3x3x3 } from "../cube/puzzle";
import { LastLayerCaseThumbnail } from "./LastLayerCaseThumbnail";

const kpuzzle = await get3x3x3();

function render(family: "oll" | "pll", caseId: string) {
  const target = buildLastLayerCatalogueTarget(kpuzzle, family, caseId, 0);
  const model = getLastLayerThumbnailModel(family, target.pattern, target.info.trainingRotation);
  return renderToStaticMarkup(<LastLayerCaseThumbnail model={model} />);
}

function regionBounds(markup: string) {
  return new Map([...markup.matchAll(/<g data-region="(\w+)" transform="translate\((\d+) (\d+)\)">(.*?)<\/g>/g)].map(([, region, x, y, contents]) => {
    const cells = [...contents.matchAll(/<rect\b[^>]*>/g)].map(([tag]) => {
      const attribute = (name: string) => Number(new RegExp(`${name}="([\\d.]+)"`).exec(tag)![1]);
      return { x: attribute("x"), y: attribute("y"), width: attribute("width"), height: attribute("height") };
    });
    expect(cells).toHaveLength(region === "top" ? 9 : 3);
    for (const cell of cells) {
      expect(cell.width).toBe(region === "left" || region === "right" ? 6 : 10);
      expect(cell.height).toBe(region === "back" || region === "front" ? 6 : 10);
    }
    return [region, {
      x: Number(x), y: Number(y),
      width: Math.max(...cells.map((cell) => cell.x + cell.width)),
      height: Math.max(...cells.map((cell) => cell.y + cell.height)),
    }] as const;
  }));
}

describe("LastLayerCaseThumbnail", () => {
  it.each([["oll", "1"], ["pll", "Aa"]] as const)("renders %s %s as one compact attached last-layer diagram", (family, caseId) => {
    const markup = render(family, caseId);
    expect(markup).toContain('viewBox="0 0 44 44"');
    expect(markup).toContain('shape-rendering="crispEdges"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup.match(/<rect\b/g)).toHaveLength(21);
    expect(markup).not.toMatch(/<path\b|\brx=|\bry=/);

    const regions = regionBounds(markup);
    expect([...regions.keys()]).toEqual(["top", "back", "right", "front", "left"]);
    const top = regions.get("top")!;
    const back = regions.get("back")!;
    const right = regions.get("right")!;
    const front = regions.get("front")!;
    const left = regions.get("left")!;
    expect(back.x).toBe(top.x);
    expect(back.y + back.height).toBe(top.y);
    expect(right.x).toBe(top.x + top.width);
    expect(right.y).toBe(top.y);
    expect(front.x).toBe(top.x);
    expect(front.y).toBe(top.y + top.height);
    expect(left.x + left.width).toBe(top.x);
    expect(left.y).toBe(top.y);
  });

  it("renders OLL with only yellow and grey while retaining PLL ring colours", () => {
    const fills = (markup: string) => new Set([...markup.matchAll(/fill="([^"]+)"/g)].map(([, fill]) => fill));
    expect(fills(render("oll", "27"))).toEqual(new Set([FACE_COLOURS.D.hex, "#52575d"]));
    expect(fills(render("pll", "Aa"))).toEqual(new Set(["D", "B", "R", "F", "L"].map((face) => FACE_COLOURS[face as keyof typeof FACE_COLOURS].hex)));
  });
});
