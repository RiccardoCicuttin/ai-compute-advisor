import { z } from "zod";
import {
  BrowserLibraryModelsSectionSchema,
  LOCAL_CLOUD_PRICING_ID_PREFIX,
  LOCAL_MODEL_ID_PREFIX,
  LocalModelDraftSchema,
  LocalModelLibraryEntrySchema,
  LocalModelLibrarySchema,
  type LocalModelDraft as LocalModelDraftType,
} from "../data/schemas";
import type {
  CloudPricingRecord,
  ModelRecord,
  NormalizedCatalogs,
} from "../types";

export const LOCAL_MODEL_LIBRARY_STORAGE_KEY = "aca:v1:local-model-library";
export const LOCAL_MODEL_LIBRARY_MAX_BYTES = 4 * 1024 * 1024;

export type LocalModelDraft = LocalModelDraftType;
export type LocalModelLibraryEntry = z.infer<typeof LocalModelLibraryEntrySchema>;
export type LocalModelLibrary = z.infer<typeof LocalModelLibrarySchema>;
export type BrowserLibraryModelsSection = z.infer<
  typeof BrowserLibraryModelsSectionSchema
>;

export type LocalModelLibraryErrorCode =
  | "invalid-id"
  | "duplicate-model"
  | "model-not-found"
  | "model-id-changed"
  | "too-large"
  | "invalid-json"
  | "invalid-value"
  | "storage-unavailable"
  | "storage-write-failed";

export class LocalModelLibraryError extends Error {
  readonly code: LocalModelLibraryErrorCode;

  constructor(code: LocalModelLibraryErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LocalModelLibraryError";
    this.code = code;
  }
}

export interface LocalModelLibraryStorageIssue {
  source: "local-model-library";
  key: typeof LOCAL_MODEL_LIBRARY_STORAGE_KEY;
  code: "unavailable" | "invalid-json" | "invalid-value" | "write-failed";
  message: string;
}

export interface LocalModelLibraryReadResult {
  library: LocalModelLibrary;
  issue: LocalModelLibraryStorageIssue | null;
}

export interface LocalModelLibraryJsonOptions {
  maxBytes?: number;
  pretty?: boolean;
}

export type LocalModelLibraryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type LocalModelReconciliationIssueCode =
  | "model-id-conflicts-with-data-pack"
  | "capability-tier-not-in-data-pack"
  | "pricing-id-conflicts-with-data-pack";

export interface LocalModelReconciliationIssue {
  severity: "warning";
  code: LocalModelReconciliationIssueCode;
  modelId: string;
  path: string;
  message: string;
  resolution: "reject-local-model" | "reject-local-pricing";
}

export interface ReconcileLocalModelLibraryResult {
  library: LocalModelLibrary;
  issues: LocalModelReconciliationIssue[];
  changed: boolean;
}

export interface MergeLocalModelLibraryResult extends ReconcileLocalModelLibraryResult {
  catalogs: NormalizedCatalogs;
}

function browserStorage(): LocalModelLibraryStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isoTimestamp(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Local model library timestamp must be a valid date.");
  }
  return date.toISOString();
}

function resolveMaxBytes(options: LocalModelLibraryJsonOptions): number {
  const maxBytes = options.maxBytes ?? LOCAL_MODEL_LIBRARY_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Local model library maxBytes must be a positive safe integer.");
  }
  return maxBytes;
}

function assertJsonSize(json: string, options: LocalModelLibraryJsonOptions): void {
  const maxBytes = resolveMaxBytes(options);
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > maxBytes) {
    throw new LocalModelLibraryError(
      "too-large",
      `Browser-local model library is ${bytes.toLocaleString("en-US")} bytes; the limit is ${maxBytes.toLocaleString("en-US")} bytes.`,
    );
  }
}

function dateOnly(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new RangeError("Draft date must be valid.");
  return value.toISOString().slice(0, 10);
}

function localIdSuffix(value: string): string {
  const withoutNamespace = value
    .trim()
    .toLowerCase()
    .replace(/^local\.(?:model|price)\./, "");
  const suffix = withoutNamespace
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 96);
  if (!suffix) {
    throw new LocalModelLibraryError(
      "invalid-id",
      "A browser-local model ID must contain at least one ASCII letter or number.",
    );
  }
  return suffix;
}

export function createLocalModelId(value: string): string {
  return `${LOCAL_MODEL_ID_PREFIX}${localIdSuffix(value)}`;
}

export function createLocalCloudPricingId(value: string): string {
  return `${LOCAL_CLOUD_PRICING_ID_PREFIX}${localIdSuffix(value)}`;
}

export function createEmptyLocalModelLibrary(
  updatedAt: Date | string,
): LocalModelLibrary {
  return {
    schemaVersion: 1,
    updatedAt: isoTimestamp(updatedAt),
    entries: [],
  };
}

/**
 * Creates a form seed. Presets are editable starting values, not evidence.
 * Benchmark scores are deliberately absent from this contract.
 */
export function createDefaultLocalModelDraft(
  catalogs: Pick<NormalizedCatalogs, "assumptions">,
  today: Date,
): LocalModelDraft {
  const capabilityTier = [...catalogs.assumptions.capabilityTiers].sort(
    (left, right) => left.rank - right.rank,
  )[0];
  if (!capabilityTier) {
    throw new RangeError("At least one capability tier is required to create a local model draft.");
  }
  return {
    id: "my-model",
    name: "My model",
    provider: "Local catalog",
    family: "",
    modelType: "dense",
    totalParametersB: null,
    activeParametersB: null,
    contextWindowTokens: null,
    maxOutputTokens: null,
    recommendedQuantizationId: "q4",
    quantizations: [
      { id: "q4", label: "4-bit", bitsPerParameter: 4, packingOverheadRatio: 0.1 },
    ],
    capabilityTierId: capabilityTier.id,
    reasoning: false,
    modalities: ["text"],
    openWeight: true,
    commercialUse: "unknown",
    kvCacheBytesPerToken: null,
    notes: "",
    cloudPricing: {
      enabled: false,
      provider: "",
      inputPricePerMillionTokens: null,
      outputPricePerMillionTokens: null,
      cachedInputPricePerMillionTokens: null,
      cacheWritePricePerMillionTokens: null,
      sourceUrl: "",
      lastUpdated: dateOnly(today),
    },
  };
}

/** Builds a complete ModelRecord and, independently, an optional price record. */
export function buildLocalModelLibraryEntry(
  input: LocalModelDraft,
  timestamp: Date | string,
): LocalModelLibraryEntry {
  const draft = LocalModelDraftSchema.parse(input);
  if (
    draft.totalParametersB === null ||
    draft.activeParametersB === null ||
    draft.contextWindowTokens === null
  ) {
    throw new RangeError("The local model draft is incomplete.");
  }

  const modelId = createLocalModelId(draft.id);
  const model: ModelRecord = {
    id: modelId,
    name: draft.name.trim(),
    provider: draft.provider.trim(),
    ...(draft.family.trim() ? { family: draft.family.trim() } : {}),
    modelType: draft.modelType,
    totalParametersB: draft.totalParametersB,
    activeParametersB: draft.activeParametersB,
    contextWindowTokens: draft.contextWindowTokens,
    ...(draft.maxOutputTokens === null ? {} : { maxOutputTokens: draft.maxOutputTokens }),
    recommendedQuantizationId: draft.recommendedQuantizationId,
    quantizations: draft.quantizations,
    capabilityTierId: draft.capabilityTierId,
    reasoning: draft.reasoning,
    modalities: draft.modalities,
    openWeight: draft.openWeight,
    commercialUse: draft.commercialUse,
    ...(draft.kvCacheBytesPerToken === null ? {} : { kvCacheBytesPerToken: draft.kvCacheBytesPerToken }),
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
  };

  let cloudPricing: CloudPricingRecord | undefined;
  if (draft.cloudPricing.enabled) {
    const pricing = draft.cloudPricing;
    if (
      pricing.inputPricePerMillionTokens === null ||
      pricing.outputPricePerMillionTokens === null
    ) {
      throw new RangeError("The local cloud pricing draft is incomplete.");
    }
    cloudPricing = {
      id: createLocalCloudPricingId(draft.id),
      provider: pricing.provider.trim(),
      modelId,
      modelName: model.name,
      currency: "USD",
      inputPricePerMillionTokens: pricing.inputPricePerMillionTokens,
      outputPricePerMillionTokens: pricing.outputPricePerMillionTokens,
      ...(pricing.cachedInputPricePerMillionTokens === null
        ? {}
        : { cachedInputPricePerMillionTokens: pricing.cachedInputPricePerMillionTokens }),
      ...(pricing.cacheWritePricePerMillionTokens === null
        ? {}
        : { cacheWritePricePerMillionTokens: pricing.cacheWritePricePerMillionTokens }),
      sourceUrl: pricing.sourceUrl,
      lastUpdated: pricing.lastUpdated,
    };
  }

  const at = isoTimestamp(timestamp);
  return LocalModelLibraryEntrySchema.parse({ model, cloudPricing, createdAt: at, updatedAt: at });
}

/** Converts a saved entry back to a complete, editable UI draft. */
export function localModelEntryToDraft(
  input: LocalModelLibraryEntry,
): LocalModelDraft {
  const entry = LocalModelLibraryEntrySchema.parse(input);
  const model = entry.model;
  const pricing = entry.cloudPricing;
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    family: model.family ?? "",
    modelType: model.modelType,
    totalParametersB: model.totalParametersB,
    activeParametersB: model.activeParametersB,
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens ?? null,
    recommendedQuantizationId: model.recommendedQuantizationId,
    quantizations: model.quantizations.map((quantization) => ({ ...quantization })),
    capabilityTierId: model.capabilityTierId,
    reasoning: model.reasoning,
    modalities: [...model.modalities],
    openWeight: model.openWeight,
    commercialUse: model.commercialUse,
    kvCacheBytesPerToken: model.kvCacheBytesPerToken ?? null,
    notes: model.notes ?? "",
    cloudPricing: pricing
      ? {
          enabled: true,
          provider: pricing.provider,
          inputPricePerMillionTokens: pricing.inputPricePerMillionTokens,
          outputPricePerMillionTokens: pricing.outputPricePerMillionTokens,
          cachedInputPricePerMillionTokens:
            pricing.cachedInputPricePerMillionTokens ?? null,
          cacheWritePricePerMillionTokens:
            pricing.cacheWritePricePerMillionTokens ?? null,
          sourceUrl: pricing.sourceUrl!,
          lastUpdated: pricing.lastUpdated,
        }
      : {
          enabled: false,
          provider: "",
          inputPricePerMillionTokens: null,
          outputPricePerMillionTokens: null,
          cachedInputPricePerMillionTokens: null,
          cacheWritePricePerMillionTokens: null,
          sourceUrl: "",
          lastUpdated: entry.updatedAt.slice(0, 10),
        },
  };
}

export function addLocalModel(
  library: LocalModelLibrary,
  entry: LocalModelLibraryEntry,
  updatedAt: Date | string,
): LocalModelLibrary {
  const current = LocalModelLibrarySchema.parse(library);
  const nextEntry = LocalModelLibraryEntrySchema.parse(entry);
  if (current.entries.some((candidate) => candidate.model.id === nextEntry.model.id)) {
    throw new LocalModelLibraryError(
      "duplicate-model",
      `Browser-local model '${nextEntry.model.id}' already exists. Delete it before adding a replacement.`,
    );
  }
  return LocalModelLibrarySchema.parse({
    ...current,
    updatedAt: isoTimestamp(updatedAt),
    entries: [...current.entries, nextEntry],
  });
}

/**
 * Replaces an existing entry without permitting identity changes. The original
 * creation timestamp remains authoritative; both update timestamps are refreshed.
 */
export function updateLocalModel(
  library: LocalModelLibrary,
  modelId: string,
  replacement: LocalModelLibraryEntry,
  updatedAt: Date | string,
): LocalModelLibrary {
  const current = LocalModelLibrarySchema.parse(library);
  const nextEntry = LocalModelLibraryEntrySchema.parse(replacement);
  if (nextEntry.model.id !== modelId) {
    throw new LocalModelLibraryError(
      "model-id-changed",
      `A browser-local model ID cannot change from '${modelId}' to '${nextEntry.model.id}'.`,
    );
  }
  const index = current.entries.findIndex((entry) => entry.model.id === modelId);
  if (index < 0) {
    throw new LocalModelLibraryError(
      "model-not-found",
      `Browser-local model '${modelId}' does not exist and cannot be updated.`,
    );
  }
  const at = isoTimestamp(updatedAt);
  const entries = current.entries.map((entry, candidateIndex) =>
    candidateIndex === index
      ? {
          ...nextEntry,
          createdAt: entry.createdAt,
          updatedAt: at,
        }
      : entry,
  );
  return LocalModelLibrarySchema.parse({
    ...current,
    updatedAt: at,
    entries,
  });
}

export function deleteLocalModel(
  library: LocalModelLibrary,
  modelId: string,
  updatedAt: Date | string,
): LocalModelLibrary {
  const current = LocalModelLibrarySchema.parse(library);
  if (!modelId.startsWith(LOCAL_MODEL_ID_PREFIX)) return current;
  const entries = current.entries.filter((entry) => entry.model.id !== modelId);
  if (entries.length === current.entries.length) return current;
  return LocalModelLibrarySchema.parse({
    ...current,
    updatedAt: isoTimestamp(updatedAt),
    entries,
  });
}

export function clearLocalModelLibrary(
  updatedAt: Date | string,
): LocalModelLibrary {
  return createEmptyLocalModelLibrary(updatedAt);
}

/** Strict standalone JSON parser for import and combined-pack extraction. */
export function parseLocalModelLibraryJson(
  json: string,
  options: LocalModelLibraryJsonOptions = {},
): LocalModelLibrary {
  assertJsonSize(json, options);
  let decoded: unknown;
  try {
    decoded = JSON.parse(json) as unknown;
  } catch (cause) {
    throw new LocalModelLibraryError(
      "invalid-json",
      "Browser-local model library is not valid JSON.",
      { cause },
    );
  }
  const parsed = LocalModelLibrarySchema.safeParse(decoded);
  if (!parsed.success) {
    throw new LocalModelLibraryError(
      "invalid-value",
      parsed.error.issues[0]?.message ?? "Browser-local model library is invalid.",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

/** Strict standalone JSON export; defaults to human-readable JSON. */
export function serializeLocalModelLibrary(
  library: LocalModelLibrary,
  options: LocalModelLibraryJsonOptions = {},
): string {
  const parsed = LocalModelLibrarySchema.parse(library);
  const json = options.pretty === false
    ? JSON.stringify(parsed)
    : `${JSON.stringify(parsed, null, 2)}\n`;
  assertJsonSize(json, options);
  return json;
}

/** Creates the model section embedded by a combined Browser Library Pack. */
export function createBrowserLibraryModelsSection(
  library: LocalModelLibrary,
): BrowserLibraryModelsSection {
  return BrowserLibraryModelsSectionSchema.parse({
    sectionSchemaVersion: 1,
    kind: "browser-local-model-library",
    library,
  });
}

/** Parses an extracted combined-pack model section without accepting extra keys. */
export function parseBrowserLibraryModelsSection(
  input: unknown,
): BrowserLibraryModelsSection {
  return BrowserLibraryModelsSectionSchema.parse(input);
}

export function readLocalModelLibrary(
  storage: LocalModelLibraryStorage | null = browserStorage(),
): LocalModelLibraryReadResult {
  const empty = createEmptyLocalModelLibrary("1970-01-01T00:00:00.000Z");
  if (!storage) {
    return {
      library: empty,
      issue: {
        source: "local-model-library",
        key: LOCAL_MODEL_LIBRARY_STORAGE_KEY,
        code: "unavailable",
        message: "Browser storage is unavailable; local models cannot persist.",
      },
    };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(LOCAL_MODEL_LIBRARY_STORAGE_KEY);
  } catch {
    return {
      library: empty,
      issue: {
        source: "local-model-library",
        key: LOCAL_MODEL_LIBRARY_STORAGE_KEY,
        code: "unavailable",
        message: "The browser-local model library could not be read.",
      },
    };
  }
  if (raw === null) return { library: empty, issue: null };
  try {
    return { library: parseLocalModelLibraryJson(raw), issue: null };
  } catch (error) {
    const code = error instanceof LocalModelLibraryError && error.code === "invalid-json"
      ? "invalid-json"
      : "invalid-value";
    return {
      library: empty,
      issue: {
        source: "local-model-library",
        key: LOCAL_MODEL_LIBRARY_STORAGE_KEY,
        code,
        message: code === "invalid-json"
          ? "Ignored a corrupt browser-local model library."
          : "Ignored an incompatible or oversized browser-local model library.",
      },
    };
  }
}

export function writeLocalModelLibrary(
  library: LocalModelLibrary,
  storage: LocalModelLibraryStorage | null = browserStorage(),
): void {
  if (!storage) {
    throw new LocalModelLibraryError("storage-unavailable", "Browser storage is unavailable.");
  }
  const serialized = serializeLocalModelLibrary(library, { pretty: false });
  try {
    storage.setItem(LOCAL_MODEL_LIBRARY_STORAGE_KEY, serialized);
  } catch (cause) {
    throw new LocalModelLibraryError(
      "storage-write-failed",
      "The browser-local model library could not be saved.",
      { cause },
    );
  }
}

export function clearStoredLocalModelLibrary(
  storage: LocalModelLibraryStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(LOCAL_MODEL_LIBRARY_STORAGE_KEY);
  } catch (cause) {
    throw new LocalModelLibraryError(
      "storage-write-failed",
      "The browser-local model library could not be removed.",
      { cause },
    );
  }
}

/** Removes a previous overlay while preserving the authoritative Data Pack. */
export function removeLocalModelLibraryOverlay(
  catalogs: NormalizedCatalogs,
): NormalizedCatalogs {
  const overlay = catalogs.localModelOverlay;
  if (!overlay) return catalogs;
  const modelIds = new Set(overlay.modelIds);
  const pricingIds = new Set(overlay.cloudPricingIds);
  const { localModelOverlay: _overlay, ...base } = catalogs;
  return {
    ...base,
    models: catalogs.models.filter((model) => !modelIds.has(model.id)),
    cloudPricing: catalogs.cloudPricing.filter((pricing) => !pricingIds.has(pricing.id)),
  };
}

/**
 * Checks browser records after a Data Pack change. Invalid external references
 * are rejected with an explicit issue; prices are never rebound by position.
 */
export function reconcileLocalModelLibrary(
  library: LocalModelLibrary,
  activeCatalogs: NormalizedCatalogs,
): ReconcileLocalModelLibraryResult {
  const current = LocalModelLibrarySchema.parse(library);
  const catalogs = removeLocalModelLibraryOverlay(activeCatalogs);
  const capabilityTiers = new Set(
    catalogs.assumptions.capabilityTiers.map((tier) => tier.id),
  );
  const activeModelIds = new Set(catalogs.models.map((model) => model.id));
  const activePricingIds = new Set(catalogs.cloudPricing.map((pricing) => pricing.id));
  const entries: LocalModelLibraryEntry[] = [];
  const issues: LocalModelReconciliationIssue[] = [];

  for (const entry of current.entries) {
    if (activeModelIds.has(entry.model.id)) {
      issues.push({
        severity: "warning",
        code: "model-id-conflicts-with-data-pack",
        modelId: entry.model.id,
        path: "model.id",
        message: `Local model '${entry.model.id}' conflicts with the active Data Pack and was not activated.`,
        resolution: "reject-local-model",
      });
      continue;
    }
    if (!capabilityTiers.has(entry.model.capabilityTierId)) {
      issues.push({
        severity: "warning",
        code: "capability-tier-not-in-data-pack",
        modelId: entry.model.id,
        path: "model.capabilityTierId",
        message: `Local model '${entry.model.id}' uses capability tier '${entry.model.capabilityTierId}', which is not present in the active Data Pack. The model was not activated.`,
        resolution: "reject-local-model",
      });
      continue;
    }

    if (entry.cloudPricing && activePricingIds.has(entry.cloudPricing.id)) {
      const { cloudPricing: _pricing, ...modelOnly } = entry;
      entries.push(modelOnly);
      issues.push({
        severity: "warning",
        code: "pricing-id-conflicts-with-data-pack",
        modelId: entry.model.id,
        path: "cloudPricing.id",
        message: `Local price '${entry.cloudPricing.id}' conflicts with the active Data Pack. The model was activated without that price.`,
        resolution: "reject-local-pricing",
      });
      continue;
    }
    entries.push(entry);
  }

  return {
    library: { ...current, entries },
    issues,
    changed: issues.length > 0,
  };
}

/**
 * Creates the calculation/view catalog overlay. No benchmark rows are created,
 * so comparison metrics without a compatible cohort remain unavailable.
 */
export function mergeLocalModelLibraryIntoCatalogs(
  activeCatalogs: NormalizedCatalogs,
  library: LocalModelLibrary,
): MergeLocalModelLibraryResult {
  const base = removeLocalModelLibraryOverlay(activeCatalogs);
  const reconciled = reconcileLocalModelLibrary(library, base);
  const localModels = reconciled.library.entries.map((entry) => entry.model);
  const localPrices = reconciled.library.entries.flatMap((entry) =>
    entry.cloudPricing ? [entry.cloudPricing] : [],
  );
  return {
    ...reconciled,
    catalogs: {
      ...base,
      models: [...base.models, ...localModels],
      cloudPricing: [...base.cloudPricing, ...localPrices],
      localModelOverlay: {
        kind: "browser-local-models",
        modelIds: localModels.map((model) => model.id),
        cloudPricingIds: localPrices.map((pricing) => pricing.id),
      },
    },
  };
}
