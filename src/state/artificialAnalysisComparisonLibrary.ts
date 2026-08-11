import { z } from "zod";
import {
  adaptArtificialAnalysisModelsSnapshot,
  type AdaptArtificialAnalysisSnapshotOptions,
} from "../data/adapters";
import {
  ARTIFICIAL_ANALYSIS_COMPARISON_ID_PREFIX,
  ArtificialAnalysisComparisonLibrarySchema,
  ArtificialAnalysisComparisonRecordSchema,
  BrowserLibraryArtificialAnalysisSectionSchema,
  type ArtificialAnalysisComparisonLibrary,
  type ArtificialAnalysisComparisonRecord,
  type BrowserLibraryArtificialAnalysisSection,
} from "../data/schemas";

export const ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY =
  "aca:v1:artificial-analysis-comparison-library";
export const ARTIFICIAL_ANALYSIS_COMPARISON_MAX_BYTES = 4 * 1024 * 1024;

export type ArtificialAnalysisComparisonStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export interface ArtificialAnalysisComparisonJsonOptions {
  maxBytes?: number;
  pretty?: boolean;
}

export type ArtificialAnalysisComparisonLibraryErrorCode =
  | "too-large"
  | "invalid-json"
  | "invalid-value"
  | "record-not-found"
  | "storage-unavailable"
  | "storage-write-failed";

export class ArtificialAnalysisComparisonLibraryError extends Error {
  readonly code: ArtificialAnalysisComparisonLibraryErrorCode;

  constructor(
    code: ArtificialAnalysisComparisonLibraryErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ArtificialAnalysisComparisonLibraryError";
    this.code = code;
  }
}

export interface ArtificialAnalysisComparisonStorageIssue {
  source: "artificial-analysis-comparison-library";
  key: typeof ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY;
  code: "unavailable" | "invalid-json" | "invalid-value" | "write-failed";
  message: string;
}

export interface ArtificialAnalysisComparisonReadResult {
  library: ArtificialAnalysisComparisonLibrary;
  issue: ArtificialAnalysisComparisonStorageIssue | null;
}

function browserStorage(): ArtificialAnalysisComparisonStorage | null {
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
    throw new RangeError("Artificial Analysis library timestamp must be a valid date.");
  }
  return date.toISOString();
}

function assertJsonSize(
  json: string,
  options: ArtificialAnalysisComparisonJsonOptions,
): void {
  const maxBytes = options.maxBytes ?? ARTIFICIAL_ANALYSIS_COMPARISON_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Artificial Analysis maxBytes must be a positive safe integer.");
  }
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > maxBytes) {
    throw new ArtificialAnalysisComparisonLibraryError(
      "too-large",
      `Artificial Analysis JSON is ${bytes.toLocaleString("en-US")} bytes; the limit is ${maxBytes.toLocaleString("en-US")} bytes.`,
    );
  }
}

function decodeJson(
  json: string,
  options: ArtificialAnalysisComparisonJsonOptions,
): unknown {
  assertJsonSize(json, options);
  try {
    return JSON.parse(json) as unknown;
  } catch (cause) {
    throw new ArtificialAnalysisComparisonLibraryError(
      "invalid-json",
      "Artificial Analysis data is not valid JSON.",
      { cause },
    );
  }
}

export function createEmptyArtificialAnalysisComparisonLibrary(
  updatedAt: Date | string,
): ArtificialAnalysisComparisonLibrary {
  return {
    schemaVersion: 1,
    updatedAt: isoTimestamp(updatedAt),
    records: [],
  };
}

/** Imports a saved authenticated API response. It never makes a network request. */
export function parseArtificialAnalysisSnapshotJson(
  json: string,
  adapterOptions: AdaptArtificialAnalysisSnapshotOptions,
  jsonOptions: ArtificialAnalysisComparisonJsonOptions = {},
): ArtificialAnalysisComparisonRecord[] {
  const decoded = decodeJson(json, jsonOptions);
  try {
    return adaptArtificialAnalysisModelsSnapshot(decoded, adapterOptions);
  } catch (cause) {
    throw new ArtificialAnalysisComparisonLibraryError(
      "invalid-value",
      cause instanceof z.ZodError
        ? cause.issues[0]?.message ?? "Artificial Analysis snapshot is invalid."
        : "Artificial Analysis snapshot is invalid.",
      { cause },
    );
  }
}

export function replaceArtificialAnalysisComparisonLibrary(
  records: ArtificialAnalysisComparisonRecord[],
  updatedAt: Date | string,
): ArtificialAnalysisComparisonLibrary {
  return ArtificialAnalysisComparisonLibrarySchema.parse({
    schemaVersion: 1,
    updatedAt: isoTimestamp(updatedAt),
    records,
  });
}

/** Inserts new external IDs and replaces existing external IDs atomically. */
export function upsertArtificialAnalysisComparisonRecords(
  library: ArtificialAnalysisComparisonLibrary,
  records: ArtificialAnalysisComparisonRecord[],
  updatedAt: Date | string,
): ArtificialAnalysisComparisonLibrary {
  const current = ArtificialAnalysisComparisonLibrarySchema.parse(library);
  const incoming = records.map((record) =>
    ArtificialAnalysisComparisonRecordSchema.parse(record),
  );
  const byExternalId = new Map(
    current.records.map((record) => [record.externalId, record]),
  );
  for (const record of incoming) byExternalId.set(record.externalId, record);
  return replaceArtificialAnalysisComparisonLibrary(
    [...byExternalId.values()],
    updatedAt,
  );
}

export function deleteArtificialAnalysisComparisonRecord(
  library: ArtificialAnalysisComparisonLibrary,
  recordId: string,
  updatedAt: Date | string,
): ArtificialAnalysisComparisonLibrary {
  const current = ArtificialAnalysisComparisonLibrarySchema.parse(library);
  if (!recordId.startsWith(ARTIFICIAL_ANALYSIS_COMPARISON_ID_PREFIX)) {
    return current;
  }
  const records = current.records.filter((record) => record.id !== recordId);
  if (records.length === current.records.length) {
    throw new ArtificialAnalysisComparisonLibraryError(
      "record-not-found",
      `Artificial Analysis comparison record '${recordId}' was not found.`,
    );
  }
  return replaceArtificialAnalysisComparisonLibrary(records, updatedAt);
}

export function clearArtificialAnalysisComparisonLibrary(
  updatedAt: Date | string,
): ArtificialAnalysisComparisonLibrary {
  return createEmptyArtificialAnalysisComparisonLibrary(updatedAt);
}

export function parseArtificialAnalysisComparisonLibraryJson(
  json: string,
  options: ArtificialAnalysisComparisonJsonOptions = {},
): ArtificialAnalysisComparisonLibrary {
  const decoded = decodeJson(json, options);
  const parsed = ArtificialAnalysisComparisonLibrarySchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ArtificialAnalysisComparisonLibraryError(
      "invalid-value",
      parsed.error.issues[0]?.message ??
        "Artificial Analysis comparison library is invalid.",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export function serializeArtificialAnalysisComparisonLibrary(
  library: ArtificialAnalysisComparisonLibrary,
  options: ArtificialAnalysisComparisonJsonOptions = {},
): string {
  const parsed = ArtificialAnalysisComparisonLibrarySchema.parse(library);
  const json =
    options.pretty === false
      ? JSON.stringify(parsed)
      : `${JSON.stringify(parsed, null, 2)}\n`;
  assertJsonSize(json, options);
  return json;
}

export function createBrowserLibraryArtificialAnalysisSection(
  library: ArtificialAnalysisComparisonLibrary,
): BrowserLibraryArtificialAnalysisSection {
  return BrowserLibraryArtificialAnalysisSectionSchema.parse({
    sectionSchemaVersion: 1,
    kind: "artificial-analysis-comparison-library",
    library,
  });
}

export function parseBrowserLibraryArtificialAnalysisSection(
  input: unknown,
): BrowserLibraryArtificialAnalysisSection {
  return BrowserLibraryArtificialAnalysisSectionSchema.parse(input);
}

export function readArtificialAnalysisComparisonLibrary(
  storage: ArtificialAnalysisComparisonStorage | null = browserStorage(),
): ArtificialAnalysisComparisonReadResult {
  const empty = createEmptyArtificialAnalysisComparisonLibrary(
    "1970-01-01T00:00:00.000Z",
  );
  if (!storage) {
    return {
      library: empty,
      issue: {
        source: "artificial-analysis-comparison-library",
        key: ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY,
        code: "unavailable",
        message: "Browser storage is unavailable; comparison data cannot persist.",
      },
    };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY);
  } catch {
    return {
      library: empty,
      issue: {
        source: "artificial-analysis-comparison-library",
        key: ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY,
        code: "unavailable",
        message: "The browser-local comparison library could not be read.",
      },
    };
  }
  if (raw === null) return { library: empty, issue: null };
  try {
    return {
      library: parseArtificialAnalysisComparisonLibraryJson(raw),
      issue: null,
    };
  } catch (error) {
    const code =
      error instanceof ArtificialAnalysisComparisonLibraryError &&
      error.code === "invalid-json"
        ? "invalid-json"
        : "invalid-value";
    return {
      library: empty,
      issue: {
        source: "artificial-analysis-comparison-library",
        key: ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY,
        code,
        message: "Stored Artificial Analysis comparison data was invalid and was ignored.",
      },
    };
  }
}

export function writeArtificialAnalysisComparisonLibrary(
  library: ArtificialAnalysisComparisonLibrary,
  storage: ArtificialAnalysisComparisonStorage | null = browserStorage(),
): ArtificialAnalysisComparisonStorageIssue | null {
  if (!storage) {
    return {
      source: "artificial-analysis-comparison-library",
      key: ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY,
      code: "unavailable",
      message: "Browser storage is unavailable; comparison data was not saved.",
    };
  }
  try {
    storage.setItem(
      ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY,
      serializeArtificialAnalysisComparisonLibrary(library, { pretty: false }),
    );
    return null;
  } catch {
    return {
      source: "artificial-analysis-comparison-library",
      key: ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY,
      code: "write-failed",
      message: "Artificial Analysis comparison data could not be saved.",
    };
  }
}

export function clearStoredArtificialAnalysisComparisonLibrary(
  storage: ArtificialAnalysisComparisonStorage | null = browserStorage(),
): ArtificialAnalysisComparisonStorageIssue | null {
  if (!storage) {
    return {
      source: "artificial-analysis-comparison-library",
      key: ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY,
      code: "unavailable",
      message: "Browser storage is unavailable; comparison data could not be cleared.",
    };
  }
  try {
    storage.removeItem(ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY);
    return null;
  } catch {
    return {
      source: "artificial-analysis-comparison-library",
      key: ARTIFICIAL_ANALYSIS_COMPARISON_STORAGE_KEY,
      code: "write-failed",
      message: "Artificial Analysis comparison data could not be cleared.",
    };
  }
}
