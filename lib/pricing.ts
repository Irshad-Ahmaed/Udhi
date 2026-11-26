/**
 * Standard Gemini Developer API Paid-Tier reference rates (USD per 1M tokens)
 * used to compute estimated USD cost for each generation run.
 * Note: Free-tier API keys are billed $0; this estimates equivalent API value.
 */
export interface ModelRate {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

const MODEL_RATES: Record<string, ModelRate> = {
  "gemini-3.5-flash-lite": { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
  "gemini-3.5-flash": { inputPerMillionUsd: 0.5, outputPerMillionUsd: 3.0 },
  "gemini-3.6-flash": { inputPerMillionUsd: 0.5, outputPerMillionUsd: 3.0 },
  "gemini-3.8-flash": { inputPerMillionUsd: 0.75, outputPerMillionUsd: 3.75 },
  "gemini-3.1-flash-lite": { inputPerMillionUsd: 0.25, outputPerMillionUsd: 1.5 },
  "gemini-2.5-flash-lite": { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
  "gemini-2.5-flash": { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
};

const DEFAULT_RATE: ModelRate = MODEL_RATES["gemini-3.5-flash-lite"];

export function getModelRate(model: string): ModelRate {
  const normalized = model.replace(/^models\//, "").trim().toLowerCase();
  if (MODEL_RATES[normalized]) {
    return MODEL_RATES[normalized];
  }
  const prefixMatch = Object.keys(MODEL_RATES).find((key) =>
    normalized.startsWith(key),
  );
  return prefixMatch ? MODEL_RATES[prefixMatch] : DEFAULT_RATE;
}

/**
 * Estimates USD cost from input and total output tokens (candidates + thoughts).
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = getModelRate(model);
  const inputCost = (Math.max(0, inputTokens) / 1_000_000) * rate.inputPerMillionUsd;
  const outputCost = (Math.max(0, outputTokens) / 1_000_000) * rate.outputPerMillionUsd;
  return Number((inputCost + outputCost).toFixed(8));
}
