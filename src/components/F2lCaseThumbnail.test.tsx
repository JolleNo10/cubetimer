import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CENTER_FACELETS, SOLVED_FACELETS } from "../cube/facelets";
import { FACE_OFFSET, type Face } from "../cube/moves";
import { FACE_COLOURS } from "../cube/colours";
import { F2L_POSITIONS } from "../cube/f2lCases";
import { f2lTrainingCatalogue } from "../cube/f2lTrainingCases";
import { getF2lThumbnailModel, type F2lThumbnailModel } from "../cube/f2lThumbnail";
import { F2lCaseThumbnail } from "./F2lCaseThumbnail";

function stickers(markup: string) {
  return new Map([...markup.matchAll(/<polygon\b[^>]*>/g)].map(([tag]) =>
    [Number(/data-facelet="(\d+)"/.exec(tag)![1]), tag] as const));
}

function renderAdvanced(model: F2lThumbnailModel) {
  return renderToStaticMarkup(<F2lCaseThumbnail view="advanced-net" model={model} />);
}

function expectColoured(tag: string | undefined, colour: string, emphasized: boolean) {
  expect(tag).toBeDefined();
  expect(tag).toContain(`fill="${colour}"`);
  const opacity = Number(/fill-opacity="([^"]+)"/.exec(tag!)![1]);
  if (emphasized) expect(opacity).toBe(1);
  else {
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  }
}

describe("F2lCaseThumbnail", () => {
  it("renders all six Advanced faces, including target stickers on L/B/D", () => {
    const emphasized = new Array<boolean>(54).fill(false);
    const hiddenTargets = [FACE_OFFSET.L, FACE_OFFSET.B + 8, FACE_OFFSET.D + 2];
    [...hiddenTargets, ...CENTER_FACELETS].forEach((index) => { emphasized[index] = true; });
    const markup = renderAdvanced({ facelets: SOLVED_FACELETS, emphasized });
    expect(markup.match(/<polygon/g)).toHaveLength(54);
    const rendered = stickers(markup);
    expect([...rendered.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 54 }, (_, index) => index));
    for (const [index, tag] of rendered) {
      expectColoured(tag, FACE_COLOURS[SOLVED_FACELETS[index] as Face].hex, emphasized[index]);
    }
    expect(markup).not.toContain('fill="#52575d"');
    expect(markup).not.toMatch(/<(?:button|a|input)\b/);
    expect(markup).toContain('aria-hidden="true"');
  });

  it("renders 27 static stickers with both emphasized and muted fills", () => {
    const markup = renderToStaticMarkup(
      <F2lCaseThumbnail
        model={{
          facelets: SOLVED_FACELETS,
          emphasized: SOLVED_FACELETS.split("").map((_, index) => index === 4),
        }}
      />,
    );

    expect(markup.match(/<polygon/g)).toHaveLength(27);
    expect(markup).not.toContain("<button");
    expect(markup).toContain('fill="#f2f4f8"');
    expect(markup).toContain('fill="#52575d"');
    const rendered = stickers(markup);
    expect([...rendered.keys()]).toEqual([
      ...Array.from({ length: 9 }, (_, i) => FACE_OFFSET.U + i),
      ...Array.from({ length: 9 }, (_, i) => FACE_OFFSET.F + i),
      ...Array.from({ length: 9 }, (_, i) => FACE_OFFSET.R + i),
    ]);
    for (const [index, tag] of rendered) {
      expect(tag).toContain(`fill="${index === 4 ? "#f2f4f8" : "#52575d"}"`);
      expect(tag).not.toContain("fill-opacity");
    }
    expect(rendered.get(FACE_OFFSET.U)).toContain('points="66,12 78,18 66,24 54,18"');
    expect(rendered.get(FACE_OFFSET.F)).toContain('points="30,30 42,36 42,50 30,44"');
    expect(rendered.get(FACE_OFFSET.R)).toContain('points="66,48 78,42 78,56 66,62"');
  });

  it("exposes all five AF2L 26 FR target stickers, previously hidden by the three-face projection", () => {
    const model = getF2lThumbnailModel("advanced", "AF2L 26", "FR");
    const targets = model.emphasized.flatMap((emphasized, index) =>
      emphasized && !CENTER_FACELETS.includes(index) ? [index] : []);
    expect(targets).toHaveLength(5);
    const basic = stickers(renderToStaticMarkup(<F2lCaseThumbnail model={model} />));
    expect(targets.filter((index) => basic.has(index))).toHaveLength(0);
    const net = stickers(renderAdvanced(model));
    for (const index of targets) expectColoured(net.get(index), FACE_COLOURS[model.facelets[index] as Face].hex, true);
  });

  it("fits a stable U / L-F-R-B / D net inside the existing card without overlapping stickers", () => {
    const net = stickers(renderAdvanced({ facelets: SOLVED_FACELETS, emphasized: new Array<boolean>(54).fill(false) }));
    const bounds = new Map([...net].map(([index, tag]) => {
      const points = /points="([^"]+)"/.exec(tag)![1].split(" ").map((point) => point.split(",").map(Number));
      return [index, { left: Math.min(...points.map(([x]) => x)), right: Math.max(...points.map(([x]) => x)),
        top: Math.min(...points.map(([, y]) => y)), bottom: Math.max(...points.map(([, y]) => y)) }] as const;
    }));
    for (const box of bounds.values()) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(132);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(104);
      expect(box.right - box.left).toBeGreaterThan(0);
      expect(box.right - box.left).toBe(box.bottom - box.top);
      for (const other of bounds.values()) {
        if (other === box) continue;
        expect(box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom).toBe(false);
      }
    }
    const front = bounds.get(FACE_OFFSET.F)!;
    for (const face of ["U", "D"] as const) expect(bounds.get(FACE_OFFSET[face])!.left).toBe(front.left);
    expect(bounds.get(FACE_OFFSET.U + 8)!.bottom).toBeLessThan(front.top);
    expect(bounds.get(FACE_OFFSET.D)!.top).toBeGreaterThan(bounds.get(FACE_OFFSET.F + 8)!.bottom);
    for (const [left, right] of [["L", "F"], ["F", "R"], ["R", "B"]] as const) {
      expect(bounds.get(FACE_OFFSET[left])!.top).toBe(front.top);
      expect(bounds.get(FACE_OFFSET[right])!.top).toBe(front.top);
      expect(bounds.get(FACE_OFFSET[left] + 8)!.right).toBeLessThan(bounds.get(FACE_OFFSET[right])!.left);
    }
  });

  it.each(F2L_POSITIONS)("all Advanced %s cards expose the complete state and all five target stickers", (position) => {
    for (const entry of f2lTrainingCatalogue("advanced").cases) {
      const model = getF2lThumbnailModel("advanced", entry.name, position);
      const net = stickers(renderAdvanced(model));
      expect(net.size).toBe(54);
      const targets = model.emphasized.flatMap((emphasized, index) =>
        emphasized && !CENTER_FACELETS.includes(index) ? [index] : []);
      expect(targets).toHaveLength(5);
      for (const [index, tag] of net) expectColoured(tag, FACE_COLOURS[model.facelets[index] as Face].hex, model.emphasized[index]);
    }
  });

  it.each([["AF2L 17", "AF2L 11a"], ["AF2L 18", "AF2L 12a"]])(
    "%s and %s differ visibly through subdued surrounding context", (firstName, secondName) => {
      const first = getF2lThumbnailModel("advanced", firstName, "FR");
      const second = getF2lThumbnailModel("advanced", secondName, "FR");
      expect(first.emphasized).toEqual(second.emphasized);
      expect(first.facelets.split("").filter((_, index) => first.emphasized[index]))
        .toEqual(second.facelets.split("").filter((_, index) => second.emphasized[index]));
      const firstMarkup = renderAdvanced(first);
      const secondMarkup = renderAdvanced(second);
      expect(firstMarkup).not.toBe(secondMarkup);
      const firstNet = stickers(firstMarkup);
      const secondNet = stickers(secondMarkup);
      const differing = first.facelets.split("").flatMap((colour, index) => colour !== second.facelets[index] ? [index] : []);
      expect(differing.length).toBeGreaterThan(0);
      for (const index of differing) {
        expect(first.emphasized[index]).toBe(false);
        expectColoured(firstNet.get(index), FACE_COLOURS[first.facelets[index] as Face].hex, false);
        expectColoured(secondNet.get(index), FACE_COLOURS[second.facelets[index] as Face].hex, false);
        expect(firstNet.get(index)).not.toBe(secondNet.get(index));
      }
    },
  );

  it("does not fabricate a distinction between identical AF2L 16 and AF2L 10a states", () => {
    const first = getF2lThumbnailModel("advanced", "AF2L 16", "FR");
    const second = getF2lThumbnailModel("advanced", "AF2L 10a", "FR");
    expect(first.facelets).toBe(second.facelets);
    expect(renderAdvanced(first)).toBe(renderAdvanced(second));
  });
});
