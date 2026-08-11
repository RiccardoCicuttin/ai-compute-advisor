import { z } from "zod";
import {
  BrowserLibraryArtificialAnalysisSectionSchema,
  BrowserLibraryModelsSectionSchema,
  BrowserLibrarySystemsSectionSchema,
  type ArtificialAnalysisComparisonLibrary,
} from "../data/schemas";
import type { LocalDesktopSystemLibrary } from "./localDesktopSystemLibrary";
import type { LocalModelLibrary } from "./localModelLibrary";

export const BROWSER_LIBRARY_PACK_MAX_BYTES = 4 * 1024 * 1024;

export const BrowserLibraryPackSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("ai-compute-advisor-browser-library"),
  exportedAt: z.iso.datetime(),
  models: BrowserLibraryModelsSectionSchema,
  systems: BrowserLibrarySystemsSectionSchema,
  artificialAnalysis: BrowserLibraryArtificialAnalysisSectionSchema.optional(),
});

export type BrowserLibraryPack = z.infer<typeof BrowserLibraryPackSchema>;

export type BrowserLibraryPackErrorCode =
  | "too-large"
  | "invalid-json"
  | "invalid-pack"
  | "browser-unavailable";

export class BrowserLibraryPackError extends Error {
  readonly code: BrowserLibraryPackErrorCode;

  constructor(
    code: BrowserLibraryPackErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BrowserLibraryPackError";
    this.code = code;
  }
}

function isoTimestamp(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Browser Library Pack timestamp must be valid.");
  }
  return date.toISOString();
}

function resolveMaxBytes(maxBytes = BROWSER_LIBRARY_PACK_MAX_BYTES): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Browser Library Pack maxBytes must be a positive safe integer.");
  }
  return maxBytes;
}

function assertSize(value: string, maxBytes?: number): void {
  const limit = resolveMaxBytes(maxBytes);
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > limit) {
    throw new BrowserLibraryPackError(
      "too-large",
      `Browser Library Pack is ${bytes.toLocaleString("en-US")} bytes; the limit is ${limit.toLocaleString("en-US")} bytes.`,
    );
  }
}

export function createBrowserLibraryPack(
  models: LocalModelLibrary,
  systems: LocalDesktopSystemLibrary,
  exportedAt: Date | string = new Date(),
  artificialAnalysis?: ArtificialAnalysisComparisonLibrary,
): BrowserLibraryPack {
  return BrowserLibraryPackSchema.parse({
    schemaVersion: 1,
    kind: "ai-compute-advisor-browser-library",
    exportedAt: isoTimestamp(exportedAt),
    models: {
      sectionSchemaVersion: 1,
      kind: "browser-local-model-library",
      library: models,
    },
    systems: {
      sectionSchemaVersion: 1,
      kind: "browser-local-desktop-system-library",
      library: systems,
    },
    ...(artificialAnalysis
      ? {
          artificialAnalysis: {
            sectionSchemaVersion: 1,
            kind: "artificial-analysis-comparison-library",
            library: artificialAnalysis,
          },
        }
      : {}),
  });
}

export function serializeBrowserLibraryPack(
  pack: BrowserLibraryPack,
  options: { pretty?: boolean; maxBytes?: number } = {},
): string {
  const parsed = BrowserLibraryPackSchema.parse(pack);
  const json = options.pretty === false
    ? JSON.stringify(parsed)
    : `${JSON.stringify(parsed, null, 2)}\n`;
  assertSize(json, options.maxBytes);
  return json;
}

export function parseBrowserLibraryPackJson(
  json: string,
  options: { maxBytes?: number } = {},
): BrowserLibraryPack {
  assertSize(json, options.maxBytes);
  let decoded: unknown;
  try {
    decoded = JSON.parse(json) as unknown;
  } catch (cause) {
    throw new BrowserLibraryPackError(
      "invalid-json",
      "Browser Library Pack is not valid JSON.",
      { cause },
    );
  }
  const parsed = BrowserLibraryPackSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new BrowserLibraryPackError(
      "invalid-pack",
      parsed.error.issues[0]?.message ?? "Browser Library Pack is invalid.",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export async function parseBrowserLibraryPackFile(
  file: File,
  options: { maxBytes?: number } = {},
): Promise<BrowserLibraryPack> {
  const maxBytes = resolveMaxBytes(options.maxBytes);
  if (file.size > maxBytes) {
    throw new BrowserLibraryPackError(
      "too-large",
      `Browser Library Pack exceeds the ${maxBytes.toLocaleString("en-US")} byte limit.`,
    );
  }
  return parseBrowserLibraryPackJson(await file.text(), { maxBytes });
}

export function getBrowserLibraryPackFilename(exportedAt = new Date()): string {
  const date = exportedAt.toISOString().slice(0, 10);
  return `ai-compute-advisor-browser-library-${date}.json`;
}

export function downloadBrowserLibraryPack(pack: BrowserLibraryPack): void {
  if (
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    throw new BrowserLibraryPackError(
      "browser-unavailable",
      "Browser Library Pack download requires a browser document.",
    );
  }
  const blob = new Blob([serializeBrowserLibraryPack(pack)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = getBrowserLibraryPackFilename(new Date(pack.exportedAt));
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
