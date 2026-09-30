import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SOLVED_FACELETS } from "../cube/facelets";
import { F2lCaseThumbnail } from "./F2lCaseThumbnail";

describe("F2lCaseThumbnail", () => {
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
  });
});
