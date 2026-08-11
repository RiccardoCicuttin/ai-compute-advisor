import { messages, type Locale, type TranslationKey } from "./messages";

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "ai-compute-advisor.locale";

export type InterpolationValues = Record<string, string | number>;

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh-CN";
}

export function interpolate(
  template: string,
  values: InterpolationValues = {},
): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) =>
    values[key] === undefined ? match : String(values[key]),
  );
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  values?: InterpolationValues,
): string {
  return interpolate(messages[locale][key] ?? messages.en[key], values);
}

export function translateDynamic(
  locale: Locale,
  key: string,
  fallback: string,
  values?: InterpolationValues,
): string {
  const localeMessages = messages[locale] as Record<string, string>;
  const englishMessages = messages.en as Record<string, string>;
  return interpolate(localeMessages[key] ?? englishMessages[key] ?? fallback, values);
}

export function detectPreferredLocale(
  languages: readonly string[] = typeof navigator === "undefined"
    ? []
    : navigator.languages,
): Locale {
  return languages.some((language) => language.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : DEFAULT_LOCALE;
}

function browserStorage(): LocaleStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLocalePreference(
  storage: LocaleStorage | null = browserStorage(),
): Locale | null {
  if (!storage) return null;
  try {
    const stored = storage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeLocalePreference(
  locale: Locale,
  storage: LocaleStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Language switching still works for the current session when storage is blocked.
  }
}
