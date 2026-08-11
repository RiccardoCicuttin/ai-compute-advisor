import {
  BrowserLibrarySystemsSectionSchema,
  CustomDesktopSystemDraftSchema,
  LOCAL_DESKTOP_SYSTEM_ID_PREFIX,
  LocalDesktopSystemLibrarySchema,
  LocalDesktopSystemRecordSchema,
  type LocalDesktopSystemLibrary,
  type LocalDesktopSystemRecord,
  type BrowserLibrarySystemsSection,
} from "../data/schemas";
import type { DesktopSystemRecord } from "../systems";
import type { CustomDesktopSystemDraft, ModelRecord } from "../types";

export const LOCAL_DESKTOP_SYSTEM_LIBRARY_STORAGE_KEY =
  "aca:v1:local-desktop-system-library";
export const LOCAL_DESKTOP_SYSTEM_LIBRARY_MAX_BYTES = 1_000_000;

export type LocalDesktopSystemLibraryErrorCode =
  | "invalid-id"
  | "duplicate-system"
  | "system-not-found"
  | "catalog-id-conflict"
  | "invalid-json"
  | "invalid-library"
  | "library-too-large"
  | "storage-unavailable"
  | "storage-write-failed";

export class LocalDesktopSystemLibraryError extends Error {
  readonly code: LocalDesktopSystemLibraryErrorCode;

  constructor(
    code: LocalDesktopSystemLibraryErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LocalDesktopSystemLibraryError";
    this.code = code;
  }
}

export interface LocalDesktopSystemDraftIssue {
  code:
    | "invalid-draft"
    | "required"
    | "invalid-relationship"
    | "unknown-model"
    | "unknown-quantization";
  path: string;
  message: string;
}

export type DraftToLocalDesktopSystemResult =
  | { success: true; record: LocalDesktopSystemRecord }
  | { success: false; issues: LocalDesktopSystemDraftIssue[] };

export interface DraftToLocalDesktopSystemOptions {
  /** Active models are required so saved TPS evidence cannot bind to a stale ID. */
  models: readonly ModelRecord[];
  /** Pass the existing record ID while editing so renames do not change identity. */
  id?: string;
  /** Injectable for deterministic tests. The function returns the suffix only. */
  idFactory?: () => string;
  now?: Date | string;
}

export interface LocalDesktopSystemLibraryStorageIssue {
  source: "local-desktop-system-library";
  key: typeof LOCAL_DESKTOP_SYSTEM_LIBRARY_STORAGE_KEY;
  code: "unavailable" | "invalid-json" | "invalid-value";
  message: string;
}

export interface LocalDesktopSystemLibraryReadResult {
  library: LocalDesktopSystemLibrary;
  issue: LocalDesktopSystemLibraryStorageIssue | null;
}

export type LocalDesktopSystemLibraryStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export interface LocalDesktopSystemMutationOptions {
  /** Active Data Pack IDs. A browser-local record may never replace one. */
  reservedSystemIds?: Iterable<string>;
  updatedAt?: Date | string;
}

export type LocalDesktopSystemReconciliationIssueCode =
  | "performance-model-not-in-active-catalog"
  | "performance-quantization-not-in-active-catalog"
  | "system-id-conflicts-with-data-pack";

export interface LocalDesktopSystemReconciliationIssue {
  severity: "warning";
  code: LocalDesktopSystemReconciliationIssueCode;
  systemId: string;
  path: "performance.modelId" | "performance.quantizationId" | "id";
  message: string;
  resolution: "removed-performance-evidence" | "data-pack-system-wins";
}

export interface ReconcileLocalDesktopSystemLibraryResult {
  library: LocalDesktopSystemLibrary;
  issues: LocalDesktopSystemReconciliationIssue[];
  changed: boolean;
}

export interface MergeLocalDesktopSystemLibraryResult
  extends ReconcileLocalDesktopSystemLibraryResult {
  /** Data Pack systems first, followed by non-conflicting browser-local systems. */
  systems: DesktopSystemRecord[];
  activeLocalSystemIds: string[];
}

function browserStorage(): LocalDesktopSystemLibraryStorage | null {
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
    throw new RangeError("Local desktop system library timestamp must be valid.");
  }
  return date.toISOString();
}

function dateOnly(value: Date | string): string {
  return isoTimestamp(value).slice(0, 10);
}

function defaultIdFactory(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const values = new Uint32Array(4);
    globalThis.crypto.getRandomValues(values);
    return [...values].map((value) => value.toString(16).padStart(8, "0")).join("-");
  }
  throw new LocalDesktopSystemLibraryError(
    "invalid-id",
    "This browser cannot generate a stable local system ID.",
  );
}

function normalizedIdSuffix(value: string): string {
  const suffix = value
    .trim()
    .toLowerCase()
    .replace(/^local\.system\./, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (!suffix) {
    throw new LocalDesktopSystemLibraryError(
      "invalid-id",
      "A browser-local system ID must contain at least one ASCII letter or number.",
    );
  }
  return suffix;
}

export function createLocalDesktopSystemId(
  idFactory: () => string = defaultIdFactory,
): string {
  const id = `${LOCAL_DESKTOP_SYSTEM_ID_PREFIX}${normalizedIdSuffix(idFactory())}`;
  if (!/^local\.system\.[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new LocalDesktopSystemLibraryError("invalid-id", `Invalid local system ID '${id}'.`);
  }
  return id;
}

export function createEmptyLocalDesktopSystemLibrary(
  updatedAt: Date | string = new Date(),
): LocalDesktopSystemLibrary {
  return {
    schemaVersion: 1,
    updatedAt: isoTimestamp(updatedAt),
    records: [],
  };
}

function issue(
  issues: LocalDesktopSystemDraftIssue[],
  code: LocalDesktopSystemDraftIssue["code"],
  path: keyof CustomDesktopSystemDraft | "id" | "$",
  message: string,
): void {
  issues.push({ code, path, message });
}

function trimmedRequired(
  value: string,
  path: keyof CustomDesktopSystemDraft,
  message: string,
  issues: LocalDesktopSystemDraftIssue[],
): string {
  const trimmed = value.trim();
  if (!trimmed) issue(issues, "required", path, message);
  return trimmed;
}

function runtimeNames(value: string): string[] {
  return [...new Set(value.split(",").map((name) => name.trim()).filter(Boolean))];
}

function mapSchemaIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): LocalDesktopSystemDraftIssue[] {
  return issues.map((item) => ({
    code: "invalid-draft",
    path: item.path.map(String).join(".") || "$",
    message: item.message,
  }));
}

/**
 * Converts an editable draft into a fully validated, persistent calculator
 * record. Performance is stored only when its model, quantization, context,
 * and concurrency binding is complete and valid. TOPS is never converted to
 * TPS.
 */
export function draftToLocalDesktopSystemRecord(
  input: unknown,
  options: DraftToLocalDesktopSystemOptions,
): DraftToLocalDesktopSystemResult {
  const parsedDraft = CustomDesktopSystemDraftSchema.safeParse(input);
  if (!parsedDraft.success) {
    return { success: false, issues: mapSchemaIssues(parsedDraft.error.issues) };
  }
  const draft = parsedDraft.data;
  const issues: LocalDesktopSystemDraftIssue[] = [];
  const name = trimmedRequired(draft.name, "name", "Enter a system name.", issues);
  const systemMemoryType = trimmedRequired(
    draft.systemMemoryType,
    "systemMemoryType",
    "Enter a system memory type.",
    issues,
  );
  const acceleratorType = trimmedRequired(
    draft.acceleratorType,
    "acceleratorType",
    "Enter an accelerator display label.",
    issues,
  );
  const acceleratorModel = trimmedRequired(
    draft.acceleratorName,
    "acceleratorName",
    "Enter an accelerator name.",
    issues,
  );

  if (draft.systemRamGB === null) {
    issue(issues, "required", "systemRamGB", "Enter installed system memory.");
  }
  if (draft.acceleratorCount === null) {
    issue(issues, "required", "acceleratorCount", "Enter accelerator count.");
  }
  if (draft.memoryBandwidthGBps === null) {
    issue(issues, "required", "memoryBandwidthGBps", "Enter aggregate memory bandwidth.");
  }
  if (draft.idlePowerWatts === null) {
    issue(issues, "required", "idlePowerWatts", "Enter whole-system idle power.");
  }
  if (draft.loadPowerWatts === null) {
    issue(issues, "required", "loadPowerWatts", "Enter whole-system load power.");
  }
  if (draft.purchasePriceUSD === null) {
    issue(issues, "required", "purchasePriceUSD", "Enter whole-system purchase price.");
  }
  if (
    draft.idlePowerWatts !== null &&
    draft.loadPowerWatts !== null &&
    draft.loadPowerWatts < draft.idlePowerWatts
  ) {
    issue(
      issues,
      "invalid-relationship",
      "loadPowerWatts",
      "Load power cannot be below idle power.",
    );
  }
  if (draft.memoryArchitecture === "dedicated") {
    if (draft.dedicatedMemoryPerUnitGB === null) {
      issue(
        issues,
        "required",
        "dedicatedMemoryPerUnitGB",
        "Enter dedicated memory per accelerator.",
      );
    }
  } else {
    if (draft.allocatableUnifiedMemoryGB === null) {
      issue(
        issues,
        "required",
        "allocatableUnifiedMemoryGB",
        "Enter allocatable unified memory.",
      );
    } else if (
      draft.systemRamGB !== null &&
      draft.allocatableUnifiedMemoryGB > draft.systemRamGB
    ) {
      issue(
        issues,
        "invalid-relationship",
        "allocatableUnifiedMemoryGB",
        "Allocatable memory cannot exceed installed system memory.",
      );
    }
  }

  const runtimes = runtimeNames(draft.runtimeNames);
  if (draft.runtimeSupportStatus === "supported" && runtimes.length === 0) {
    issue(
      issues,
      "required",
      "runtimeNames",
      "Name the runtime or framework that confirms support.",
    );
  }
  if (draft.tops !== null && !draft.topsPrecision.trim()) {
    issue(
      issues,
      "required",
      "topsPrecision",
      "Enter the precision used for the TOPS rating.",
    );
  }

  const hasPerformance =
    draft.effectiveTokensPerSecond !== null ||
    draft.timeToFirstTokenSeconds !== null;
  if (hasPerformance) {
    if (draft.performanceModelId === null) {
      issue(
        issues,
        "required",
        "performanceModelId",
        "Bind the observation to a model.",
      );
    }
    if (draft.performanceQuantizationId === null) {
      issue(
        issues,
        "required",
        "performanceQuantizationId",
        "Bind the observation to a quantization.",
      );
    }
    if (draft.performanceContextTokens === null) {
      issue(
        issues,
        "required",
        "performanceContextTokens",
        "Bind the observation to a context length.",
      );
    }
    if (draft.performanceConcurrency === null) {
      issue(
        issues,
        "required",
        "performanceConcurrency",
        "Bind the observation to a concurrency value.",
      );
    }

    const model = options.models.find(
      (candidate) => candidate.id === draft.performanceModelId,
    );
    if (draft.performanceModelId !== null && !model) {
      issue(
        issues,
        "unknown-model",
        "performanceModelId",
        `Model '${draft.performanceModelId}' is not in the active catalogs.`,
      );
    } else if (
      model &&
      draft.performanceQuantizationId !== null &&
      !model.quantizations.some(
        (quantization) => quantization.id === draft.performanceQuantizationId,
      )
    ) {
      issue(
        issues,
        "unknown-quantization",
        "performanceQuantizationId",
        `Quantization '${draft.performanceQuantizationId}' is not defined for model '${model.id}'.`,
      );
    }
  }

  let id: string;
  try {
    id = options.id ?? createLocalDesktopSystemId(options.idFactory);
  } catch (error) {
    issue(
      issues,
      "invalid-draft",
      "id",
      error instanceof Error ? error.message : "Could not create a stable system ID.",
    );
    id = `${LOCAL_DESKTOP_SYSTEM_ID_PREFIX}invalid`;
  }

  let lastUpdated: string;
  try {
    lastUpdated = dateOnly(options.now ?? new Date());
  } catch (error) {
    issue(
      issues,
      "invalid-draft",
      "$",
      error instanceof Error ? error.message : "Invalid observation date.",
    );
    lastUpdated = "1970-01-01";
  }

  if (issues.length > 0) return { success: false, issues };

  const common = {
    id,
    name,
    vendor: "Custom",
    acceleratorType,
    acceleratorBehaviorCategory: draft.acceleratorBehaviorCategory,
    acceleratorModel,
    acceleratorCount: draft.acceleratorCount!,
    supportsModelSharding: draft.supportsModelSharding,
    systemMemoryType,
    systemMemoryGB: draft.systemRamGB!,
    memoryBandwidthGBps: draft.memoryBandwidthGBps!,
    interconnect:
      draft.memoryArchitecture === "unified"
        ? ("unified" as const)
        : ("pcie" as const),
    systemIdleWatts: draft.idlePowerWatts!,
    systemLoadWatts: draft.loadPowerWatts!,
    purchasePriceUSD: draft.purchasePriceUSD!,
    ...(draft.tops === null
      ? {}
      : {
          peakTops: {
            value: draft.tops,
            precision: draft.topsPrecision.trim(),
          },
        }),
    runtimeSupport: {
      status: draft.runtimeSupportStatus,
      runtimes,
      method: draft.runtimeSupportMethod,
      notes: "Browser-local user input; verify runtime compatibility before deployment.",
    },
    ...(hasPerformance
      ? {
          performance: {
            modelId: draft.performanceModelId!,
            quantizationId: draft.performanceQuantizationId!,
            contextTokens: draft.performanceContextTokens!,
            concurrency: draft.performanceConcurrency!,
            ...(draft.effectiveTokensPerSecond === null
              ? {}
              : { effectiveTokensPerSecond: draft.effectiveTokensPerSecond }),
            ...(draft.timeToFirstTokenSeconds === null
              ? {}
              : { timeToFirstTokenSeconds: draft.timeToFirstTokenSeconds }),
            method: "estimated" as const,
            notes:
              "User-supplied observation bound to the recorded model, quantization, context and concurrency; not derived from TOPS.",
          },
        }
      : {}),
    dataQuality: "directional" as const,
    lastUpdated,
    source: { label: "Browser-local custom system" },
  };
  const candidate =
    draft.memoryArchitecture === "dedicated"
      ? {
          ...common,
          memoryArchitecture: "dedicated" as const,
          dedicatedMemoryGBPerDevice: draft.dedicatedMemoryPerUnitGB!,
        }
      : {
          ...common,
          memoryArchitecture: "unified" as const,
          allocatableUnifiedMemoryGB: draft.allocatableUnifiedMemoryGB!,
        };
  const parsedRecord = LocalDesktopSystemRecordSchema.safeParse(candidate);
  if (!parsedRecord.success) {
    return { success: false, issues: mapSchemaIssues(parsedRecord.error.issues) };
  }
  return { success: true, record: parsedRecord.data };
}

/**
 * Restores every editable calculator field from a browser-local record. The
 * stable ID and record metadata stay outside the draft and must be passed back
 * through `DraftToLocalDesktopSystemOptions.id` when saving an update.
 */
export function systemRecordToDraft(input: unknown): CustomDesktopSystemDraft {
  const record = LocalDesktopSystemRecordSchema.parse(input);
  return CustomDesktopSystemDraftSchema.parse({
    name: record.name,
    memoryArchitecture: record.memoryArchitecture,
    systemMemoryType: record.systemMemoryType,
    systemRamGB: record.systemMemoryGB,
    acceleratorType: record.acceleratorType,
    acceleratorBehaviorCategory: record.acceleratorBehaviorCategory,
    acceleratorName: record.acceleratorModel,
    acceleratorCount: record.acceleratorCount,
    supportsModelSharding: record.supportsModelSharding,
    dedicatedMemoryPerUnitGB:
      record.memoryArchitecture === "dedicated"
        ? record.dedicatedMemoryGBPerDevice
        : null,
    allocatableUnifiedMemoryGB:
      record.memoryArchitecture === "unified"
        ? record.allocatableUnifiedMemoryGB
        : null,
    memoryBandwidthGBps: record.memoryBandwidthGBps,
    idlePowerWatts: record.systemIdleWatts,
    loadPowerWatts: record.systemLoadWatts,
    purchasePriceUSD: record.purchasePriceUSD,
    tops: record.peakTops?.value ?? null,
    topsPrecision: record.peakTops?.precision ?? "mixed",
    effectiveTokensPerSecond:
      record.performance?.effectiveTokensPerSecond ?? null,
    timeToFirstTokenSeconds:
      record.performance?.timeToFirstTokenSeconds ?? null,
    runtimeSupportStatus: record.runtimeSupport.status,
    runtimeSupportMethod: record.runtimeSupport.method,
    runtimeNames: record.runtimeSupport.runtimes.join(", "),
    performanceModelId: record.performance?.modelId ?? null,
    performanceQuantizationId:
      record.performance?.quantizationId ?? null,
    performanceContextTokens: record.performance?.contextTokens ?? null,
    performanceConcurrency: record.performance?.concurrency ?? null,
  });
}

function mutationTimestamp(options: LocalDesktopSystemMutationOptions): string {
  return isoTimestamp(options.updatedAt ?? new Date());
}

function reservedIds(options: LocalDesktopSystemMutationOptions): Set<string> {
  return new Set(options.reservedSystemIds ?? []);
}

export function addLocalDesktopSystem(
  library: LocalDesktopSystemLibrary,
  record: LocalDesktopSystemRecord,
  options: LocalDesktopSystemMutationOptions = {},
): LocalDesktopSystemLibrary {
  const current = LocalDesktopSystemLibrarySchema.parse(library);
  const nextRecord = LocalDesktopSystemRecordSchema.parse(record);
  if (reservedIds(options).has(nextRecord.id)) {
    throw new LocalDesktopSystemLibraryError(
      "catalog-id-conflict",
      `Data Pack system '${nextRecord.id}' wins; the browser-local record was not added.`,
    );
  }
  if (current.records.some((candidate) => candidate.id === nextRecord.id)) {
    throw new LocalDesktopSystemLibraryError(
      "duplicate-system",
      `Browser-local system '${nextRecord.id}' already exists.`,
    );
  }
  return LocalDesktopSystemLibrarySchema.parse({
    ...current,
    updatedAt: mutationTimestamp(options),
    records: [...current.records, nextRecord],
  });
}

export function updateLocalDesktopSystem(
  library: LocalDesktopSystemLibrary,
  record: LocalDesktopSystemRecord,
  options: LocalDesktopSystemMutationOptions = {},
): LocalDesktopSystemLibrary {
  const current = LocalDesktopSystemLibrarySchema.parse(library);
  const nextRecord = LocalDesktopSystemRecordSchema.parse(record);
  if (reservedIds(options).has(nextRecord.id)) {
    throw new LocalDesktopSystemLibraryError(
      "catalog-id-conflict",
      `Data Pack system '${nextRecord.id}' wins; the browser-local record was not updated.`,
    );
  }
  const index = current.records.findIndex((candidate) => candidate.id === nextRecord.id);
  if (index < 0) {
    throw new LocalDesktopSystemLibraryError(
      "system-not-found",
      `Browser-local system '${nextRecord.id}' does not exist.`,
    );
  }
  const records = current.records.map((candidate, candidateIndex) =>
    candidateIndex === index ? nextRecord : candidate,
  );
  return LocalDesktopSystemLibrarySchema.parse({
    ...current,
    updatedAt: mutationTimestamp(options),
    records,
  });
}

export function deleteLocalDesktopSystem(
  library: LocalDesktopSystemLibrary,
  systemId: string,
  options: Pick<LocalDesktopSystemMutationOptions, "updatedAt"> = {},
): LocalDesktopSystemLibrary {
  const current = LocalDesktopSystemLibrarySchema.parse(library);
  if (!systemId.startsWith(LOCAL_DESKTOP_SYSTEM_ID_PREFIX)) return current;
  const records = current.records.filter((record) => record.id !== systemId);
  if (records.length === current.records.length) return current;
  return LocalDesktopSystemLibrarySchema.parse({
    ...current,
    updatedAt: mutationTimestamp(options),
    records,
  });
}

export function clearLocalDesktopSystemLibrary(
  updatedAt: Date | string = new Date(),
): LocalDesktopSystemLibrary {
  return createEmptyLocalDesktopSystemLibrary(updatedAt);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertLibraryJsonSize(json: string, maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Local system library maxBytes must be a positive safe integer.");
  }
  if (byteLength(json) > maxBytes) {
    throw new LocalDesktopSystemLibraryError(
      "library-too-large",
      `Browser-local system library exceeds the ${maxBytes.toLocaleString("en-US")} byte limit.`,
    );
  }
}

export function parseLocalDesktopSystemLibrary(raw: unknown): LocalDesktopSystemLibrary {
  const parsed = LocalDesktopSystemLibrarySchema.safeParse(raw);
  if (!parsed.success) {
    throw new LocalDesktopSystemLibraryError(
      "invalid-library",
      "Browser-local system library schema validation failed.",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export function parseLocalDesktopSystemLibraryJson(
  json: string,
  options: { maxBytes?: number } = {},
): LocalDesktopSystemLibrary {
  assertLibraryJsonSize(
    json,
    options.maxBytes ?? LOCAL_DESKTOP_SYSTEM_LIBRARY_MAX_BYTES,
  );
  let decoded: unknown;
  try {
    decoded = JSON.parse(json) as unknown;
  } catch (cause) {
    throw new LocalDesktopSystemLibraryError(
      "invalid-json",
      "Browser-local system library is not valid JSON.",
      { cause },
    );
  }
  return parseLocalDesktopSystemLibrary(decoded);
}

export function serializeLocalDesktopSystemLibrary(
  library: LocalDesktopSystemLibrary,
  options: { pretty?: boolean; maxBytes?: number } = {},
): string {
  const parsed = LocalDesktopSystemLibrarySchema.parse(library);
  const json = JSON.stringify(parsed, null, options.pretty ? 2 : undefined);
  assertLibraryJsonSize(
    json,
    options.maxBytes ?? LOCAL_DESKTOP_SYSTEM_LIBRARY_MAX_BYTES,
  );
  return json;
}

/** Creates the systems section embedded by a combined Browser Library Pack. */
export function createBrowserLibrarySystemsSection(
  library: LocalDesktopSystemLibrary,
): BrowserLibrarySystemsSection {
  return BrowserLibrarySystemsSectionSchema.parse({
    sectionSchemaVersion: 1,
    kind: "browser-local-desktop-system-library",
    library,
  });
}

/** Parses an extracted combined-pack systems section without extra keys. */
export function parseBrowserLibrarySystemsSection(
  input: unknown,
): BrowserLibrarySystemsSection {
  return BrowserLibrarySystemsSectionSchema.parse(input);
}

export function readLocalDesktopSystemLibrary(
  storage: LocalDesktopSystemLibraryStorage | null = browserStorage(),
): LocalDesktopSystemLibraryReadResult {
  const empty = createEmptyLocalDesktopSystemLibrary("1970-01-01T00:00:00.000Z");
  if (!storage) {
    return {
      library: empty,
      issue: {
        source: "local-desktop-system-library",
        key: LOCAL_DESKTOP_SYSTEM_LIBRARY_STORAGE_KEY,
        code: "unavailable",
        message: "Browser storage is unavailable; local systems cannot persist.",
      },
    };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(LOCAL_DESKTOP_SYSTEM_LIBRARY_STORAGE_KEY);
  } catch {
    return {
      library: empty,
      issue: {
        source: "local-desktop-system-library",
        key: LOCAL_DESKTOP_SYSTEM_LIBRARY_STORAGE_KEY,
        code: "unavailable",
        message: "The browser-local system library could not be read.",
      },
    };
  }
  if (raw === null) return { library: empty, issue: null };
  try {
    return { library: parseLocalDesktopSystemLibraryJson(raw), issue: null };
  } catch (error) {
    return {
      library: empty,
      issue: {
        source: "local-desktop-system-library",
        key: LOCAL_DESKTOP_SYSTEM_LIBRARY_STORAGE_KEY,
        code:
          error instanceof LocalDesktopSystemLibraryError &&
          error.code === "invalid-json"
            ? "invalid-json"
            : "invalid-value",
        message: "Ignored a corrupt or incompatible browser-local system library.",
      },
    };
  }
}

export function writeLocalDesktopSystemLibrary(
  library: LocalDesktopSystemLibrary,
  storage: LocalDesktopSystemLibraryStorage | null = browserStorage(),
): void {
  if (!storage) {
    throw new LocalDesktopSystemLibraryError(
      "storage-unavailable",
      "Browser storage is unavailable.",
    );
  }
  const json = serializeLocalDesktopSystemLibrary(library);
  try {
    storage.setItem(LOCAL_DESKTOP_SYSTEM_LIBRARY_STORAGE_KEY, json);
  } catch (cause) {
    throw new LocalDesktopSystemLibraryError(
      "storage-write-failed",
      "The browser-local system library could not be saved.",
      { cause },
    );
  }
}

export function clearStoredLocalDesktopSystemLibrary(
  storage: LocalDesktopSystemLibraryStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(LOCAL_DESKTOP_SYSTEM_LIBRARY_STORAGE_KEY);
  } catch (cause) {
    throw new LocalDesktopSystemLibraryError(
      "storage-write-failed",
      "The browser-local system library could not be removed.",
      { cause },
    );
  }
}

/**
 * Removes only stale model-bound performance evidence after a Data Pack
 * switch. The physical system, price, power, memory, TOPS, and runtime fields
 * remain available.
 */
export function reconcileLocalDesktopSystemLibrary(
  library: LocalDesktopSystemLibrary,
  models: readonly ModelRecord[],
): ReconcileLocalDesktopSystemLibraryResult {
  const current = LocalDesktopSystemLibrarySchema.parse(library);
  const modelById = new Map(models.map((model) => [model.id, model]));
  const issues: LocalDesktopSystemReconciliationIssue[] = [];
  const records = current.records.map((record) => {
    const performance = record.performance;
    if (!performance) return record;
    const model = modelById.get(performance.modelId);
    if (!model) {
      const { performance: _performance, ...system } = record;
      issues.push({
        severity: "warning",
        code: "performance-model-not-in-active-catalog",
        systemId: record.id,
        path: "performance.modelId",
        message: `Removed performance evidence from '${record.name}' because model '${performance.modelId}' is not in the active catalogs.`,
        resolution: "removed-performance-evidence",
      });
      return system as LocalDesktopSystemRecord;
    }
    if (
      performance.quantizationId &&
      !model.quantizations.some(
        (quantization) => quantization.id === performance.quantizationId,
      )
    ) {
      const { performance: _performance, ...system } = record;
      issues.push({
        severity: "warning",
        code: "performance-quantization-not-in-active-catalog",
        systemId: record.id,
        path: "performance.quantizationId",
        message: `Removed performance evidence from '${record.name}' because quantization '${performance.quantizationId}' is not defined for model '${model.id}'.`,
        resolution: "removed-performance-evidence",
      });
      return system as LocalDesktopSystemRecord;
    }
    return record;
  });
  const reconciled = LocalDesktopSystemLibrarySchema.parse({
    ...current,
    records,
  });
  return { library: reconciled, issues, changed: issues.length > 0 };
}

/**
 * Produces an effective systems array for calculation and UI only. Keep the
 * original Data Pack catalogs for Full Data Pack export; browser-local systems
 * have their own versioned JSON envelope above.
 */
export function mergeLocalDesktopSystemLibrary(
  dataPackSystems: readonly DesktopSystemRecord[],
  library: LocalDesktopSystemLibrary,
  models: readonly ModelRecord[],
): MergeLocalDesktopSystemLibraryResult {
  const reconciled = reconcileLocalDesktopSystemLibrary(library, models);
  const dataPackIds = new Set(dataPackSystems.map((record) => record.id));
  const localSystems: LocalDesktopSystemRecord[] = [];
  const collisionIssues: LocalDesktopSystemReconciliationIssue[] = [];
  for (const record of reconciled.library.records) {
    if (dataPackIds.has(record.id)) {
      collisionIssues.push({
        severity: "warning",
        code: "system-id-conflicts-with-data-pack",
        systemId: record.id,
        path: "id",
        message: `Data Pack system '${record.id}' wins; the browser-local record was not activated.`,
        resolution: "data-pack-system-wins",
      });
      continue;
    }
    localSystems.push(record);
  }
  return {
    ...reconciled,
    issues: [...reconciled.issues, ...collisionIssues],
    systems: [...dataPackSystems, ...localSystems],
    activeLocalSystemIds: localSystems.map((record) => record.id),
  };
}

export type {
  BrowserLibrarySystemsSection,
  LocalDesktopSystemLibrary,
  LocalDesktopSystemRecord,
};
