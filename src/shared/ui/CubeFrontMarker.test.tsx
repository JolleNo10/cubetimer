import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CubeFrontMarker } from "./CubeFrontMarker";
import { DEFAULT_GUIDE_CAMERA, type GuideCamera } from "./cubeOverlayCamera";

const render = (camera: GuideCamera = DEFAULT_GUIDE_CAMERA, visible = true) =>
  renderToStaticMarkup(<CubeFrontMarker camera={camera} visible={visible} />);
const transform = (html: string) => html.match(/transform="matrix\(([^)]+)\)"/)![1].split(" ").map(Number);
const opacity = (html: string) => Number(html.match(/opacity="([\d.]+)"/)![1]);

describe("Front marker", () => {
  it("draws a decorative F that is only shown while visible", () => {
    expect(render()).toContain(">F</text>");
    expect(render()).toContain('aria-hidden="true"');
    expect(render(DEFAULT_GUIDE_CAMERA, true)).toContain('class="cube-front-marker visible"');
    expect(render(DEFAULT_GUIDE_CAMERA, false)).toContain('class="cube-front-marker"');
  });

  it("floats out from the Front face and reads upright when viewed head-on", () => {
    const [a, b, c, d, e, f] = transform(render({ latitude: 0, longitude: 0 }));
    expect([e, f]).toEqual([200, 200]);
    expect(a).toBeGreaterThan(0);
    expect(d).toBeGreaterThan(0);
    expect(Math.abs(b) + Math.abs(c)).toBeLessThan(1e-9);
  });

  it("follows the camera and fades when Front is turned away", () => {
    const side = { latitude: 27, longitude: 80 }, behind = { latitude: 27, longitude: 200 };
    expect(transform(render(side))[4]).toBeLessThan(transform(render())[4]);
    expect(opacity(render())).toBeGreaterThan(0.7);
    expect(opacity(render(behind))).toBe(0.45);
  });
});
