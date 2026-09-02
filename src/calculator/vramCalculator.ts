import type {
  AssumptionsRecord,
  ModelRecord,
  QuantizationProfile,
  VramResult,
} from "../types";
import { assertFiniteNonNegative, trace, value } from "./trace";

export interface VramInput {
  model: ModelRecord;
  quantization: QuantizationProfile;
  peakContextTokens: number;
  peakConcurrentUsers: number;
  assumptions: AssumptionsRecord["vram"];
}

export function calculateModelWeightGB(
  model: ModelRecord,
  quantization: QuantizationProfile,
): number {
  return (
    model.totalParametersB *
    (quantization.bitsPerParameter / 8) *
    (1 + quantization.packingOverheadRatio)
  );
}

export function calculateVramRequirement(input: VramInput): VramResult {
  assertFiniteNonNegative(input.peakContextTokens, "peakContextTokens");
  assertFiniteNonNegative(input.peakConcurrentUsers, "peakConcurrentUsers");

  const modelWeightGB = calculateModelWeightGB(input.model, input.quantization);
  const kvCacheMethod = input.model.kvCacheBytesPerToken ? "model-data" : "class-fallback";
  const kvCacheBytesPerToken =
    input.model.kvCacheBytesPerToken ??
    input.assumptions.fallbackKvCacheBytesPerTokenByTier[input.model.capabilityTierId] ??
    Object.values(input.assumptions.fallbackKvCacheBytesPerTokenByTier)[0];
  if (kvCacheBytesPerToken === undefined) {
    throw new Error("No KV-cache fallback is configured for the selected model capability tier.");
  }
  // Windowed/local-attention layers (e.g. Gemma 3/4's sliding-window
  // layers) cap their KV cache at the layer's own window size instead of
  // scaling with context length; kvCacheFixedBytes carries that constant
  // contribution separately from the linear, per-token rate above. Each
  // concurrent user still needs their own copy of it.
  const kvCacheFixedGB =
    ((input.model.kvCacheFixedBytes ?? 0) * input.peakConcurrentUsers) / 1_000_000_000;
  const kvCacheGB =
    (input.peakContextTokens * input.peakConcurrentUsers * kvCacheBytesPerToken) / 1_000_000_000 +
    kvCacheFixedGB;
  const runtimeOverheadGB = Math.max(
    input.assumptions.minimumRuntimeOverheadGB,
    modelWeightGB * input.assumptions.defaultRuntimeOverheadRatio,
  );
  const hardMinimumGB = modelWeightGB + kvCacheGB + runtimeOverheadGB;
  const safetyMarginGB = hardMinimumGB * input.assumptions.safetyMarginRatio;
  const recommendedVramGB = hardMinimumGB + safetyMarginGB;
  const warnings =
    kvCacheMethod === "class-fallback"
      ? ["KV cache uses a class-level fallback because the model has no model-specific value."]
      : [];

  return {
    modelWeightGB,
    kvCacheGB,
    runtimeOverheadGB,
    safetyMarginGB,
    hardMinimumGB,
    recommendedVramGB,
    kvCacheMethod,
    trace: trace({
      id: "vram-requirement",
      title: "Recommended VRAM",
      formula: "Model weights + KV cache + runtime overhead + safety margin",
      inputs: [
        value("totalParameters", "Total parameters", input.model.totalParametersB, "ratio", "model-data"),
        value("bits", "Bits per parameter", input.quantization.bitsPerParameter, "ratio", "model-data"),
        value("peakContext", "Peak context", input.peakContextTokens, "tokens", "user"),
        value("concurrency", "Peak concurrent users", input.peakConcurrentUsers, "ratio", "user"),
      ],
      intermediateValues: [
        value("modelWeight", "Model weight", modelWeightGB, "GB", "derived"),
        value("kvCache", "KV cache", kvCacheGB, "GB", kvCacheMethod === "model-data" ? "model-data" : "assumption"),
        ...(kvCacheFixedGB > 0
          ? [
              value(
                "kvCacheFixed",
                "KV cache (windowed-attention layers, fixed)",
                kvCacheFixedGB,
                "GB",
                "model-data" as const,
              ),
            ]
          : []),
        value("runtime", "Runtime overhead", runtimeOverheadGB, "GB", "assumption"),
        value("safety", "Safety margin", safetyMarginGB, "GB", "assumption"),
      ],
      result: value("recommendedVram", "Recommended VRAM", recommendedVramGB, "GB", "derived"),
      method: kvCacheMethod === "model-data" ? "derived" : "estimated",
      warnings,
      sourceIds: [input.model.id],
    }),
  };
}
