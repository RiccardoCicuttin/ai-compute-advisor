import { z } from "zod";
import { AdvisorConfigSchema } from "../data/schemas";
import type { AdvisorConfig } from "../types";

export const LAST_SCENARIO_STORAGE_KEY = "aca:v1:last-scenario";
export const PREFERENCES_STORAGE_KEY = "aca:v1:preferences";

export interface AdvisorPreferences {
  calculationDetailsOpen?: boolean;
  dataStatusOpen?: boolean;
  dismissedWarnings?: string[];
}

export interface StorageStateIssue {
  source: "storage";
  key: string;
  code: "unavailable" | "invalid-json" | "invalid-value" | "write-failed";
  message: string;
}

export interface StorageReadResult<T> {
  value: T | null;
  issue: StorageStateIssue | null;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const StoredAdvisorConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  updatedAt: z.iso.datetime(),
  payload: AdvisorConfigSchema,
});

const AdvisorPreferencesSchema = z.strictObject({
  calculationDetailsOpen: z.boolean().optional(),
  dataStatusOpen: z.boolean().optional(),
  dismissedWarnings: z.array(z.string()).optional(),
});

const StoredPreferencesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  updatedAt: z.iso.datetime(),
  payload: AdvisorPreferencesSchema,
});

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStored<T>(
  key: string,
  schema: z.ZodType<{ payload: T }>,
  storage: StorageLike | null,
): StorageReadResult<T> {
  if (!storage) {
    return {
      value: null,
      issue: {
        source: "storage",
        key,
        code: "unavailable",
        message: "Browser storage is unavailable; this scenario will not persist.",
      },
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return {
      value: null,
      issue: {
        source: "storage",
        key,
        code: "unavailable",
        message: "Browser storage could not be read.",
      },
    };
  }

  if (raw === null) return { value: null, issue: null };

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return {
      value: null,
      issue: {
        source: "storage",
        key,
        code: "invalid-json",
        message: "Ignored a corrupt locally saved value.",
      },
    };
  }

  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    return {
      value: null,
      issue: {
        source: "storage",
        key,
        code: "invalid-value",
        message: "Ignored an incompatible locally saved value.",
      },
    };
  }

  return { value: parsed.data.payload, issue: null };
}

function writeStored<T>(
  key: string,
  payload: T,
  storage: StorageLike | null,
): StorageStateIssue | null {
  if (!storage) {
    return {
      source: "storage",
      key,
      code: "unavailable",
      message: "Browser storage is unavailable; this scenario will not persist.",
    };
  }

  try {
    storage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        payload,
      }),
    );
    return null;
  } catch {
    return {
      source: "storage",
      key,
      code: "write-failed",
      message: "The latest changes could not be saved in this browser.",
    };
  }
}

export function readLastScenario(
  storage: StorageLike | null = browserStorage(),
): StorageReadResult<AdvisorConfig> {
  return readStored(LAST_SCENARIO_STORAGE_KEY, StoredAdvisorConfigSchema, storage);
}

export function writeLastScenario(
  config: AdvisorConfig,
  storage: StorageLike | null = browserStorage(),
): StorageStateIssue | null {
  const parsed = AdvisorConfigSchema.parse(config);
  return writeStored(LAST_SCENARIO_STORAGE_KEY, parsed, storage);
}

export function readAdvisorPreferences(
  storage: StorageLike | null = browserStorage(),
): StorageReadResult<AdvisorPreferences> {
  return readStored(PREFERENCES_STORAGE_KEY, StoredPreferencesSchema, storage);
}

export function writeAdvisorPreferences(
  preferences: AdvisorPreferences,
  storage: StorageLike | null = browserStorage(),
): StorageStateIssue | null {
  const parsed = AdvisorPreferencesSchema.parse(preferences);
  return writeStored(PREFERENCES_STORAGE_KEY, parsed, storage);
}

export function clearAdvisorStorage(
  storage: StorageLike | null = browserStorage(),
): StorageStateIssue | null {
  if (!storage) {
    return {
      source: "storage",
      key: LAST_SCENARIO_STORAGE_KEY,
      code: "unavailable",
      message: "Browser storage is unavailable.",
    };
  }

  try {
    storage.removeItem(LAST_SCENARIO_STORAGE_KEY);
    storage.removeItem(PREFERENCES_STORAGE_KEY);
    return null;
  } catch {
    return {
      source: "storage",
      key: LAST_SCENARIO_STORAGE_KEY,
      code: "write-failed",
      message: "Saved browser state could not be cleared.",
    };
  }
}
