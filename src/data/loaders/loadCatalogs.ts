import { z } from "zod";
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
} from "../schemas";
import type {
  CatalogKey,
  DataManifest,
  NormalizedCatalogs,
  RawCatalogBundle,
} from "../../types";
import {
  validateCatalogRelationships,
  type CatalogValidationIssue,
} from "../validators";

export interface CatalogLoadIssue {
  stage: "fetch" | "parse" | "schema" | "integrity";
  catalog?: CatalogKey | "manifest";
  url?: string;
  path?: string;
  message: string;
}

export class CatalogLoadError extends Error {
  readonly issues: CatalogLoadIssue[];

  constructor(issues: CatalogLoadIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
    this.name = "CatalogLoadError";
    this.issues = issues;
  }
}

export interface LoadCatalogsOptions {
  baseUrl?: string | URL;
  manifestPath?: string;
  fetcher?: typeof fetch;
}

const CATALOG_KEYS: CatalogKey[] = [
  "models",
  "modelBenchmarks",
  "gpus",
  "inferenceProfiles",
  "cloudPricing",
  "assumptions",
  "presets",
  "systems",
  "exchangeRates",
];

const CATALOG_SCHEMAS: Record<CatalogKey, z.ZodType> = {
  models: ModelsCatalogSchema,
  modelBenchmarks: ModelBenchmarksCatalogSchema,
  gpus: GpusCatalogSchema,
  inferenceProfiles: InferenceProfilesCatalogSchema,
  cloudPricing: CloudPricingCatalogSchema,
  assumptions: AssumptionsCatalogSchema,
  presets: PresetsCatalogSchema,
  systems: DesktopSystemsCatalogSchema,
  exchangeRates: ExchangeRateCatalogSchema,
};

function defaultBaseUrl(): URL {
  if (typeof document !== "undefined") return new URL(document.baseURI);
  return new URL("http://localhost/");
}

async function fetchJson(
  url: URL,
  fetcher: typeof fetch,
  catalog: CatalogKey | "manifest",
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: "application/json" },
      cache: "no-cache",
    });
  } catch (error) {
    throw new CatalogLoadError([
      {
        stage: "fetch",
        catalog,
        url: url.toString(),
        message: `Could not load ${catalog} from ${url.toString()}: ${error instanceof Error ? error.message : "network error"}`,
      },
    ]);
  }

  if (!response.ok) {
    throw new CatalogLoadError([
      {
        stage: "fetch",
        catalog,
        url: url.toString(),
        message: `Could not load ${catalog}: HTTP ${response.status} ${response.statusText}.`,
      },
    ]);
  }

  try {
    return await response.json();
  } catch (error) {
    throw new CatalogLoadError([
      {
        stage: "parse",
        catalog,
        url: url.toString(),
        message: `Could not parse ${catalog} as JSON: ${error instanceof Error ? error.message : "invalid JSON"}`,
      },
    ]);
  }
}

function zodIssues(
  error: z.ZodError,
  knownCatalog?: CatalogKey | "manifest",
): CatalogLoadIssue[] {
  return error.issues.map((issue) => {
    const [first, ...rest] = issue.path;
    const inferredCatalog =
      typeof first === "string" &&
      (["manifest", ...CATALOG_KEYS] as string[]).includes(first)
        ? (first as CatalogKey | "manifest")
        : undefined;
    const catalog = knownCatalog ?? inferredCatalog;
    const issuePath = inferredCatalog && !knownCatalog ? rest : issue.path;
    return {
      stage: "schema" as const,
      ...(catalog ? { catalog } : {}),
      path: issuePath.map(String).join("."),
      message: `${catalog ?? "catalog"}${issue.path.length ? ` at ${issue.path.map(String).join(".")}` : ""}: ${issue.message}`,
    };
  });
}

function integrityIssues(
  issues: CatalogValidationIssue[],
): CatalogLoadIssue[] {
  return issues.map((issue) => ({
    stage: "integrity",
    catalog: issue.catalog,
    path: issue.path,
    message: issue.message,
  }));
}

export async function loadCatalogs(
  options: LoadCatalogsOptions = {},
): Promise<NormalizedCatalogs> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) {
    throw new CatalogLoadError([
      { stage: "fetch", message: "This environment does not provide fetch()." },
    ]);
  }

  const baseUrl = new URL(options.baseUrl ?? defaultBaseUrl());
  const manifestUrl = new URL(options.manifestPath ?? "data/manifest.json", baseUrl);
  const rawManifest = await fetchJson(manifestUrl, fetcher, "manifest");

  const parsedManifest = DataManifestSchema.safeParse(rawManifest);
  if (!parsedManifest.success) {
    throw new CatalogLoadError(zodIssues(parsedManifest.error));
  }

  const manifest: DataManifest = parsedManifest.data;
  const entries = await Promise.all(
    CATALOG_KEYS.map(async (key) => {
      const url = new URL(manifest.catalogs[key], manifestUrl);
      return [key, await fetchJson(url, fetcher, key)] as const;
    }),
  );
  const schemaIssues = entries.flatMap(([key, value]) => {
    const parsed = CATALOG_SCHEMAS[key].safeParse(value);
    return parsed.success ? [] : zodIssues(parsed.error, key);
  });
  if (schemaIssues.length > 0) throw new CatalogLoadError(schemaIssues);

  const loaded = Object.fromEntries(entries) as Omit<RawCatalogBundle, "manifest">;
  const rawBundle: RawCatalogBundle = { manifest: rawManifest, ...loaded };

  let catalogs: NormalizedCatalogs;
  try {
    catalogs = parseCatalogBundle(rawBundle);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new CatalogLoadError(zodIssues(error));
    }
    if (error instanceof CatalogIntegrityError) {
      throw new CatalogLoadError(
        error.issues.map((message) => ({ stage: "integrity", message })),
      );
    }
    throw error;
  }

  const relationshipIssues = validateCatalogRelationships(catalogs).filter(
    (issue) => issue.severity === "error",
  );
  if (relationshipIssues.length > 0) {
    throw new CatalogLoadError(integrityIssues(relationshipIssues));
  }

  return catalogs;
}

let bundledCatalogPromise: Promise<NormalizedCatalogs> | null = null;

export function loadBundledCatalogs(): Promise<NormalizedCatalogs> {
  bundledCatalogPromise ??= loadCatalogs();
  return bundledCatalogPromise;
}

export function resetBundledCatalogCache(): void {
  bundledCatalogPromise = null;
}
