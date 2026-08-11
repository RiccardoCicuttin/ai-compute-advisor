import { describe, expect, it } from "vitest";
import {
  LOCALE_STORAGE_KEY,
  detectPreferredLocale,
  interpolate,
  readLocalePreference,
  translate,
  writeLocalePreference,
  type LocaleStorage,
} from ".";

function createMemoryStorage(initial?: Record<string, string>): LocaleStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("i18n", () => {
  it("translates and interpolates parameters", () => {
    expect(translate("en", "common.version", { version: "2026.08" })).toBe(
      "Version 2026.08",
    );
    expect(
      translate("zh-CN", "transparency.activeWarnings", { count: 3 }),
    ).toBe("3 项");
    expect(
      translate("zh-CN", "workload.peakContextAutoRaised", {
        value: "32,768",
      }),
    ).toContain("32,768 Token / 次调用");
  });

  it("distinguishes per-call context from monthly token demand in both locales", () => {
    expect(translate("en", "workload.contextTokensPerCall")).toBe(
      "tokens / call",
    );
    expect(translate("zh-CN", "workload.contextTokensPerCall")).toBe(
      "Token / 次",
    );
    expect(translate("en", "workload.tokensPerMonth")).toBe(
      "tokens / month",
    );
    expect(translate("zh-CN", "workload.tokensPerMonth")).toBe("Token / 月");
    expect(translate("en", "workload.monthlyFormula")).toContain(
      "Monthly requests × average agent steps",
    );
    expect(translate("zh-CN", "workload.monthlyFormula")).toContain(
      "每月请求数 × 平均 Agent 步骤",
    );
  });

  it("preserves placeholders that have no supplied value", () => {
    expect(interpolate("{known} / {missing}", { known: "value" })).toBe(
      "value / {missing}",
    );
  });

  it("persists only supported locale preferences", () => {
    const storage = createMemoryStorage();
    writeLocalePreference("zh-CN", storage);
    expect(storage.values.get(LOCALE_STORAGE_KEY)).toBe("zh-CN");
    expect(readLocalePreference(storage)).toBe("zh-CN");

    storage.values.set(LOCALE_STORAGE_KEY, "fr");
    expect(readLocalePreference(storage)).toBeNull();
  });

  it("detects Chinese browser locales and otherwise defaults to English", () => {
    expect(detectPreferredLocale(["zh-Hans-CN", "en-US"])).toBe("zh-CN");
    expect(detectPreferredLocale(["en-US", "de-DE"])).toBe("en");
  });
});
