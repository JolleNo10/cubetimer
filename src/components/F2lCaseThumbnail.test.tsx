import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CENTER_FACELETS, SOLVED_FACELETS } from "../cube/facelets";
import { FACE_OFFSET, type Face } from "../cube/moves";
import { FACE_COLOURS } from "../cube/colours";
import { F2L_POSITIONS } from "../cube/f2lCases";
import { f2lTrainingCatalogue } from "../cube/f2lTrainingCases";
import { getF2lThumbnailModel, type F2lThumbnailModel } from "../cube/f2lThumbnail";
import { F2lCaseThumbnail } from "./F2lCaseThumbnail";

const VISIBLE_FACELETS = [
  ...Array.from({ length: 9 }, (_, i) => FACE_OFFSET.U + i),
  ...Array.from({ length: 9 }, (_, i) => FACE_OFFSET.F + i),
  ...Array.from({ length: 9 }, (_, i) => FACE_OFFSET.R + i),
];

function stickers(markup: string) {
  return new Map([...markup.matchAll(/<polygon\b[^>]*>/g)].map(([tag]) =>
    [Number(/data-facelet="(\d+)"/.exec(tag)![1]), tag] as const));
}

function renderAdvanced(model: F2lThumbnailModel) {
  return renderToStaticMarkup(<F2lCaseThumbnail view="advanced" model={model} />);
}

function expectAdvancedColours(model: F2lThumbnailModel, rendered: Map<number, string>) {
  expect(rendered.size).toBe(27);
  expect([...rendered.keys()]).toEqual(VISIBLE_FACELETS);
  for (const [index, tag] of rendered) {
    expect(tag).toContain(`fill="${FACE_COLOURS[model.facelets[index] as Face].hex}"`);
    const opacity = Number(/fill-opacity="([^"]+)"/.exec(tag)![1]);
    if (model.emphasized[index]) expect(opacity).toBe(1);
    else {
      expect(opacity).toBeGreaterThanOrEqual(0.35);
      expect(opacity).toBeLessThanOrEqual(0.50);
    }
  }
}

describe("F2lCaseThumbnail", () => {
  it("uses identical U/F/R isometric geometry for Basic and Advanced, changing only colour treatment", () => {
    const model = {
      facelets: SOLVED_FACELETS,
      emphasized: Array.from({ length: 54 }, (_, index) => CENTER_FACELETS.includes(index) || index === FACE_OFFSET.F),
    };
    const basic = stickers(renderToStaticMarkup(<F2lCaseThumbnail view="basic" model={model} />));
    const advancedMarkup = renderAdvanced(model);
    const advanced = stickers(advancedMarkup);
    expect([...basic.keys()]).toEqual(VISIBLE_FACELETS);
    expect([...advanced.keys()]).toEqual([...basic.keys()]);
    expectAdvancedColours(model, advanced);
    for (const [index, tag] of basic) {
      expect(/points="([^"]+)"/.exec(advanced.get(index)!)![1]).toBe(/points="([^"]+)"/.exec(tag)![1]);
      expect(tag).toContain(`fill="${model.emphasized[index] ? FACE_COLOURS[model.facelets[index] as Face].hex : "#52575d"}"`);
      expect(tag).not.toContain("fill-opacity");
    }
    expect(advancedMarkup).not.toContain('fill="#52575d"');
    expect(advancedMarkup).not.toMatch(/<(?:button|a|input)\b/);
    expect(advancedMarkup).toContain('aria-hidden="true"');
  });

  it("renders 27 static Basic stickers with unchanged geometry, emphasized colours and grey context", () => {
    const markup = renderToStaticMarkup(
      <F2lCaseThumbnail model={{ facelets: SOLVED_FACELETS,
        emphasized: SOLVED_FACELETS.split("").map((_, index) => index === 4) }} />,
    );
    expect(markup.match(/<polygon/g)).toHaveLength(27);
    expect(markup).not.toContain("<button");
    expect(markup).toContain('fill="#f2f4f8"');
    expect(markup).toContain('fill="#52575d"');
    const rendered = stickers(markup);
    expect([...rendered.keys()]).toEqual(VISIBLE_FACELETS);
    for (const [index, tag] of rendered) {
      expect(tag).toContain(`fill="${index === 4 ? "#f2f4f8" : "#52575d"}"`);
      expect(tag).not.toContain("fill-opacity");
    }
    expect(rendered.get(FACE_OFFSET.U)).toContain('points="66,12 78,18 66,24 54,18"');
    expect(rendered.get(FACE_OFFSET.F)).toContain('points="30,30 42,36 42,50 30,44"');
    expect(rendered.get(FACE_OFFSET.R)).toContain('points="66,48 78,42 78,56 66,62"');
  });

  it("renders AF2L 3 FR as a compact cube with full-opacity target/centres and subdued visible context", () => {
    const model = getF2lThumbnailModel("advanced", "AF2L 3", "FR");
    const markup = renderAdvanced(model);
    expect(markup.match(/<polygon/g)).toHaveLength(27);
    const rendered = stickers(markup);
    expectAdvancedColours(model, rendered);
    expect(VISIBLE_FACELETS.some((index) => model.emphasized[index] && !CENTER_FACELETS.includes(index))).toBe(true);
    expect(VISIBLE_FACELETS.some((index) => !model.emphasized[index])).toBe(true);
  });

  it.each(F2L_POSITIONS)("all Advanced %s cards use the same visible faces and subdued real context", (position) => {
    for (const entry of f2lTrainingCatalogue("advanced").cases) {
      const model = getF2lThumbnailModel("advanced", entry.name, position);
      expectAdvancedColours(model, stickers(renderAdvanced(model)));
    }
  });

  it("does not fabricate a distinction between identical AF2L 16 and AF2L 10a states", () => {
    const first = getF2lThumbnailModel("advanced", "AF2L 16", "FR");
    const second = getF2lThumbnailModel("advanced", "AF2L 10a", "FR");
    expect(first.facelets).toBe(second.facelets);
    expect(renderAdvanced(first)).toBe(renderAdvanced(second));
  });
});
