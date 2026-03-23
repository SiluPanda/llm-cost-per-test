// ── Configuration Types ─────────────────────────────────────────────

/** Output format for the cost report. */
export type OutputFormat = 'table' | 'json' | 'markdown' | 'junit';

/** Interception mode for capturing LLM API calls. */
export type InterceptionMode = 'auto' | 'sdk' | 'manual' | 'off';

/** Price per million input/output tokens (USD). */
export interface ModelPricing {
  /** Price per million input tokens (USD). */
  input: number;
  /** Price per million output tokens (USD). */
  output: number;
}

/** Cost budget thresholds at various levels. */
export interface CostBudget {
  /** Maximum cost per individual test (USD). */
  perTest?: number;
  /** Maximum cost per test file (USD). */
  perFile?: number;
  /** Maximum total cost for the entire test run (USD). */
  perSuite?: number;
}

/** Baseline comparison configuration. */
export interface BaselineConfig {
  /** Path to the baseline file. */
  path: string;
  /** Whether to update the baseline with the current run's data. Default: false. */
  update?: boolean;
  /** Percentage increase that triggers a warning. Default: 0.10 (10%). */
  warnThreshold?: number;
  /** Percentage increase that triggers a failure. Default: 0.25 (25%). */
  failThreshold?: number;
}

/** Options for the CostTracker factory. */
export interface TrackerOptions {
  /** Custom pricing table. Merges with built-in pricing. */
  pricing?: Record<string, ModelPricing>;
}

/** Options for the cost reporter. */
export interface CostReporterOptions {
  /** Output format. Default: 'table'. */
  output?: OutputFormat;
  /** File path to write the report to. If not set, output goes to stdout. */
  outputFile?: string;
  /** Cost budget thresholds. */
  budget?: CostBudget;
  /** Baseline comparison configuration. */
  baseline?: BaselineConfig;
  /** Custom model pricing ($/MTok). Merges with built-in pricing. */
  pricing?: Record<string, ModelPricing>;
  /** Interception mode. Default: 'auto'. */
  interception?: InterceptionMode;
  /** Number of top-N most expensive tests to display. Default: 10. */
  topN?: number;
  /** Whether to show per-model cost breakdown. Default: true. */
  showModelBreakdown?: boolean;
  /** Whether to show per-file cost breakdown. Default: true. */
  showFileBreakdown?: boolean;
  /** Whether to show the full per-test table. Default: true. */
  showPerTestTable?: boolean;
  /** Minimum cost threshold for a test to appear in the report. Default: 0 (show all). */
  minCostToShow?: number;
}

// ── Input Types ─────────────────────────────────────────────────────

/** Input for recording a single LLM API call's token usage. */
export interface UsageInput {
  /** Model name (e.g., 'gpt-4o', 'claude-sonnet-4-20250514'). */
  model: string;
  /** Number of input/prompt tokens. */
  inputTokens: number;
  /** Number of output/completion tokens. */
  outputTokens: number;
  /** Override the computed cost with an explicit dollar amount. */
  cost?: number;
}

// ── Record / Report Types ───────────────────────────────────────────

/** A single recorded LLM API call. */
export interface UsageRecord {
  /** Model name. */
  model: string;
  /** Input tokens for this call. */
  inputTokens: number;
  /** Output tokens for this call. */
  outputTokens: number;
  /** Cost for this call (USD). */
  cost: number;
  /** ISO 8601 timestamp of when this call was recorded. */
  timestamp: string;
}

/** Aggregated cost summary for a tracker. */
export interface CostSummary {
  /** Total cost (USD). */
  totalCost: number;
  /** Total input tokens. */
  totalInputTokens: number;
  /** Total output tokens. */
  totalOutputTokens: number;
  /** Total API calls. */
  totalApiCalls: number;
  /** Cost breakdown by model. */
  byModel: Record<string, { cost: number; calls: number; inputTokens: number; outputTokens: number }>;
}

/** Per-test cost entry in a report. */
export interface TestCostEntry {
  /** Full test name (describe block + test name). */
  testName: string;
  /** Test file path. */
  filePath: string;
  /** Total cost for this test (USD). */
  cost: number;
  /** Total input tokens for this test. */
  inputTokens: number;
  /** Total output tokens for this test. */
  outputTokens: number;
  /** Number of LLM API calls in this test. */
  apiCalls: number;
  /** Individual usage records. */
  records: UsageRecord[];
}

/** Per-file cost aggregate. */
export interface FileCostEntry {
  /** File path. */
  filePath: string;
  /** Total cost for all tests in this file. */
  cost: number;
  /** Number of tests in this file with LLM calls. */
  testCount: number;
  /** Number of API calls in this file. */
  apiCalls: number;
}

/** Per-model cost aggregate. */
export interface ModelCostEntry {
  /** Model name. */
  model: string;
  /** Total cost for this model. */
  cost: number;
  /** Percentage of total cost. */
  percentage: number;
  /** Number of API calls with this model. */
  apiCalls: number;
  /** Total input tokens for this model. */
  inputTokens: number;
  /** Total output tokens for this model. */
  outputTokens: number;
}

/** A budget violation result. */
export interface BudgetViolation {
  /** Budget level that was violated. */
  level: 'perTest' | 'perFile' | 'perSuite';
  /** Name of the offending test, file, or 'suite'. */
  name: string;
  /** Actual cost. */
  actualCost: number;
  /** Budget threshold. */
  budgetCost: number;
}

/** Per-test cost diff against baseline. */
export interface TestCostDiff {
  /** Test name. */
  testName: string;
  /** Baseline cost. */
  baselineCost: number;
  /** Current cost. */
  currentCost: number;
  /** Absolute cost change. */
  costChange: number;
  /** Percentage cost change. */
  percentageChange: number;
}

/** Baseline diff result. */
export interface BaselineDiff {
  /** Path to the baseline file used. */
  baselinePath: string;
  /** Baseline total cost. */
  baselineTotalCost: number;
  /** Current total cost. */
  currentTotalCost: number;
  /** Absolute cost change. */
  costChange: number;
  /** Percentage cost change. */
  percentageChange: number;
  /** Per-test diffs. */
  tests: TestCostDiff[];
  /** Tests present in current run but not in baseline. */
  newTests: TestCostEntry[];
  /** Tests present in baseline but not in current run. */
  removedTests: string[];
}

/** Baseline file format. */
export interface CostBaseline {
  /** File format version. */
  version: number;
  /** ISO 8601 timestamp of when the baseline was created. */
  createdAt: string;
  /** Total cost at baseline time. */
  totalCost: number;
  /** Per-test cost entries, keyed by test name. */
  tests: Record<string, {
    cost: number;
    inputTokens: number;
    outputTokens: number;
    model: string;
    apiCalls: number;
    file: string;
  }>;
}

/** The full cost report. */
export interface CostReport {
  /** Report format version. */
  version: number;
  /** ISO 8601 timestamp of when the report was generated. */
  createdAt: string;
  /** Total cost of the entire test run. */
  totalCost: number;
  /** Total input tokens across all tests. */
  totalInputTokens: number;
  /** Total output tokens across all tests. */
  totalOutputTokens: number;
  /** Total number of LLM API calls. */
  totalApiCalls: number;
  /** Number of tests that made LLM API calls. */
  testsWithCalls: number;
  /** Total number of tests in the run. */
  totalTests: number;
  /** Per-test cost entries. */
  tests: TestCostEntry[];
  /** Per-file cost aggregates. */
  files: FileCostEntry[];
  /** Per-model cost aggregates. */
  models: ModelCostEntry[];
  /** Budget violations, if any. */
  budgetViolations: BudgetViolation[];
  /** Baseline comparison, if a baseline was provided. */
  baselineDiff?: BaselineDiff;
}

/** The CostTracker interface for manual cost tracking. */
export interface CostTracker {
  /** Record a single LLM API call's token usage. */
  record(usage: UsageInput): void;
  /** Get the accumulated cost summary. */
  getCost(): CostSummary;
  /** Get all recorded usage entries. */
  getEntries(): ReadonlyArray<UsageRecord>;
  /** Reset the tracker (clear all recorded entries). */
  reset(): void;
}
