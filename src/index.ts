// llm-cost-per-test - Per-test LLM API cost tracking with budgets and baseline comparison

// ── Core Reporter ───────────────────────────────────────────────────
export { LLMCostReporter, createReporter } from './reporter';

// ── Cost Tracker ────────────────────────────────────────────────────
export { createCostTracker } from './tracker';

// ── Pricing Utilities ───────────────────────────────────────────────
export { calculateCost, getPrice, registerPricing, resetPricing, getBuiltInPricing } from './pricing';

// ── Budget ──────────────────────────────────────────────────────────
export { checkBudget, resolveBudget, formatViolation } from './budget';

// ── Baseline ────────────────────────────────────────────────────────
export {
  loadBaseline,
  saveBaseline,
  compareBaseline,
  evaluateBaselineThresholds,
  shouldUpdateBaseline,
} from './baseline';

// ── Formatters ──────────────────────────────────────────────────────
export { formatTable, formatJSON, formatMarkdown, formatJUnit } from './formatter';

// ── Types ───────────────────────────────────────────────────────────
export type {
  CostReporterOptions,
  OutputFormat,
  InterceptionMode,
  ModelPricing,
  CostBudget,
  BaselineConfig,
  TrackerOptions,
  UsageInput,
  UsageRecord,
  CostSummary,
  CostReport,
  TestCostEntry,
  FileCostEntry,
  ModelCostEntry,
  BudgetViolation,
  BaselineDiff,
  TestCostDiff,
  CostBaseline,
  CostTracker,
} from './types';
