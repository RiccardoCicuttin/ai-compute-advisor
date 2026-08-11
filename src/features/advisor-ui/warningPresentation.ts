import type { Locale } from "../../i18n";

/**
 * Warning strings are calculator contracts and deliberately remain English.
 * This presentation-only map gives the Chinese UI natural copy without
 * coupling the functional core to the locale layer.
 */
const exactChineseWarnings: Record<string, string> = {
  "CONFIGURATION_FIRST_REQUIRES_SELECTED_HARDWARE: falling back to workload-first model selection.":
    "配置优先模式需要先选择具体硬件；当前已回退为按工作负载选择模型。",
  "CONFIGURATION_FIRST_GPU_RUNTIME_ASSUMED: standalone GPU records do not carry runtime compatibility metadata; runtime support is assumed and must be verified.":
    "配置优先模式下，独立 GPU 记录不包含运行时兼容性信息；当前暂按可支持处理，仍需实际验证。",
  "CONFIGURATION_FIRST_NO_RUNNABLE_MODEL: no catalog model has sufficient memory and confirmed performance capacity on the selected hardware; falling back to workload-first model selection.":
    "配置优先模式下，没有目录模型同时满足所选硬件的内存与已确认性能容量；当前已回退为按工作负载选择模型。",
  "Multi-GPU memory can scale, but inference performance does not scale linearly.":
    "多 GPU 可以扩展可用显存，但推理性能不会随 GPU 数量线性增长。",
  "This GPU record does not support tensor-parallel execution.":
    "此 GPU 记录不支持张量并行执行。",
  "No model in the bundled catalog meets all workload requirements.":
    "内置模型目录中没有满足全部工作负载要求的模型。",
  "Peak TOPS is shown as a specification and is never converted into LLM TPS.":
    "峰值 TOPS 仅作为规格展示，绝不会被换算为大模型 TPS。",
  "Multi-device model sharding is not confirmed, so one device's memory is used for model fit.":
    "尚未确认多设备模型分片能力，因此模型适配仅按单个设备的内存计算。",
  "No model-bound TPS observation was supplied, so local performance remains unavailable.":
    "未提供绑定到具体模型的 TPS 观测，因此本地性能暂不可用。",
  "The saved performance observation does not match the active model, quantization, context and concurrency, so it is not reused.":
    "已保存的性能观测与当前模型、量化精度、上下文和并发不一致，因此不会复用。",
  "The complete-system performance observation does not exactly match the active model, quantization, context and concurrency, so it is not reused.":
    "整机性能观测与当前模型、量化精度、上下文和并发并非完全一致，因此不会复用。",
  "TTFT comes from an exact model-bound complete-system observation; token capacity remains unavailable without effective TPS.":
    "首 Token 延迟来自与模型精确绑定的整机观测；缺少有效 TPS 时，Token 容量仍不可用。",
  "Custom desktop specifications are user-supplied and should be verified before a purchase decision.":
    "自定义桌面整机规格由用户提供，在采购决策前应核实。",
  "The selected desktop system uses directional sample data; replace it with verified product data before quoting.":
    "所选桌面整机使用方向性样例数据；正式报价前请替换为已验证的产品数据。",
  "Verify the selected system against the deployment runtime and model build.":
    "请结合实际部署运行时与模型构建版本验证所选整机。",
  "No matching local inference profile is available; compute utilization is not estimated.":
    "没有匹配的本地推理性能记录，因此不估算算力利用率。",
  "Performance uses the nearest available profile and is scaled as an estimate.":
    "性能使用最接近的可用记录，并按比例进行估算。",
  "Estimated workload demand exceeds the selected hardware profile capacity.":
    "估算的工作负载需求超过所选硬件性能记录的容量。",
  "KV cache uses a class-level fallback because the model has no model-specific value.":
    "该模型没有专属 KV Cache 数值，因此使用模型类别级的回退假设。",
  "Cached input uses the standard input rate because no cached rate is available.":
    "由于没有缓存输入费率，缓存输入按标准输入费率计算。",
  "Hybrid is at a boundary and is economically equivalent to a single deployment mode.":
    "混合部署比例处于边界，其经济结果等同于单一部署模式。",
  "Critical privacy and the current local configuration cannot both be satisfied.":
    "最高隐私要求与当前本地配置无法同时满足。",
  "Local is preferred for privacy, but current economics are unfavorable.":
    "隐私要求更适合本地部署，但当前经济性不理想。",
  "Current model, VRAM, or performance capacity does not satisfy the workload.":
    "当前模型、显存或性能容量无法满足工作负载。",
  "Hybrid requires both a feasible local path and cloud processing.":
    "混合部署要求本地路径可行，并且云端处理可用。",
  "Cloud is unavailable or conflicts with critical privacy.":
    "云端不可用，或与最高隐私要求冲突。",
  "Power cost is directional and depends on actual system idle and load behavior.":
    "电力成本仅为方向性估算，取决于整机实际空闲与负载状态。",
  "No economic break-even under current assumptions.":
    "在当前假设下无法达到经济盈亏平衡。",
};

interface WarningPattern {
  pattern: RegExp;
  translate: (matches: RegExpMatchArray) => string;
}

const chineseWarningPatterns: WarningPattern[] = [
  {
    pattern:
      /^CONFIGURATION_FIRST_SELECTION: '(.+)' is the highest capability model with sufficient memory and catalog performance capacity on the selected hardware\.$/,
    translate: (matches) =>
      `配置优先模式已选择“${matches[1]}”：它是所选硬件上同时满足内存和目录性能容量的最高能力模型。`,
  },
  {
    pattern:
      /^MULTI_GPU_EFFICIENCY_MISSING: no exact (.+)\/(\d+) efficiency is configured; aggregate performance is conservatively held at 1×\.$/,
    translate: (matches) =>
      `未配置 ${matches[1]} 互连、${matches[2]} 卡组合的精确多 GPU 效率；总性能保守按 1× 计算。`,
  },
  {
    pattern: /^(.+) does not list (\d+) GPUs as a supported configuration\.$/,
    translate: (matches) =>
      `${matches[1]} 未将 ${matches[2]} 张 GPU 列为支持的配置。`,
  },
  {
    pattern: /^Capability tier '(.+)' is not defined in assumptions\.capabilityTiers\.$/,
    translate: (matches) =>
      `能力层级“${matches[1]}”未在 assumptions.capabilityTiers 中定义。`,
  },
  {
    pattern: /^Selected model '(.+)' is not present in the model catalog\.$/,
    translate: (matches) => `所选模型“${matches[1]}”不在模型目录中。`,
  },
  {
    pattern: /^The (manual|configuration) model selection does not meet the peak context requirement\.$/,
    translate: (matches) =>
      `${matches[1] === "manual" ? "手动" : "配置优先"}选择的模型不满足峰值上下文要求。`,
  },
  {
    pattern: /^The (manual|configuration) model selection is below the requested capability tier\.$/,
    translate: (matches) =>
      `${matches[1] === "manual" ? "手动" : "配置优先"}选择的模型低于所需能力层级。`,
  },
  {
    pattern: /^The (manual|configuration) model selection conflicts with the critical privacy requirement\.$/,
    translate: (matches) =>
      `${matches[1] === "manual" ? "手动" : "配置优先"}选择的模型与最高隐私要求冲突。`,
  },
  {
    pattern: /^Desktop system '(.+)' is not in this data pack; the first available system is used\.$/,
    translate: (matches) =>
      `桌面整机“${matches[1]}”不在当前数据包中；已使用第一个可用整机。`,
  },
];

export function warningLabel(warning: string, locale: Locale): string {
  if (locale === "en") return warning;

  const exact = exactChineseWarnings[warning];
  if (exact) return exact;

  for (const candidate of chineseWarningPatterns) {
    const matches = warning.match(candidate.pattern);
    if (matches) return candidate.translate(matches);
  }

  // Unknown or newly introduced warnings stay visible until presentation copy
  // is added. Hiding them would be less safe than retaining the English source.
  return warning;
}

