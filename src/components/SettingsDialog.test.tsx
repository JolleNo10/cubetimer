import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ControllerContext } from "../hooks/useController";
import { Controller } from "../state/controller";
import { DEFAULT_SETTINGS } from "../state/types";
import { SettingsDialog } from "./SettingsDialog";

describe("Settings Training libraries", () => {
  it.each([
    ["full", "full"], ["2look", "full"], ["full", "2look"], ["2look", "2look"],
  ] as const)("renders independent OLL %s and PLL %s selects", (ollTrainingSet, pllTrainingSet) => {
    const controller = new Controller();
    const html = renderToStaticMarkup(
      <ControllerContext.Provider value={controller}>
        <SettingsDialog settings={{ ...DEFAULT_SETTINGS, ollTrainingSet, pllTrainingSet }} onClose={() => {}} />
      </ControllerContext.Provider>,
    );
    const ollSelect = html.match(/<select id="ollTrainingSet">(.*?)<\/select>/)?.[1];
    const pllSelect = html.match(/<select id="pllTrainingSet">(.*?)<\/select>/)?.[1];
    expect(html).toContain('for="ollTrainingSet">OLL training set');
    expect(html).toContain('for="pllTrainingSet">PLL training set');
    expect(ollSelect).toContain(`<option value="${ollTrainingSet}" selected="">`);
    expect(pllSelect).toContain(`<option value="${pllTrainingSet}" selected="">`);
    expect(ollSelect).toContain("Full OLL (57 cases)");
    expect(ollSelect).toContain("2-Look OLL (10 cases)");
    expect(pllSelect).toContain("Full PLL (21 cases)");
    expect(pllSelect).toContain("2-Look PLL (6 cases)");
    expect(html).toContain("Training case libraries only. Solve analysis is unchanged.");
  });
});
