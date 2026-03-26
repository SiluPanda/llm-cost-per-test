import type { ModelPricing } from './types';

/**
 * Built-in model pricing table. Prices are in USD per million tokens.
 */
const BUILT_IN_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-3-20250307': { input: 0.80, output: 4.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
};

/** Custom pricing registered at runtime. */
let customPricing: Record<string, ModelPricing> = {};

/** Warnings emitted for unknown models (to avoid duplicate warnings). */
const warnedModels = new Set<string>();

/**
 * Register custom pricing that overrides or extends the built-in table.
 */
export function registerPricing(pricing: Record<string, ModelPricing>): void {
  customPricing = { ...customPricing, ...pricing };
}

/**
 * Reset custom pricing (useful for testing).
 */
export function resetPricing(): void {
  customPricing = {};
  warnedModels.clear();
}

/**
 * Look up pricing for a model by name. Uses prefix matching to handle
 * dated suffixes (e.g., 'gpt-4o-2024-08-06' matches 'gpt-4o').
 *
 * Resolution order:
 * 1. Custom pricing (exact match)
 * 2. Built-in pricing (exact match)
 * 3. Custom pricing (prefix match)
 * 4. Built-in pricing (prefix match)
 * 5. model-price-registry fallback (if installed)
 * 6. { input: 0, output: 0 } with a warning
 */
export function getPrice(model: string): ModelPricing {
  // 1. Custom pricing exact match
  if (customPricing[model]) {
    return customPricing[model];
  }

  // 2. Built-in pricing exact match
  if (BUILT_IN_PRICING[model]) {
    return BUILT_IN_PRICING[model];
  }

  // 3-4. Prefix matching: find the longest matching prefix in custom then built-in
  const allPricing = { ...BUILT_IN_PRICING, ...customPricing };
  const prefixMatch = findPrefixMatch(model, allPricing);
  if (prefixMatch) {
    return prefixMatch;
  }

  // 5. model-price-registry fallback
  try {
    const registry = require('model-price-registry');
    if (registry && typeof registry.getPrice === 'function') {
      const price = registry.getPrice(model);
      if (price && typeof price.input === 'number' && typeof price.output === 'number') {
        return price;
      }
    }
  } catch {
    // model-price-registry not installed, skip gracefully
  }

  // 6. Unknown model
  if (!warnedModels.has(model)) {
    warnedModels.add(model);
    console.warn(`[llm-cost-per-test] Unknown model "${model}" — cost will be reported as $0.00`);
  }
  return { input: 0, output: 0 };
}

/**
 * Calculate cost for a given model and token counts.
 * Formula: (inputTokens / 1_000_000 * inputPricePerMTok) + (outputTokens / 1_000_000 * outputPricePerMTok)
 *
 * @param pricingOverride - Optional per-instance pricing table. When provided,
 *   these prices take priority over both global custom pricing and built-in pricing.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricingOverride?: Record<string, ModelPricing>,
): number {
  const pricing = pricingOverride
    ? getPriceWithOverride(model, pricingOverride)
    : getPrice(model);
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

/**
 * Resolve pricing for a model using an instance-level override table.
 * Resolution order:
 * 1. pricingOverride (exact match)
 * 2. Global custom pricing (exact match)
 * 3. Built-in pricing (exact match)
 * 4. pricingOverride (prefix match)
 * 5. Global custom / built-in pricing (prefix match)
 * 6. model-price-registry fallback
 * 7. { input: 0, output: 0 } with a warning
 */
function getPriceWithOverride(model: string, pricingOverride: Record<string, ModelPricing>): ModelPricing {
  // 1. Override exact match
  if (pricingOverride[model]) {
    return pricingOverride[model];
  }

  // 2-3. Global exact match (delegates to getPrice's exact-match logic)
  if (customPricing[model]) {
    return customPricing[model];
  }
  if (BUILT_IN_PRICING[model]) {
    return BUILT_IN_PRICING[model];
  }

  // 4-5. Prefix matching across all tables (override has highest priority)
  const allPricing = { ...BUILT_IN_PRICING, ...customPricing, ...pricingOverride };
  const prefixMatch = findPrefixMatch(model, allPricing);
  if (prefixMatch) {
    return prefixMatch;
  }

  // 6-7. Fall through to getPrice for registry fallback and warning
  return getPrice(model);
}

/**
 * Get a read-only copy of the built-in pricing table.
 */
export function getBuiltInPricing(): Readonly<Record<string, ModelPricing>> {
  return { ...BUILT_IN_PRICING };
}

/**
 * Find the longest prefix match for a model name in a pricing table.
 * Strips dated suffixes like '-2024-08-06' by checking if the model name
 * starts with any known model key.
 */
function findPrefixMatch(model: string, pricing: Record<string, ModelPricing>): ModelPricing | null {
  // Sort keys by length descending so longer (more specific) prefixes match first
  const keys = Object.keys(pricing).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (model.startsWith(key) && (model.length === key.length || model[key.length] === '-')) {
      return pricing[key];
    }
  }
  return null;
}
