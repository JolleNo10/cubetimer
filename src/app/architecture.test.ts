import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSourceFile, isImportDeclaration, isStringLiteral, ScriptTarget } from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(?:test|generated)\./.test(entry.name) ? [path] : [];
  });
}
function imports(file: string) {
  const tree = createSourceFile(file, readFileSync(file, "utf8"), ScriptTarget.Latest);
  return tree.statements.filter(isImportDeclaration).flatMap(statement => {
    if (!isStringLiteral(statement.moduleSpecifier)) return [];
    const module = statement.moduleSpecifier.text;
    const location = module.startsWith(".") ? relative(sourceRoot, resolve(dirname(file), module)).replaceAll("\\", "/") : module;
    return [{ bindings: statement.importClause?.getText(tree) ?? "", location, label: `${relative(sourceRoot, file)} -> ${location}` }];
  });
}

describe("architecture dependency boundaries", () => {
  it("keeps behavioral cube modules independent of application, feature, infrastructure and React code", () => {
    const violations = sources(resolve(sourceRoot, "cube")).flatMap(file => imports(file)
      .filter(({ location }) => /^(?:app|features|infrastructure|react)(?:\/|$)/.test(location))
      .map(({ label }) => label));
    expect(violations).toEqual([]);
  });

  it("composes feature runtimes through contracts rather than concrete application runtimes", () => {
    const violations = sources(resolve(sourceRoot, "features")).filter(file => /Runtime\.ts$/.test(file))
      .flatMap(file => imports(file).filter(({ location }) => /^app\/(?:Controller|PhysicalCubeRuntime)(?:\.ts)?$/.test(location)).map(({ label }) => label));
    expect(violations).toEqual([]);
  });

  it("gives generic time formatting neutral ownership outside Statistics", () => {
    const violations = ["timer", "training"].flatMap(feature => sources(resolve(sourceRoot, "features", feature, "components")))
      .flatMap(file => imports(file).filter(({ location, bindings }) => location.startsWith("features/statistics/state/") && /\bformatTime\b/.test(bindings)).map(({ label }) => label));
    expect(violations).toEqual([]);
  });
});
