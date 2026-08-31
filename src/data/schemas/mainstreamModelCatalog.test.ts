import { describe, expect, it } from "vitest";
import assumptionsJson from "../../../public/data/assumptions.json";
import modelsJson from "../../../public/data/models.json";
import { calculateVramRequirement } from "../../calculator/vramCalculator";
import type { ModelRecord } from "../../types";
import { AssumptionsCatalogSchema, ModelsCatalogSchema } from "./catalogSchemas";

const models = ModelsCatalogSchema.parse(modelsJson).data;
const assumptions = AssumptionsCatalogSchema.parse(assumptionsJson).data[0]!;

function model(id: string): ModelRecord {
  const value = models.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing model fixture '${id}'.`);
  return value;
}

function recommendedVramGB(id: string): number {
  const selected = model(id);
  const quantization = selected.quantizations.find(
    (candidate) => candidate.id === selected.recommendedQuantizationId,
  );
  if (!quantization) throw new Error(`Missing recommended quantization for '${id}'.`);

  return calculateVramRequirement({
    model: selected,
    quantization,
    peakContextTokens: 8192,
    peakConcurrentUsers: 1,
    assumptions: assumptions.vram,
  }).recommendedVramGB;
}

describe("mainstream local model catalog", () => {
  it("covers representative current open-weight families without inventing local performance", () => {
    const expectedIds = [
      "qwen3.5-9b",
      "qwen3.5-27b",
      "qwen3.6-35b-a3b",
      "gemma-4-12b-it",
      "gemma-4-26b-a4b-it",
      "gemma-4-31b-it",
      "mistral-small-3.1-24b-instruct",
      "mistral-small-4-119b",
      "llama-4-scout-17b-16e-instruct",
      "deepseek-r1-distill-qwen-14b",
      "deepseek-r1-distill-qwen-32b",
      "phi-4-14b",
      "gpt-oss-20b",
      "gpt-oss-120b",
      "qwen3-235b-a22b",
    ];

    expect(models.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining(expectedIds),
    );
    for (const id of expectedIds) {
      const candidate = model(id);
      expect(candidate.openWeight).toBe(true);
      expect(candidate.notes).toMatch(/runtime|compatib|validate/i);
      expect(candidate.notes).not.toMatch(
        /\b\d+(?:\.\d+)?\s*(?:tokens?\s*\/\s*s|t\s*\/\s*s|tps)\b/i,
      );
    }
  });

  it("keeps MoE total-weight capacity separate from active-parameter compute", () => {
    for (const id of [
      "qwen3.6-35b-a3b",
      "gemma-4-26b-a4b-it",
      "llama-4-scout-17b-16e-instruct",
      "mistral-small-4-119b",
      "gpt-oss-120b",
      "qwen3-235b-a22b",
    ]) {
      const candidate = model(id);
      expect(candidate.modelType).toBe("moe");
      expect(candidate.totalParametersB).toBeGreaterThan(
        candidate.activeParametersB,
      );
    }
  });

  it("spans the intended 16GB through 96GB planning envelopes at moderate context", () => {
    expect(recommendedVramGB("qwen3.5-9b")).toBeLessThan(16);
    expect(recommendedVramGB("mistral-small-3.1-24b-instruct")).toBeLessThan(24);
    expect(recommendedVramGB("qwen3.6-35b-a3b")).toBeLessThan(32);

    for (const id of [
      "llama-4-scout-17b-16e-instruct",
      "mistral-small-4-119b",
      "gpt-oss-120b",
    ]) {
      expect(recommendedVramGB(id)).toBeLessThan(96);
    }

    const qwen = model("qwen3-235b-a22b");
    expect(qwen.contextWindowTokens).toBe(40_960);
    expect(qwen.recommendedQuantizationId).toBe("q4");
    expect(qwen.quantizations.map((candidate) => candidate.id)).not.toContain(
      "q2",
    );
    expect(
      calculateVramRequirement({
        model: qwen,
        quantization: qwen.quantizations.find(
          (candidate) => candidate.id === qwen.recommendedQuantizationId,
        )!,
        peakContextTokens: 8192,
        peakConcurrentUsers: 1,
        assumptions: assumptions.vram,
      }).recommendedVramGB,
    ).toBeGreaterThan(96);
  });
});
