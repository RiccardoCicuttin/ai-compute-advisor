import { z } from "zod";
import {
  CloudPricingRecordSchema,
  ModelBenchmarkRecordSchema,
  ModelRecordSchema,
} from "../schemas";
import type {
  CloudPricingRecord,
  ModelBenchmarkRecord,
  ModelRecord,
} from "../../types";

export interface NormalizedCatalogPatch {
  models: ModelRecord[];
  cloudPricing: CloudPricingRecord[];
  modelBenchmarks: ModelBenchmarkRecord[];
}

export interface AdapterIssue {
  path?: string;
  code: string;
  message: string;
}

export interface ArtificialAnalysisAdapterOptions {
  importedAt: string;
  externalToInternalModelIds: Record<string, string>;
}

export interface ArtificialAnalysisAdapterResult {
  data: NormalizedCatalogPatch;
  issues: AdapterIssue[];
}

const SourceSnapshotSchema = z
  .object({
    models: z.array(z.unknown()).optional(),
    modelBenchmarks: z.array(z.unknown()).optional(),
    benchmarks: z.array(z.unknown()).optional(),
    cloudPricing: z.array(z.unknown()).optional(),
    pricing: z.array(z.unknown()).optional(),
  })
  .passthrough();

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function first(record: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function stringValue(record: UnknownRecord, keys: string[]): string | undefined {
  const value = first(record, keys);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(record: UnknownRecord, keys: string[]): number | undefined {
  const value = first(record, keys);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(record: UnknownRecord, keys: string[]): boolean | undefined {
  const value = first(record, keys);
  return typeof value === "boolean" ? value : undefined;
}

function importedDate(importedAt: string): string | undefined {
  const date = new Date(importedAt);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString().slice(0, 10);
}

function mappedModelId(
  record: UnknownRecord,
  options: ArtificialAnalysisAdapterOptions,
  path: string,
  issues: AdapterIssue[],
): string | undefined {
  const externalId = stringValue(record, [
    "externalModelId",
    "modelId",
    "model_id",
    "slug",
    "id",
  ]);
  if (!externalId) {
    issues.push({
      path,
      code: "MISSING_EXTERNAL_MODEL_ID",
      message: "Record does not contain an external model ID.",
    });
    return undefined;
  }

  const internalId = options.externalToInternalModelIds[externalId];
  if (!internalId) {
    issues.push({
      path,
      code: "UNMAPPED_MODEL_ID",
      message: `No stable internal model ID is configured for '${externalId}'.`,
    });
    return undefined;
  }
  return internalId;
}

function appendSchemaIssues(
  path: string,
  error: z.ZodError,
  issues: AdapterIssue[],
): void {
  for (const issue of error.issues) {
    issues.push({
      path: [path, ...issue.path.map(String)].filter(Boolean).join("."),
      code: "INVALID_INTERNAL_RECORD",
      message: issue.message,
    });
  }
}

function adaptModels(
  values: unknown[],
  options: ArtificialAnalysisAdapterOptions,
  issues: AdapterIssue[],
): ModelRecord[] {
  const models: ModelRecord[] = [];

  values.forEach((value, index) => {
    const path = `models[${index}]`;
    const record = asRecord(value);
    if (!record) {
      issues.push({ path, code: "INVALID_SOURCE_RECORD", message: "Expected an object." });
      return;
    }
    const id = mappedModelId(record, options, path, issues);
    if (!id) return;

    const candidate = {
      id,
      name: stringValue(record, ["name", "modelName", "model_name"]),
      provider: stringValue(record, ["provider", "creator", "organization"]),
      family: stringValue(record, ["family"]),
      modelType: stringValue(record, ["modelType", "model_type", "architecture"]),
      totalParametersB: numberValue(record, [
        "totalParametersB",
        "total_parameters_b",
        "totalParameters",
      ]),
      activeParametersB: numberValue(record, [
        "activeParametersB",
        "active_parameters_b",
        "activeParameters",
      ]),
      contextWindowTokens: numberValue(record, [
        "contextWindowTokens",
        "context_window_tokens",
        "contextWindow",
      ]),
      maxOutputTokens: numberValue(record, ["maxOutputTokens", "max_output_tokens"]),
      recommendedQuantizationId: stringValue(record, [
        "recommendedQuantizationId",
        "recommended_quantization_id",
      ]),
      quantizations: first(record, ["quantizations"]),
      capabilityTierId: stringValue(record, [
        "capabilityTierId",
        "capability_tier_id",
        "intelligenceClass",
        "intelligence_class",
      ]),
      reasoning: booleanValue(record, ["reasoning", "isReasoning"]),
      modalities: first(record, ["modalities"]),
      openWeight: booleanValue(record, ["openWeight", "open_weight"]),
      commercialUse: stringValue(record, ["commercialUse", "commercial_use"]),
      kvCacheBytesPerToken: numberValue(record, [
        "kvCacheBytesPerToken",
        "kv_cache_bytes_per_token",
      ]),
      notes: stringValue(record, ["notes"]),
    };

    const parsed = ModelRecordSchema.safeParse(candidate);
    if (parsed.success) models.push(parsed.data);
    else appendSchemaIssues(path, parsed.error, issues);
  });

  return models;
}

function adaptBenchmarks(
  values: unknown[],
  options: ArtificialAnalysisAdapterOptions,
  issues: AdapterIssue[],
): ModelBenchmarkRecord[] {
  const benchmarks: ModelBenchmarkRecord[] = [];

  values.forEach((value, index) => {
    const path = `modelBenchmarks[${index}]`;
    const record = asRecord(value);
    if (!record) {
      issues.push({ path, code: "INVALID_SOURCE_RECORD", message: "Expected an object." });
      return;
    }
    const modelId = mappedModelId(record, options, path, issues);
    if (!modelId) return;

    const candidate = {
      id: stringValue(record, ["id", "observationId", "observation_id"]),
      modelId,
      sourceId: stringValue(record, ["sourceId", "source_id"]),
      methodologyVersion: stringValue(record, [
        "methodologyVersion",
        "methodology_version",
      ]),
      measuredAt:
        stringValue(record, ["measuredAt", "measured_at", "observationDate"]) ??
        importedDate(options.importedAt),
      intelligenceScore: numberValue(record, ["intelligenceScore", "intelligence_score"]),
      intelligenceScale: first(record, ["intelligenceScale", "intelligence_scale"]),
      codingScore: numberValue(record, ["codingScore", "coding_score"]),
      agenticScore: numberValue(record, ["agenticScore", "agentic_score"]),
      longContextScore: numberValue(record, ["longContextScore", "long_context_score"]),
      knowledgeReliabilityScore: numberValue(record, [
        "knowledgeReliabilityScore",
        "knowledge_reliability_score",
      ]),
      opennessScore: numberValue(record, ["opennessScore", "openness_score"]),
      outputTokensPerSecond: numberValue(record, [
        "outputTokensPerSecond",
        "output_tokens_per_second",
      ]),
      timeToFirstTokenSeconds: numberValue(record, [
        "timeToFirstTokenSeconds",
        "time_to_first_token_seconds",
      ]),
      timeToFirstAnswerTokenSeconds: numberValue(record, [
        "timeToFirstAnswerTokenSeconds",
        "time_to_first_answer_token_seconds",
      ]),
      endToEnd500TokensSeconds: numberValue(record, [
        "endToEnd500TokensSeconds",
        "end_to_end_500_tokens_seconds",
      ]),
      averageOutputTokensPerTask: numberValue(record, [
        "averageOutputTokensPerTask",
        "average_output_tokens_per_task",
      ]),
      method: stringValue(record, ["method"]),
    };

    const parsed = ModelBenchmarkRecordSchema.safeParse(candidate);
    if (parsed.success) benchmarks.push(parsed.data);
    else appendSchemaIssues(path, parsed.error, issues);
  });

  return benchmarks;
}

function adaptPricing(
  values: unknown[],
  options: ArtificialAnalysisAdapterOptions,
  issues: AdapterIssue[],
): CloudPricingRecord[] {
  const pricing: CloudPricingRecord[] = [];

  values.forEach((value, index) => {
    const path = `cloudPricing[${index}]`;
    const record = asRecord(value);
    if (!record) {
      issues.push({ path, code: "INVALID_SOURCE_RECORD", message: "Expected an object." });
      return;
    }

    const hasExternalModelId = stringValue(record, [
      "externalModelId",
      "modelId",
      "model_id",
    ]);
    const modelId = hasExternalModelId
      ? mappedModelId(record, options, path, issues)
      : undefined;
    if (hasExternalModelId && !modelId) return;

    const candidate = {
      id: stringValue(record, ["id", "offeringId", "offering_id"]),
      provider: stringValue(record, ["provider"]),
      modelId,
      modelName: stringValue(record, ["modelName", "model_name", "name"]),
      currency: stringValue(record, ["currency"]) ?? "USD",
      inputPricePerMillionTokens: numberValue(record, [
        "inputPricePerMillionTokens",
        "input_price_per_million_tokens",
        "inputPrice",
      ]),
      outputPricePerMillionTokens: numberValue(record, [
        "outputPricePerMillionTokens",
        "output_price_per_million_tokens",
        "outputPrice",
      ]),
      cachedInputPricePerMillionTokens: numberValue(record, [
        "cachedInputPricePerMillionTokens",
        "cached_input_price_per_million_tokens",
        "cachedInputPrice",
      ]),
      cacheWritePricePerMillionTokens: numberValue(record, [
        "cacheWritePricePerMillionTokens",
        "cache_write_price_per_million_tokens",
      ]),
      sourceUrl: stringValue(record, ["sourceUrl", "source_url"]),
      lastUpdated:
        stringValue(record, ["lastUpdated", "last_updated"]) ??
        importedDate(options.importedAt),
    };

    const parsed = CloudPricingRecordSchema.safeParse(candidate);
    if (parsed.success) pricing.push(parsed.data);
    else appendSchemaIssues(path, parsed.error, issues);
  });

  return pricing;
}

export function adaptArtificialAnalysisSnapshot(
  raw: unknown,
  options: ArtificialAnalysisAdapterOptions,
): ArtificialAnalysisAdapterResult {
  const result: ArtificialAnalysisAdapterResult = {
    data: { models: [], cloudPricing: [], modelBenchmarks: [] },
    issues: [],
  };
  if (!importedDate(options.importedAt)) {
    result.issues.push({
      path: "options.importedAt",
      code: "INVALID_IMPORT_DATE",
      message: "importedAt must be a valid date.",
    });
    return result;
  }

  const snapshot = SourceSnapshotSchema.safeParse(raw);
  if (!snapshot.success) {
    result.issues.push({
      code: "INVALID_SNAPSHOT",
      message: "Artificial Analysis snapshot must be an object containing arrays.",
    });
    return result;
  }

  const benchmarkValues =
    snapshot.data.modelBenchmarks ?? snapshot.data.benchmarks ?? [];
  const pricingValues = snapshot.data.cloudPricing ?? snapshot.data.pricing ?? [];
  result.data.models = adaptModels(snapshot.data.models ?? [], options, result.issues);
  result.data.modelBenchmarks = adaptBenchmarks(
    benchmarkValues,
    options,
    result.issues,
  );
  result.data.cloudPricing = adaptPricing(pricingValues, options, result.issues);
  return result;
}
