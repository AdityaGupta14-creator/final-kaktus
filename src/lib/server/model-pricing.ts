/**
 * Gemini model pricing rates per 1,000,000 tokens (USD).
 * Sourced from Google AI Studio official Gemini pricing schedules.
 */

export interface ModelPricingTier {
  inputPer1M: number;
  outputPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPricingTier> = {
  // Flash-Lite family
  'gemini-2.0-flash-lite': { inputPer1M: 0.075, outputPer1M: 0.30 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.075, outputPer1M: 0.30 },
  'gemini-3.5-flash-lite': { inputPer1M: 0.075, outputPer1M: 0.30 },

  // Flash family (standard)
  'gemini-2.0-flash': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gemini-2.5-flash': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gemini-3.5-flash': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gemini-3.6-flash': { inputPer1M: 0.10, outputPer1M: 0.40 },

  // Flash 3.7 / 3.8 advanced family
  'gemini-3.7-flash': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gemini-3.8-flash': { inputPer1M: 0.15, outputPer1M: 0.60 },

  // Pro family
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.00 },
  'gemini-pro': { inputPer1M: 1.25, outputPer1M: 5.00 },
};

const DEFAULT_PRICING: ModelPricingTier = { inputPer1M: 0.10, outputPer1M: 0.40 };

export function resolveModelPricing(modelName: string): ModelPricingTier {
  const clean = modelName.replace(/^models\//, '').toLowerCase();
  
  if (MODEL_PRICING[clean]) return MODEL_PRICING[clean];

  if (clean.includes('flash-lite') || clean.includes('lite')) {
    return MODEL_PRICING['gemini-2.0-flash-lite'];
  }
  if (clean.includes('3.7') || clean.includes('3.8')) {
    return MODEL_PRICING['gemini-3.7-flash'];
  }
  if (clean.includes('pro')) {
    return MODEL_PRICING['gemini-1.5-pro'];
  }
  if (clean.includes('flash')) {
    return MODEL_PRICING['gemini-2.0-flash'];
  }

  return DEFAULT_PRICING;
}

/**
 * Calculates estimated API usage cost in USD.
 * Uses exact input/output tokens when available, or blended 75/25 ratio when only total tokens is known.
 */
export function calculateUsageCost(
  model: string,
  inputTokens?: number | null,
  outputTokens?: number | null,
  totalTokens?: number | null
): number {
  const pricing = resolveModelPricing(model);
  const inTokens = typeof inputTokens === 'number' && inputTokens > 0 ? inputTokens : 0;
  const outTokens = typeof outputTokens === 'number' && outputTokens > 0 ? outputTokens : 0;
  const total = typeof totalTokens === 'number' && totalTokens > 0 ? totalTokens : (inTokens + outTokens);

  if (inTokens > 0 || outTokens > 0) {
    const inputCost = (inTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (outTokens / 1_000_000) * pricing.outputPer1M;
    return inputCost + outputCost;
  }

  if (total > 0) {
    // Blended rate based on typical 75% prompt / 25% completion distribution
    const blendedRatePer1M = pricing.inputPer1M * 0.75 + pricing.outputPer1M * 0.25;
    return (total / 1_000_000) * blendedRatePer1M;
  }

  return 0;
}
