import { describe, expect, it } from "vitest";
import type { ModelRecord } from "../../types";
import {
  modelSelectorFamily,
  modelSelectorOptionLabel,
  sortModelsForSelector,
} from "./modelSelectorOptions";

function model(
  id: string,
  name: string,
  family: string | undefined,
  totalParametersB: number,
  provider = "Example",
): ModelRecord {
  return {
    id,
    name,
    provider,
    family,
    modelType: "dense",
    totalParametersB,
    activeParametersB: totalParametersB,
    contextWindowTokens: 32_768,
    recommendedQuantizationId: "q4",
    quantizations: [
      {
        id: "q4",
        label: "Q4",
        bitsPerParameter: 4,
        packingOverheadRatio: 1.1,
      },
    ],
    capabilityTierId: "balanced",
    reasoning: false,
    modalities: ["text"],
    openWeight: true,
    commercialUse: "allowed",
  };
}

describe("model selector ordering", () => {
  it("groups families A-Z and orders variants by total parameter count", () => {
    const models = [
      model("qwen-27", "Qwen3.5 27B", "Qwen3.5", 27),
      model("gpt-120", "gpt-oss-120b", "gpt-oss", 117),
      model("gemma-31", "Gemma 4 31B IT", "gemma 4", 30.7),
      model("qwen-9", "Qwen3.5 9B", "qWeN3.5", 9),
      model("gemma-12", "Gemma 4 12B IT", "Gemma 4", 11.95),
      model("gpt-20", "gpt-oss-20b", "GPT-OSS", 21),
    ];

    expect(sortModelsForSelector(models).map(({ id }) => id)).toEqual([
      "gemma-12",
      "gemma-31",
      "gpt-20",
      "gpt-120",
      "qwen-9",
      "qwen-27",
    ]);
  });

  it("uses name and then provider as stable family fallbacks", () => {
    const missingFamily = model("alpha", "Alpha 7B", undefined, 7, "Zeta");
    const missingFamilyAndName = model("beta", "", undefined, 8, "Beta Labs");
    const explicitFamily = model("aardvark", "Large", "Aardvark", 10);

    expect(modelSelectorFamily(missingFamily)).toBe("Alpha 7B");
    expect(modelSelectorFamily(missingFamilyAndName)).toBe("Beta Labs");
    expect(
      sortModelsForSelector([
        missingFamilyAndName,
        missingFamily,
        explicitFamily,
      ]).map(({ id }) => id),
    ).toEqual(["aardvark", "alpha", "beta"]);
  });

  it("uses name and ID to make equal-size variants deterministic", () => {
    const models = [
      model("z-variant", "Beta", "Shared", 8),
      model("b-variant", "Alpha", "Shared", 8),
      model("a-variant", "Alpha", "Shared", 8),
    ];

    expect(sortModelsForSelector(models).map(({ id }) => id)).toEqual([
      "a-variant",
      "b-variant",
      "z-variant",
    ]);
  });

  it("returns a new array and leaves the catalog order unchanged", () => {
    const models = [
      model("qwen", "Qwen", "Qwen", 9),
      model("gemma", "Gemma", "Gemma", 12),
    ];
    const originalOrder = models.map(({ id }) => id);
    const sorted = sortModelsForSelector(models);

    expect(sorted).not.toBe(models);
    expect(models.map(({ id }) => id)).toEqual(originalOrder);
  });

  it("shows family and size without repeating a missing family fallback", () => {
    expect(
      modelSelectorOptionLabel(
        model("qwen", "Qwen3.5 9B", "Qwen3.5", 9, "Qwen"),
        "9B",
      ),
    ).toBe("Qwen3.5 / 9B / Qwen3.5 9B (Qwen)");
    expect(
      modelSelectorOptionLabel(
        model("custom", "Custom 7B", undefined, 7, "Local"),
        "7B",
      ),
    ).toBe("Custom 7B / 7B (Local)");
  });
});
