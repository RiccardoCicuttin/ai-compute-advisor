import { z } from "zod";
import { isFrankfurterLatestUrl } from "../currency/frankfurterAdapter";
import type {
  CatalogEnvelope,
  CatalogKey,
  NormalizedCatalogs,
} from "../types";
import {
  AssumptionsCatalogSchema,
  CatalogIntegrityError,
  CloudPricingCatalogSchema,
  DataManifestSchema,
  DesktopSystemsCatalogSchema,
  ExchangeRateCatalogSchema,
  GpusCatalogSchema,
  InferenceProfilesCatalogSchema,
  ModelBenchmarksCatalogSchema,
  ModelsCatalogSchema,
  PresetsCatalogSchema,
  parseCatalogBundle,
} from "./schemas";
import { validateCatalogRelationships } from "./validators";

export const DATA_PACK_STORAGE_KEY = "aca:v1:data-pack";
export const DATA_PACK_MAX_BYTES = 4 * 1024 * 1024;
export const DATA_PACK_MAX_RECORDS_PER_CATALOG = 10_000;

const PORTABLE_CATALOG_PATHS = {
  models: "models.json",
  modelBenchmarks: "model-benchmarks.json",
  gpus: "gpus.json",
  inferenceProfiles: "inference-profiles.json",
  cloudPricing: "cloud-pricing.json",
  assumptions: "assumptions.json",
  presets: "presets.json",
  systems: "systems.json",
  exchangeRates: "exchange-rates.json",
} as const satisfies Record<CatalogKey, string>;

const ENVELOPED_CATALOG_KEYS = [
  "models",
  "modelBenchmarks",
  "gpus",
  "inferenceProfiles",
  "cloudPricing",
  "assumptions",
  "presets",
  "systems",
] as const;

export type DataPackErrorCode =
  | "too-large"
  | "invalid-json"
  | "invalid-pack"
  | "invalid-export-time"
  | "storage-unavailable"
  | "storage-read-failed"
  | "storage-write-failed"
  | "browser-unavailable";

export class DataPackError extends Error {
  readonly code: DataPackErrorCode;
  readonly issues: string[];

  constructor(
    code: DataPackErrorCode,
    message: string,
    options: { cause?: unknown; issues?: string[] } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DataPackError";
    this.code = code;
    this.issues = options.issues ?? [];
  }
}

export const PortableCatalogBundleSchema = z.strictObject({
  models: ModelsCatalogSchema,
  modelBenchmarks: ModelBenchmarksCatalogSchema,
  gpus: GpusCatalogSchema,
  inferenceProfiles: InferenceProfilesCatalogSchema,
  cloudPricing: CloudPricingCatalogSchema,
  assumptions: AssumptionsCatalogSchema,
  presets: PresetsCatalogSchema,
  systems: DesktopSystemsCatalogSchema,
  exchangeRates: ExchangeRateCatalogSchema,
});

export const PortableDataPackSchema = z
  .strictObject({
    packSchemaVersion: z.literal(1),
    exportedAt: z.iso.datetime(),
    manifest: DataManifestSchema,
    catalogs: PortableCatalogBundleSchema,
  })
  .superRefine((pack, context) => {
    if (pack.manifest.dataVersion.length > 128) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "dataVersion"],
        message: "Data Pack version must be 128 characters or fewer.",
      });
    }

    for (const [key, expectedPath] of Object.entries(
      PORTABLE_CATALOG_PATHS,
    ) as Array<[CatalogKey, string]>) {
      if (pack.manifest.catalogs[key] !== expectedPath) {
        context.addIssue({
          code: "custom",
          path: ["manifest", "catalogs", key],
          message: `Portable Data Packs must use '${expectedPath}' for '${key}'.`,
        });
      }
    }

    // Imported data must not be able to make the browser contact an arbitrary
    // host. Static rates remain configurable; the optional refresh endpoint is
    // intentionally fixed at this trust boundary.
    if (!isFrankfurterLatestUrl(
      pack.catalogs.exchangeRates.source.apiUrl,
      pack.catalogs.exchangeRates,
    )) {
      context.addIssue({
        code: "custom",
        path: ["catalogs", "exchangeRates", "source", "apiUrl"],
        message:
          "Portable Data Packs cannot configure an arbitrary exchange-rate endpoint.",
      });
    }
  });

export type PortableCatalogBundle = z.infer<
  typeof PortableCatalogBundleSchema
>;
export type PortableDataPack = z.infer<typeof PortableDataPackSchema>;

export interface ParsedPortableDataPack {
  pack: PortableDataPack;
  catalogs: NormalizedCatalogs;
}

export interface DataPackJsonParseOptions {
  maxBytes?: number;
}

export interface DataPackFileLike {
  readonly size: number;
  text(): Promise<string>;
}

export type DataPackStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function envelope<T>(
  catalogs: NormalizedCatalogs,
  key: Exclude<CatalogKey, "exchangeRates">,
  data: T[],
): CatalogEnvelope<T> {
  const metadata = catalogs.metadata[key];
  return {
    schemaVersion: 1,
    catalogId: metadata.catalogId,
    lastUpdated: metadata.lastUpdated,
    source: metadata.source,
    data,
  };
}

function manifestLastUpdated(catalogs: NormalizedCatalogs): string {
  return (
    Object.values(catalogs.metadata)
      .map((metadata) => metadata.lastUpdated)
      .sort()
      .at(-1) ?? "1970-01-01"
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assertReasonableRecordCounts(raw: unknown): void {
  const catalogs = asRecord(asRecord(raw)?.catalogs);
  if (!catalogs) return;

  for (const key of ENVELOPED_CATALOG_KEYS) {
    const data = asRecord(catalogs[key])?.data;
    if (
      Array.isArray(data) &&
      data.length > DATA_PACK_MAX_RECORDS_PER_CATALOG
    ) {
      throw new DataPackError(
        "too-large",
        `Data Pack catalog '${key}' exceeds the ${DATA_PACK_MAX_RECORDS_PER_CATALOG.toLocaleString("en-US")} record limit.`,
      );
    }
  }
}

function zodIssueMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.map(String).join(".") : "root";
    return `${path}: ${issue.message}`;
  });
}

function parseErrorDetails(error: unknown): string[] {
  if (error instanceof z.ZodError) return zodIssueMessages(error);
  if (error instanceof CatalogIntegrityError) return error.issues;
  return [];
}

function dataPackByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function resolveMaxBytes(options: DataPackJsonParseOptions): number {
  const maxBytes = options.maxBytes ?? DATA_PACK_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Data Pack maxBytes must be a positive safe integer.");
  }
  return maxBytes;
}

function assertJsonSize(
  json: string,
  options: DataPackJsonParseOptions = {},
): void {
  const maxBytes = resolveMaxBytes(options);
  const bytes = dataPackByteLength(json);
  if (bytes > maxBytes) {
    throw new DataPackError(
      "too-large",
      `Data Pack is ${bytes.toLocaleString("en-US")} bytes; the limit is ${maxBytes.toLocaleString("en-US")} bytes.`,
    );
  }
}

function validateRelationshipIntegrity(catalogs: NormalizedCatalogs): void {
  const relationshipIssues = validateCatalogRelationships(catalogs).filter(
    (issue) => issue.severity === "error",
  );
  if (relationshipIssues.length === 0) return;

  const issues = relationshipIssues.map(
    (issue) =>
      `${issue.catalog}${issue.path ? ` at ${issue.path}` : ""}: ${issue.message}`,
  );
  throw new DataPackError(
    "invalid-pack",
    `Data Pack relationship validation failed. ${issues[0]}`,
    { issues },
  );
}

export function createPortableDataPack(
  catalogs: NormalizedCatalogs,
  exportedAt = new Date(),
): PortableDataPack {
  if (Number.isNaN(exportedAt.getTime())) {
    throw new DataPackError(
      "invalid-export-time",
      "Data Pack export time must be a valid Date.",
    );
  }

  // Browser-local model overlays participate in calculation and comparison,
  // but are a separate persistence contract. Never smuggle them into an
  // authoritative Full Data Pack export.
  const localModelIds = new Set(catalogs.localModelOverlay?.modelIds ?? []);
  const localCloudPricingIds = new Set(
    catalogs.localModelOverlay?.cloudPricingIds ?? [],
  );
  const exportModels = catalogs.models.filter(
    (model) => !localModelIds.has(model.id),
  );
  const exportCloudPricing = catalogs.cloudPricing.filter(
    (pricing) => !localCloudPricingIds.has(pricing.id),
  );

  const candidate = {
    packSchemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    manifest: {
      schemaVersion: 1,
      dataVersion: catalogs.dataVersion,
      lastUpdated: manifestLastUpdated(catalogs),
      catalogs: { ...PORTABLE_CATALOG_PATHS },
    },
    catalogs: {
      models: envelope(catalogs, "models", exportModels),
      modelBenchmarks: envelope(
        catalogs,
        "modelBenchmarks",
        catalogs.modelBenchmarks,
      ),
      gpus: envelope(catalogs, "gpus", catalogs.gpus),
      inferenceProfiles: envelope(
        catalogs,
        "inferenceProfiles",
        catalogs.inferenceProfiles,
      ),
      cloudPricing: envelope(
        catalogs,
        "cloudPricing",
        exportCloudPricing,
      ),
      assumptions: envelope(catalogs, "assumptions", [catalogs.assumptions]),
      presets: envelope(catalogs, "presets", catalogs.presets),
      systems: envelope(catalogs, "systems", catalogs.systems),
      exchangeRates: catalogs.exchangeRates,
    },
  };

  // Re-parse the generated pack so callers receive a validated, detached
  // object rather than references into the active catalog state.
  return parsePortableDataPack(candidate).pack;
}

export function parsePortableDataPack(raw: unknown): ParsedPortableDataPack {
  assertReasonableRecordCounts(raw);

  let pack: PortableDataPack;
  try {
    pack = PortableDataPackSchema.parse(raw);
  } catch (error) {
    if (error instanceof DataPackError) throw error;
    const issues = parseErrorDetails(error);
    throw new DataPackError(
      "invalid-pack",
      `Data Pack schema validation failed.${issues[0] ? ` ${issues[0]}` : ""}`,
      { cause: error, issues },
    );
  }

  let catalogs: NormalizedCatalogs;
  try {
    catalogs = parseCatalogBundle({
      manifest: pack.manifest,
      ...pack.catalogs,
    });
  } catch (error) {
    const issues = parseErrorDetails(error);
    throw new DataPackError(
      "invalid-pack",
      `Data Pack catalog validation failed.${issues[0] ? ` ${issues[0]}` : ""}`,
      { cause: error, issues },
    );
  }

  validateRelationshipIntegrity(catalogs);
  return { pack, catalogs };
}

export function parsePortableDataPackJson(
  json: string,
  options: DataPackJsonParseOptions = {},
): ParsedPortableDataPack {
  assertJsonSize(json, options);

  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch (error) {
    throw new DataPackError(
      "invalid-json",
      "Data Pack is not valid JSON.",
      { cause: error },
    );
  }
  return parsePortableDataPack(raw);
}

export async function parsePortableDataPackFile(
  file: DataPackFileLike,
  options: DataPackJsonParseOptions = {},
): Promise<ParsedPortableDataPack> {
  const maxBytes = resolveMaxBytes(options);
  if (!Number.isFinite(file.size) || file.size < 0) {
    throw new DataPackError(
      "invalid-pack",
      "Data Pack file size is invalid.",
    );
  }
  if (file.size > maxBytes) {
    throw new DataPackError(
      "too-large",
      `Data Pack file is ${file.size.toLocaleString("en-US")} bytes; the limit is ${maxBytes.toLocaleString("en-US")} bytes.`,
    );
  }

  let json: string;
  try {
    json = await file.text();
  } catch (error) {
    throw new DataPackError(
      "invalid-json",
      "Data Pack file could not be read.",
      { cause: error },
    );
  }
  return parsePortableDataPackJson(json, { maxBytes });
}

function serializeDataPack(pack: PortableDataPack, pretty: boolean): string {
  const validated = parsePortableDataPack(pack).pack;
  const json = pretty
    ? `${JSON.stringify(validated, null, 2)}\n`
    : JSON.stringify(validated);
  assertJsonSize(json);
  return json;
}

export function serializePortableDataPack(pack: PortableDataPack): string {
  return serializeDataPack(pack, true);
}

function browserStorage(): DataPackStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredDataPack(
  storage: DataPackStorage | null = browserStorage(),
): { catalogs: NormalizedCatalogs | null; error: Error | null } {
  if (!storage) return { catalogs: null, error: null };

  let raw: string | null;
  try {
    raw = storage.getItem(DATA_PACK_STORAGE_KEY);
  } catch (error) {
    return {
      catalogs: null,
      error: new DataPackError(
        "storage-read-failed",
        "Saved Data Pack could not be read from browser storage.",
        { cause: error },
      ),
    };
  }
  if (!raw) return { catalogs: null, error: null };

  try {
    return { catalogs: parsePortableDataPackJson(raw).catalogs, error: null };
  } catch (error) {
    return {
      catalogs: null,
      error:
        error instanceof Error
          ? error
          : new DataPackError("invalid-pack", "Stored Data Pack is invalid."),
    };
  }
}

export function writeStoredDataPack(
  pack: PortableDataPack,
  storage: DataPackStorage | null = browserStorage(),
): void {
  if (!storage) {
    throw new DataPackError(
      "storage-unavailable",
      "Browser storage is unavailable.",
    );
  }

  const serialized = serializeDataPack(pack, false);
  try {
    storage.setItem(DATA_PACK_STORAGE_KEY, serialized);
  } catch (error) {
    throw new DataPackError(
      "storage-write-failed",
      "Data Pack could not be saved in browser storage.",
      { cause: error },
    );
  }
}

export function clearStoredDataPack(
  storage: DataPackStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(DATA_PACK_STORAGE_KEY);
  } catch (error) {
    throw new DataPackError(
      "storage-write-failed",
      "Saved Data Pack could not be removed from browser storage.",
      { cause: error },
    );
  }
}

export function getPortableDataPackFilename(dataVersion: string): string {
  const safeVersion = dataVersion
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return `ai-compute-advisor-data-pack-${safeVersion || "data"}.json`;
}

export function downloadPortableDataPack(catalogs: NormalizedCatalogs): void {
  if (
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    throw new DataPackError(
      "browser-unavailable",
      "Data Pack download requires a browser document.",
    );
  }

  const pack = createPortableDataPack(catalogs);
  const blob = new Blob([serializePortableDataPack(pack)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = getPortableDataPackFilename(catalogs.dataVersion);
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
