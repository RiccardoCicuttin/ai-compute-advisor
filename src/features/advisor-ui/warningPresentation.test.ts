import { describe, expect, it } from "vitest";
import { warningLabel } from "./warningPresentation";

describe("warningLabel", () => {
  it("keeps the calculator warning contract unchanged in English", () => {
    const warning =
      "CONFIGURATION_FIRST_REQUIRES_SELECTED_HARDWARE: falling back to workload-first model selection.";

    expect(warningLabel(warning, "en")).toBe(warning);
  });

  it.each([
    [
      "CONFIGURATION_FIRST_REQUIRES_SELECTED_HARDWARE: falling back to workload-first model selection.",
      "配置优先模式需要先选择具体硬件",
    ],
    [
      "CONFIGURATION_FIRST_GPU_RUNTIME_ASSUMED: standalone GPU records do not carry runtime compatibility metadata; runtime support is assumed and must be verified.",
      "运行时兼容性",
    ],
    [
      "CONFIGURATION_FIRST_NO_RUNNABLE_MODEL: no catalog model has sufficient memory and confirmed performance capacity on the selected hardware; falling back to workload-first model selection.",
      "没有目录模型",
    ],
    [
      "CONFIGURATION_FIRST_SELECTION: 'qwen-14b' is the highest capability model with sufficient memory and catalog performance capacity on the selected hardware.",
      "qwen-14b",
    ],
    [
      "MULTI_GPU_EFFICIENCY_MISSING: no exact pcie/3 efficiency is configured; aggregate performance is conservatively held at 1×.",
      "3 卡组合",
    ],
    ["RTX 4090 does not list 3 GPUs as a supported configuration.", "RTX 4090"],
    [
      "The configuration model selection does not meet the peak context requirement.",
      "峰值上下文",
    ],
    [
      "The manual model selection is below the requested capability tier.",
      "低于所需能力层级",
    ],
    [
      "The manual model selection conflicts with the critical privacy requirement.",
      "最高隐私要求",
    ],
    [
      "Peak TOPS is shown as a specification and is never converted into LLM TPS.",
      "绝不会被换算",
    ],
    [
      "Multi-device model sharding is not confirmed, so one device's memory is used for model fit.",
      "模型分片",
    ],
    [
      "No matching local inference profile is available; compute utilization is not estimated.",
      "不估算算力利用率",
    ],
    [
      "Cached input uses the standard input rate because no cached rate is available.",
      "标准输入费率",
    ],
    [
      "Hybrid requires both a feasible local path and cloud processing.",
      "本地路径可行",
    ],
  ])("translates known warnings without changing their source text: %s", (warning, expected) => {
    expect(warningLabel(warning, "zh-CN")).toContain(expected);
  });

  it("leaves unknown warnings visible as an English fallback", () => {
    expect(warningLabel("A future warning.", "zh-CN")).toBe("A future warning.");
  });
});

