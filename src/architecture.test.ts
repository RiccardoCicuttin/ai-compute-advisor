import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = `${directory}/${entry}`;
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry) && !entry.endsWith(".test.ts") ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: string[] = [];
  ast.forEachChild((node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
  });
  return imports;
}

function targetOf(importer: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  return relative(sourceRoot, resolve(dirname(importer), specifier)).split(sep).join("/");
}

function expectNoImports(
  files: string[],
  isForbidden: (target: string, file: string) => boolean,
  rule: string,
) {
  for (const file of files) {
    for (const specifier of importsOf(file)) {
      const target = targetOf(file, specifier);
      expect(
        isForbidden(target, file),
        `${relative(sourceRoot, file)} imports '${specifier}' (${target}); ${rule}`,
      ).toBe(false);
    }
  }
}

describe("maintenance architecture boundaries", () => {
  it("keeps the calculation engine independent from React and UI state", () => {
    expectNoImports(
      sourceFiles(`${sourceRoot}/calculator`),
      (target) =>
        target === "react" ||
        target.startsWith("react/") ||
        /^(components|features|pages|state)(\/|$)/.test(target) ||
        /^data\/(loaders|adapters)(\/|$)/.test(target),
      "the calculator is a framework-independent functional core",
    );
  });

  it("keeps trust-boundary schemas and validators independent from UI and engines", () => {
    const files = [
      ...sourceFiles(`${sourceRoot}/data/schemas`),
      ...sourceFiles(`${sourceRoot}/data/validators`),
    ];
    expectNoImports(
      files,
      (target) => /^(components|features|pages|state|calculator)(\/|$)/.test(target),
      "trust-boundary code cannot depend on presentation or orchestration",
    );
  });

  it("keeps provider adapters out of calculators and presentation", () => {
    const files = [
      ...sourceFiles(`${sourceRoot}/calculator`),
      ...sourceFiles(`${sourceRoot}/components`),
      ...sourceFiles(`${sourceRoot}/features`),
      ...sourceFiles(`${sourceRoot}/pages`),
    ];
    expectNoImports(
      files,
      (target) => /^data\/adapters(\/|$)/.test(target),
      "external providers must normalize through the data boundary",
    );
  });

  it("keeps feature components from invoking calculator modules directly", () => {
    expectNoImports(
      sourceFiles(`${sourceRoot}/features`),
      (target) => /^calculator(\/|$)/.test(target),
      "features receive calculated results through props",
    );
  });

  it("allows React in currency only at its browser hook boundary", () => {
    expectNoImports(
      sourceFiles(`${sourceRoot}/currency`).filter(
        (file) => !file.endsWith("/useExchangeRates.ts"),
      ),
      (target) => target === "react" || target.startsWith("react/"),
      "currency math, schemas, cache, and adapters stay framework independent",
    );
  });

  it("keeps open-ended product choices driven by the active data pack", () => {
    const hardware = readFileSync(
      `${sourceRoot}/features/hardware-fit/HardwareSection.tsx`,
      "utf8",
    );
    const workload = readFileSync(
      `${sourceRoot}/features/workload/WorkloadSection.tsx`,
      "utf8",
    );
    const opportunityMap = readFileSync(
      `${sourceRoot}/components/charts/OpportunityMap.tsx`,
      "utf8",
    );

    expect(hardware).toContain("selectedGpu.supportedCounts");
    expect(hardware).not.toMatch(/\[\s*1\s*,\s*2\s*,\s*4\s*\]/);
    expect(workload).toContain("assumptions.simpleModeMappings.useCases");
    expect(workload).toContain("assumptions.simpleModeMappings.usageFrequency");
    expect(workload).toContain("assumptions.capabilityTiers");
    expect(opportunityMap).toContain("createCapabilityTierScale(capabilityTiers");
  });
});
