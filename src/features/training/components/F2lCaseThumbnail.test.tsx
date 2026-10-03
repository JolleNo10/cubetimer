import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SOLVED_FACELETS } from "../../../cube/facelets";
import { FACE_OFFSET, type Face } from "../../../cube/moves";
import { FACE_COLOURS } from "../../../cube/colours";
import { F2L_POSITIONS } from "../../../cube/f2lCases";
import { f2lTrainingCatalogue } from "../../../cube/f2lTrainingCases";
import { getF2lThumbnailModel } from "../../../cube/f2lThumbnail";
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

describe("F2lCaseThumbnail", () => {
  it("uses one binary colour mask with identical U/F/R isometric geometry", () => {
    const model = {
      facelets: SOLVED_FACELETS,
      coloured: Array.from({ length: 54 }, (_, index) => index === FACE_OFFSET.F),
    };
    const markup = renderToStaticMarkup(<F2lCaseThumbnail model={model} />);
    const rendered = stickers(markup);
    expect([...rendered.keys()]).toEqual(VISIBLE_FACELETS);
    for (const [index, tag] of rendered) {
      expect(tag).toContain(`fill="${model.coloured[index] ? FACE_COLOURS[model.facelets[index] as Face].hex : "#52575d"}"`);
      expect(tag).not.toContain("fill-opacity");
    }
    expect(markup).not.toMatch(/<(?:button|a|input)\b/);
    expect(markup).toContain('aria-hidden="true"');
  });

  it("renders 27 static stickers with actual colours and grey context", () => {
    const markup = renderToStaticMarkup(
      <F2lCaseThumbnail model={{ facelets: SOLVED_FACELETS,
        coloured: SOLVED_FACELETS.split("").map((_, index) => index === 4) }} />,
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

  it("renders an Advanced model with the same binary mask semantics", () => {
    const model = getF2lThumbnailModel("advanced", "AF2L 3", "FR");
    const markup = renderToStaticMarkup(<F2lCaseThumbnail model={model} />);
    expect(markup.match(/<polygon/g)).toHaveLength(27);
    const rendered = stickers(markup);
    for (const [index, tag] of rendered) {
      expect(tag).toContain(`fill="${model.coloured[index] ? FACE_COLOURS[model.facelets[index] as Face].hex : "#52575d"}"`);
      expect(tag).not.toContain("fill-opacity");
    }
  });

  it.each(F2L_POSITIONS)("all Advanced %s cards use the same visible faces and binary mask", (position) => {
    for (const entry of f2lTrainingCatalogue("advanced").cases) {
      const model = getF2lThumbnailModel("advanced", entry.name, position);
      const rendered = stickers(renderToStaticMarkup(<F2lCaseThumbnail model={model} />));
      expect(rendered.size).toBe(27);
      expect([...rendered.keys()]).toEqual(VISIBLE_FACELETS);
    }
  });

  it("does not fabricate a distinction between identical AF2L 16 and AF2L 10a states", () => {
    const first = getF2lThumbnailModel("advanced", "AF2L 16", "FR");
    const second = getF2lThumbnailModel("advanced", "AF2L 10a", "FR");
    expect(first.facelets).toBe(second.facelets);
    expect(renderToStaticMarkup(<F2lCaseThumbnail model={first} />)).toBe(renderToStaticMarkup(<F2lCaseThumbnail model={second} />));
  });
});
