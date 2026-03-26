import type { CostTracker, CostSummary, UsageInput, UsageRecord, TrackerOptions, ModelPricing } from './types';
import { calculateCost } from './pricing';

/**
 * Implementation of the CostTracker interface.
 * Accumulates UsageRecord entries and computes cost summaries.
 *
 * Each instance holds its own pricing override table so that two trackers
 * created with different pricing for the same model compute different costs.
 */
class CostTrackerImpl implements CostTracker {
  private entries: UsageRecord[] = [];
  private readonly pricingOverride?: Record<string, ModelPricing>;

  constructor(options?: TrackerOptions) {
    if (options?.pricing) {
      this.pricingOverride = { ...options.pricing };
    }
  }

  /**
   * Record a single LLM API call's token usage.
   * If usage.cost is provided, it overrides the computed cost.
   */
  record(usage: UsageInput): void {
    const cost = usage.cost ?? calculateCost(usage.model, usage.inputTokens, usage.outputTokens, this.pricingOverride);

    const record: UsageRecord = {
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cost,
      timestamp: new Date().toISOString(),
    };

    this.entries.push(record);
  }

  /**
   * Get the accumulated cost summary.
   */
  getCost(): CostSummary {
    const byModel: Record<string, { cost: number; calls: number; inputTokens: number; outputTokens: number }> = {};

    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const entry of this.entries) {
      totalCost += entry.cost;
      totalInputTokens += entry.inputTokens;
      totalOutputTokens += entry.outputTokens;

      if (!byModel[entry.model]) {
        byModel[entry.model] = { cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
      }
      byModel[entry.model].cost += entry.cost;
      byModel[entry.model].calls += 1;
      byModel[entry.model].inputTokens += entry.inputTokens;
      byModel[entry.model].outputTokens += entry.outputTokens;
    }

    return {
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      totalApiCalls: this.entries.length,
      byModel,
    };
  }

  /**
   * Get all recorded usage entries.
   */
  getEntries(): ReadonlyArray<UsageRecord> {
    return [...this.entries];
  }

  /**
   * Reset the tracker (clear all recorded entries).
   */
  reset(): void {
    this.entries = [];
  }
}

/**
 * Factory function to create a CostTracker instance.
 */
export function createCostTracker(options?: TrackerOptions): CostTracker {
  return new CostTrackerImpl(options);
}

// Re-export for convenience
export type { CostTracker, CostSummary, UsageInput, UsageRecord, TrackerOptions, ModelPricing };
