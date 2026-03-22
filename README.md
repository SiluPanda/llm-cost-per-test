# llm-cost-per-test

Per-test LLM API cost tracking with budgets and baseline comparison.

[![npm version](https://img.shields.io/npm/v/llm-cost-per-test.svg)](https://www.npmjs.com/package/llm-cost-per-test)
[![npm downloads](https://img.shields.io/npm/dt/llm-cost-per-test.svg)](https://www.npmjs.com/package/llm-cost-per-test)
[![license](https://img.shields.io/npm/l/llm-cost-per-test.svg)](https://github.com/SiluPanda/llm-cost-per-test/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/llm-cost-per-test.svg)](https://nodejs.org)

---

## Description

`llm-cost-per-test` is a framework-agnostic cost reporter that tracks per-test-case LLM API costs. It computes cost using model-specific pricing (USD per million tokens), attributes costs to individual tests, enforces dollar-denominated budgets at the test, file, and suite level, compares current costs against a saved baseline to detect cost regressions, and produces reports in four output formats: terminal table, JSON, Markdown, and JUnit XML.

The package answers questions that matter during test development and CI: which test case costs the most, did this PR increase eval costs, and is any single test accidentally calling an expensive model in a loop. It ships with built-in pricing for OpenAI, Anthropic, and Google models, supports custom pricing, and optionally falls back to `model-price-registry` for models not in the built-in table.

Zero runtime dependencies beyond Node.js built-ins.

---

## Installation

```bash
npm install llm-cost-per-test
```

Requires Node.js >= 18.

---

## Quick Start

```typescript
import { createReporter } from 'llm-cost-per-test';

const reporter = createReporter({
  output: 'table',
  budget: { perTest: 0.50, perSuite: 10.00 },
});

// Track test lifecycle
reporter.startTest('classifies positive feedback', 'tests/classify.test.ts');
reporter.recordApiCall('classifies positive feedback', 'gpt-4o', 150, 42);
reporter.endTest('classifies positive feedback');

// Generate report, write output, check budgets
const { report, violations, output } = reporter.finalize();
```

For standalone cost tracking without the reporter:

```typescript
import { createCostTracker } from 'llm-cost-per-test';

const tracker = createCostTracker();
tracker.record({ model: 'gpt-4o', inputTokens: 500, outputTokens: 150 });

const summary = tracker.getCost();
console.log(summary.totalCost); // 0.00275
```

---

## Features

- **Per-test cost attribution** -- Track LLM API costs at the individual test level with per-test, per-file, and per-model breakdowns.
- **Built-in pricing for 16 models** -- OpenAI (GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-4, GPT-3.5-turbo, o1, o1-mini, o3-mini), Anthropic (Claude Opus 4, Claude Sonnet 4, Claude Haiku 3, Claude 3.5 Sonnet, Claude 3 Haiku), and Google (Gemini 1.5 Pro, Gemini 1.5 Flash, Gemini 2.0 Flash).
- **Prefix matching** -- Dated model suffixes (e.g., `gpt-4o-2024-08-06`) automatically resolve to the base model pricing.
- **Custom pricing** -- Register pricing for private or fine-tuned models. Custom prices override built-in pricing.
- **Cost budgets** -- Set dollar thresholds at three levels (per-test, per-file, per-suite) that produce violations when exceeded.
- **Baseline comparison** -- Save a cost baseline, compare subsequent runs, and detect regressions with configurable warn and fail thresholds.
- **Four output formats** -- Terminal table (with ANSI color), JSON, Markdown (for PR comments), and JUnit XML (for CI dashboards).
- **Environment variable overrides** -- All budget, output, and baseline settings can be overridden via environment variables without code changes.
- **Manual cost override** -- Pass an explicit dollar cost for API calls where token-based pricing does not apply.
- **model-price-registry fallback** -- When installed as an optional peer dependency, provides pricing for models not in the built-in table.
- **Full TypeScript support** -- Complete type definitions for all public APIs, configuration objects, and report types.

---

## API Reference

### Reporter

#### `createReporter(options?: CostReporterOptions): LLMCostReporter`

Factory function that creates and returns an `LLMCostReporter` instance.

```typescript
import { createReporter } from 'llm-cost-per-test';

const reporter = createReporter({
  output: 'json',
  outputFile: 'cost-report.json',
  budget: { perTest: 0.50, perSuite: 15.00 },
  baseline: {
    path: '.cost-baseline.json',
    warnThreshold: 0.10,
    failThreshold: 0.25,
  },
  pricing: { 'my-model': { input: 5.00, output: 15.00 } },
  topN: 10,
  showModelBreakdown: true,
  showFileBreakdown: true,
  showPerTestTable: true,
  minCostToShow: 0,
});
```

#### `class LLMCostReporter`

The main reporter class. Tracks per-test LLM API costs, enforces budgets, compares against baselines, and generates reports.

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `startTest` | `(testName: string, filePath: string) => void` | Begin tracking a test. Creates a new `CostTracker` for the test. |
| `endTest` | `(testName: string) => void` | Mark a test as completed. |
| `recordApiCall` | `(testName: string, model: string, inputTokens: number, outputTokens: number, cost?: number) => void` | Record an LLM API call for a test. Auto-creates a tracker if `startTest` was not called. The optional `cost` parameter overrides the computed cost. |
| `getTracker` | `(testName: string) => CostTracker \| undefined` | Get the `CostTracker` instance for a specific test. Returns `undefined` if the test does not exist. |
| `generateReport` | `() => CostReport` | Generate the full cost report from all tracked tests. Evaluates budgets and baseline comparisons. Does not write output. |
| `finalize` | `() => { report, violations, baselineResult, output }` | Generate the report, format it in the configured output format, write it to the configured destination (file or stdout), evaluate budgets and baselines, and return the complete result. |
| `checkBudget` | `() => BudgetViolation[]` | Evaluate budgets against current tracked data without generating the full report. |
| `reset` | `() => void` | Clear all tracked data (trackers, test files, completed tests, test count). |

**`finalize()` return value:**

```typescript
{
  report: CostReport;
  violations: BudgetViolation[];
  baselineResult: { warn: boolean; fail: boolean; message: string | null } | null;
  output: string;
}
```

---

### Cost Tracker

#### `createCostTracker(options?: TrackerOptions): CostTracker`

Factory function that creates a standalone `CostTracker` instance. Accepts an optional `TrackerOptions` object with custom pricing.

```typescript
import { createCostTracker } from 'llm-cost-per-test';

const tracker = createCostTracker({
  pricing: { 'my-model': { input: 5.00, output: 10.00 } },
});

tracker.record({ model: 'my-model', inputTokens: 1_000_000, outputTokens: 1_000_000 });
console.log(tracker.getCost().totalCost); // 15
```

#### `interface CostTracker`

| Method | Signature | Description |
|--------|-----------|-------------|
| `record` | `(usage: UsageInput) => void` | Record a single LLM API call's token usage. If `usage.cost` is provided, it overrides the computed cost. Each record is timestamped with an ISO 8601 string. |
| `getCost` | `() => CostSummary` | Get the accumulated cost summary including totals and per-model breakdown. |
| `getEntries` | `() => ReadonlyArray<UsageRecord>` | Get all recorded usage entries in recording order. Returns a defensive copy. |
| `reset` | `() => void` | Clear all recorded entries. The tracker can be reused after reset. |

---

### Pricing Utilities

#### `calculateCost(model: string, inputTokens: number, outputTokens: number): number`

Compute the cost in USD for a given model and token counts.

Formula: `(inputTokens / 1,000,000 * inputPricePerMTok) + (outputTokens / 1,000,000 * outputPricePerMTok)`

```typescript
import { calculateCost } from 'llm-cost-per-test';

const cost = calculateCost('gpt-4o', 500, 150);
// (500 / 1_000_000 * 2.50) + (150 / 1_000_000 * 10.00) = 0.00275
```

#### `getPrice(model: string): ModelPricing`

Look up pricing for a model by name. Resolution order:

1. Custom pricing (exact match)
2. Built-in pricing (exact match)
3. Custom pricing (prefix match -- longest matching prefix wins)
4. Built-in pricing (prefix match)
5. `model-price-registry` fallback (if installed)
6. `{ input: 0, output: 0 }` with a one-time console warning

Prefix matching strips dated suffixes: `gpt-4o-2024-08-06` matches `gpt-4o`, `gpt-4-turbo-2024-04-09` matches `gpt-4-turbo`.

```typescript
import { getPrice } from 'llm-cost-per-test';

getPrice('gpt-4o');                // { input: 2.50, output: 10.00 }
getPrice('gpt-4o-2024-08-06');     // { input: 2.50, output: 10.00 } (prefix match)
getPrice('unknown-model');          // { input: 0, output: 0 } + warning
```

#### `registerPricing(pricing: Record<string, ModelPricing>): void`

Register custom pricing that overrides or extends the built-in table. Multiple calls merge additively. Custom pricing takes precedence over built-in pricing.

```typescript
import { registerPricing } from 'llm-cost-per-test';

registerPricing({
  'my-fine-tuned-model': { input: 8.00, output: 24.00 },
  'gpt-4o': { input: 5.00, output: 20.00 }, // overrides built-in
});
```

#### `resetPricing(): void`

Reset all custom pricing and clear the warned-models set. Returns the pricing system to its initial state with only built-in models. Primarily useful in tests.

#### `getBuiltInPricing(): Readonly<Record<string, ModelPricing>>`

Return a read-only copy of the built-in pricing table. Modifications to the returned object do not affect the internal table.

---

### Budget

#### `checkBudget(budget: CostBudget, tests: TestCostEntry[], files: FileCostEntry[], totalCost: number): BudgetViolation[]`

Evaluate cost data against budget thresholds. Returns all violations found across all budget levels. Checks are only performed for budget properties that are defined.

```typescript
import { checkBudget } from 'llm-cost-per-test';

const violations = checkBudget(
  { perTest: 0.50, perFile: 2.00, perSuite: 10.00 },
  testEntries,
  fileEntries,
  totalCost,
);
// Returns BudgetViolation[] -- empty if all costs are within budget
```

#### `resolveBudget(optionsBudget?: CostBudget): CostBudget`

Resolve budget configuration by merging the provided options with environment variable overrides. Environment variables take highest priority. Invalid (non-numeric) or empty environment variable values are ignored.

#### `formatViolation(violation: BudgetViolation): string`

Format a budget violation into a human-readable error message.

```typescript
import { formatViolation } from 'llm-cost-per-test';

const message = formatViolation(violation);
// 'BUDGET VIOLATION: Test "expensive test" cost $0.6000, exceeding perTest budget of $0.5000.'
```

---

### Baseline

#### `loadBaseline(path: string): CostBaseline | null`

Load a baseline JSON file. Returns `null` if the file does not exist, contains invalid JSON, or does not match the expected schema. Logs an error to `console.error` for invalid files.

#### `saveBaseline(path: string, tests: TestCostEntry[], totalCost: number): void`

Save a baseline file with the current run's cost data in `CostBaseline` format (version 1). Creates parent directories recursively if they do not exist. Each test entry records the primary model (most frequently used), API call count, token counts, cost, and file path.

#### `compareBaseline(baselinePath: string, baseline: CostBaseline, currentTests: TestCostEntry[], currentTotalCost: number): BaselineDiff`

Compare current costs against a loaded baseline. Returns a `BaselineDiff` containing:
- Per-test cost diffs (absolute and percentage change)
- New tests (present in current run but not in baseline)
- Removed tests (present in baseline but not in current run)
- Total cost change and percentage change

#### `evaluateBaselineThresholds(diff: BaselineDiff, config: BaselineConfig): { warn: boolean; fail: boolean; message: string | null }`

Evaluate whether the baseline diff exceeds the configured thresholds:
- If `percentageChange > failThreshold`: returns `{ warn: true, fail: true }` with an error message.
- If `percentageChange > warnThreshold`: returns `{ warn: true, fail: false }` with a warning message.
- Otherwise: returns `{ warn: false, fail: false, message: null }`.

Default thresholds: `warnThreshold = 0.10` (10%), `failThreshold = 0.25` (25%).

#### `shouldUpdateBaseline(config?: BaselineConfig): boolean`

Determine whether the baseline should be updated. Returns `true` if:
- The `LLM_COST_UPDATE_BASELINE` environment variable is `1`, `true`, or `yes`, OR
- `config.update` is `true`.

---

### Formatters

#### `formatTable(report: CostReport, options?): string`

Format the report as a terminal table with ANSI colors (when stdout is a TTY and `NO_COLOR` is not set). The output includes: per-test cost table, suite summary, top-N most expensive tests, cost-by-model breakdown, cost-by-file breakdown, budget violations, and baseline diff.

Table formatting options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `topN` | `number` | `10` | Number of top-N most expensive tests to display. |
| `showModelBreakdown` | `boolean` | `true` | Show the per-model cost breakdown section. |
| `showFileBreakdown` | `boolean` | `true` | Show the per-file cost breakdown section. |
| `showPerTestTable` | `boolean` | `true` | Show the full per-test table. |
| `minCostToShow` | `number` | `0` | Minimum cost for a test to appear individually; cheaper tests are grouped as "other". |

#### `formatJSON(report: CostReport): string`

Serialize the full `CostReport` to pretty-printed JSON (2-space indentation).

#### `formatMarkdown(report: CostReport): string`

Format the report as Markdown with tables. Includes a per-test table, total summary line, optional baseline diff section, and optional budget violations section. Designed for GitHub PR comments.

#### `formatJUnit(report: CostReport): string`

Format the report as JUnit XML. Each test produces a `<testcase>` element with `<properties>` containing:
- `llm.cost` -- Cost in USD (4 decimal places)
- `llm.inputTokens` -- Input token count
- `llm.outputTokens` -- Output token count
- `llm.apiCalls` -- Number of API calls
- `llm.model` -- Primary model name

Compatible with CI dashboard JUnit parsers. XML special characters in test names and file paths are escaped.

---

## Configuration

### `CostReporterOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `output` | `'table' \| 'json' \| 'markdown' \| 'junit'` | `'table'` | Output format for the report. |
| `outputFile` | `string` | `undefined` | File path to write the report to. If not set, output goes to stdout. |
| `budget` | `CostBudget` | `{}` | Cost budget thresholds. |
| `baseline` | `BaselineConfig` | `undefined` | Baseline comparison configuration. |
| `pricing` | `Record<string, ModelPricing>` | `{}` | Custom model pricing (USD per million tokens). Merges with built-in pricing. |
| `interception` | `'auto' \| 'sdk' \| 'manual' \| 'off'` | `'auto'` | Interception mode for capturing LLM API calls. |
| `topN` | `number` | `10` | Number of top-N most expensive tests to display in the table output. |
| `showModelBreakdown` | `boolean` | `true` | Show per-model cost breakdown in table output. |
| `showFileBreakdown` | `boolean` | `true` | Show per-file cost breakdown in table output. |
| `showPerTestTable` | `boolean` | `true` | Show the full per-test table in table output. |
| `minCostToShow` | `number` | `0` | Minimum cost threshold (USD) for a test to appear individually in the table. Tests below this threshold are grouped. |
| `vcr` | `{ cassettesDir: string }` | `undefined` | Integration with `llm-vcr`. When provided, reads cost data from cassettes. |

### `CostBudget`

| Property | Type | Description |
|----------|------|-------------|
| `perTest` | `number` | Maximum cost per individual test (USD). |
| `perFile` | `number` | Maximum cost per test file (USD). |
| `perSuite` | `number` | Maximum total cost for the entire test run (USD). |

All properties are optional. Budget checks are only performed for properties that are defined. A test at the exact budget boundary does not trigger a violation (the check is strictly greater-than).

### `BaselineConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `path` | `string` | -- | Path to the baseline JSON file. Required. |
| `update` | `boolean` | `false` | When `true`, save the current run's data as the new baseline instead of comparing. |
| `warnThreshold` | `number` | `0.10` | Percentage increase that triggers a warning (0.10 = 10%). |
| `failThreshold` | `number` | `0.25` | Percentage increase that triggers a failure (0.25 = 25%). |

### Environment Variables

Environment variables override all programmatic configuration. They are resolved at reporter construction time.

| Variable | Type | Description |
|----------|------|-------------|
| `LLM_COST_OUTPUT` | `string` | Output format: `table`, `json`, `markdown`, or `junit`. |
| `LLM_COST_OUTPUT_FILE` | `string` | File path for report output. |
| `LLM_COST_BUDGET_PER_TEST` | `string` | Per-test budget in USD (e.g., `"0.50"`). Parsed as float. |
| `LLM_COST_BUDGET_PER_FILE` | `string` | Per-file budget in USD (e.g., `"2.00"`). Parsed as float. |
| `LLM_COST_BUDGET_PER_SUITE` | `string` | Per-suite budget in USD (e.g., `"10.00"`). Parsed as float. |
| `LLM_COST_UPDATE_BASELINE` | `string` | Set to `1`, `true`, or `yes` to update the baseline file instead of comparing. |
| `NO_COLOR` | any | When set, disables ANSI colors in terminal table output. |

Invalid (non-numeric) or empty budget environment variable values are silently ignored, and the programmatic value is used instead.

---

## Error Handling

- **Unknown model** -- When a model is not found in any pricing source (custom, built-in, prefix match, or `model-price-registry`), cost is reported as `$0.00` and a warning is emitted to `console.warn`. The warning is emitted only once per unknown model per process to avoid log noise.
- **Missing baseline file** -- When the configured baseline path does not exist, baseline comparison is silently skipped. No error is thrown and `report.baselineDiff` is `undefined`.
- **Corrupt baseline file** -- When the baseline file contains invalid JSON, an error is logged to `console.error` and baseline comparison is skipped. When the file is valid JSON but does not match the `CostBaseline` schema (missing `version`, `totalCost`, or `tests`), a format error is logged and comparison is skipped.
- **Budget violations** -- When a budget is exceeded, all violations are collected (not just the first), included in `report.budgetViolations`, and printed to `console.error` during `finalize()`. The `finalize()` method returns the full violations array for programmatic handling.
- **Baseline threshold exceeded** -- When cost increase exceeds `warnThreshold`, a warning is emitted to `console.warn`. When it exceeds `failThreshold`, a failure message is emitted to `console.error`. The `baselineResult` in `finalize()` indicates the status.
- **Missing `startTest` call** -- If `recordApiCall` is called for a test that was not started with `startTest`, a tracker is created automatically. The file path defaults to `'unknown'`.
- **Zero tokens** -- Recording zero input and output tokens produces a `$0.00` cost entry. This is valid and does not trigger warnings.
- **Large-scale runs** -- The reporter handles 200+ tests with no performance degradation. All data is held in memory as simple arrays and maps.

---

## Advanced Usage

### Budget Enforcement in CI

Set budgets to fail the build when costs exceed thresholds:

```typescript
const reporter = createReporter({
  budget: {
    perTest: 0.50,   // No single test may cost more than $0.50
    perFile: 2.00,   // No single file may cost more than $2.00
    perSuite: 15.00, // The entire run must stay under $15.00
  },
});

// ... track tests ...

const { violations } = reporter.finalize();
if (violations.length > 0) {
  process.exitCode = 1;
}
```

Or set budgets via environment variables in CI pipelines without code changes:

```bash
LLM_COST_BUDGET_PER_TEST=0.50 LLM_COST_BUDGET_PER_SUITE=15.00 npm test
```

### Baseline Comparison for PR Cost Review

Save a baseline on the main branch and compare against it on feature branches:

```typescript
// On main branch: save baseline
const reporter = createReporter({
  baseline: { path: '.cost-baseline.json', update: true },
});
// ... track tests ...
reporter.generateReport(); // writes baseline file

// On feature branch: compare against baseline
const reporter = createReporter({
  baseline: {
    path: '.cost-baseline.json',
    update: false,
    warnThreshold: 0.10,  // Warn if costs increase by more than 10%
    failThreshold: 0.25,  // Fail if costs increase by more than 25%
  },
});
// ... track tests ...
const { baselineResult } = reporter.finalize();
if (baselineResult?.fail) {
  process.exitCode = 1;
}
```

Update the baseline from CI without code changes:

```bash
LLM_COST_UPDATE_BASELINE=1 npm test
```

### Writing Reports to Files

Generate reports in different formats for CI integration:

```typescript
// JSON for downstream processing
createReporter({ output: 'json', outputFile: 'cost-report.json' });

// Markdown for PR comments
createReporter({ output: 'markdown', outputFile: 'cost-report.md' });

// JUnit XML for CI dashboards
createReporter({ output: 'junit', outputFile: 'cost-report.xml' });
```

### Custom Model Pricing

Register pricing at reporter construction:

```typescript
const reporter = createReporter({
  pricing: {
    'my-fine-tuned-gpt4': { input: 8.00, output: 24.00 },
    'local-llama-70b': { input: 0.00, output: 0.00 },
  },
});
```

Or register pricing globally before creating the reporter:

```typescript
import { registerPricing } from 'llm-cost-per-test';

registerPricing({
  'my-fine-tuned-gpt4': { input: 8.00, output: 24.00 },
});
```

Custom pricing supports prefix matching. Registering `'my-model'` also matches `'my-model-v2'` and `'my-model-2024-01-01'`.

### Manual Cost Override

For API calls where token-based pricing does not apply (flat-rate APIs, cached responses, etc.):

```typescript
// Via reporter
reporter.recordApiCall('test name', 'custom-api', 0, 0, 0.05);

// Via tracker
const tracker = createCostTracker();
tracker.record({ model: 'custom-api', inputTokens: 0, outputTokens: 0, cost: 0.05 });
```

When `cost` is provided, the token-based calculation is bypassed entirely.

### Controlling Table Output

Customize the terminal table display:

```typescript
const reporter = createReporter({
  topN: 5,                   // Show top 5 most expensive tests
  showModelBreakdown: false, // Hide per-model breakdown
  showFileBreakdown: true,   // Show per-file breakdown
  showPerTestTable: true,    // Show the full test table
  minCostToShow: 0.001,     // Hide tests costing less than $0.001
});
```

### Standalone Cost Calculation

Use the pricing utilities independently of the reporter:

```typescript
import { calculateCost, getPrice, getBuiltInPricing } from 'llm-cost-per-test';

// Calculate cost for a specific call
const cost = calculateCost('claude-sonnet-4-20250514', 2000, 500);

// Look up pricing
const pricing = getPrice('gpt-4o'); // { input: 2.50, output: 10.00 }

// Get all built-in pricing
const allPricing = getBuiltInPricing();
```

### Standalone Baseline Management

Use baseline functions independently of the reporter:

```typescript
import { saveBaseline, loadBaseline, compareBaseline, evaluateBaselineThresholds } from 'llm-cost-per-test';

// Save
saveBaseline('.cost-baseline.json', testEntries, totalCost);

// Load and compare
const baseline = loadBaseline('.cost-baseline.json');
if (baseline) {
  const diff = compareBaseline('.cost-baseline.json', baseline, currentTests, currentTotal);
  const result = evaluateBaselineThresholds(diff, {
    path: '.cost-baseline.json',
    warnThreshold: 0.10,
    failThreshold: 0.25,
  });
  if (result.fail) {
    console.error(result.message);
  }
}
```

---

## TypeScript

All public APIs ship with complete type definitions. Import types directly:

```typescript
import type {
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
} from 'llm-cost-per-test';
```

### Key Types

**`UsageInput`** -- Input for recording a single LLM API call:

```typescript
interface UsageInput {
  model: string;        // e.g., 'gpt-4o', 'claude-sonnet-4-20250514'
  inputTokens: number;  // Number of input/prompt tokens
  outputTokens: number; // Number of output/completion tokens
  cost?: number;        // Optional explicit dollar cost override
}
```

**`UsageRecord`** -- A recorded LLM API call (extends UsageInput with computed fields):

```typescript
interface UsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;         // Computed or overridden cost in USD
  timestamp: string;    // ISO 8601 timestamp
}
```

**`CostSummary`** -- Aggregated cost summary from a tracker:

```typescript
interface CostSummary {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalApiCalls: number;
  byModel: Record<string, {
    cost: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
  }>;
}
```

**`CostReport`** -- The full cost report:

```typescript
interface CostReport {
  version: number;              // Report format version (currently 1)
  createdAt: string;            // ISO 8601 timestamp
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalApiCalls: number;
  testsWithCalls: number;       // Tests that made at least one LLM call
  totalTests: number;
  tests: TestCostEntry[];
  files: FileCostEntry[];
  models: ModelCostEntry[];
  budgetViolations: BudgetViolation[];
  baselineDiff?: BaselineDiff;  // Present only when a baseline was loaded
}
```

**`ModelPricing`** -- Price per million tokens (USD):

```typescript
interface ModelPricing {
  input: number;   // USD per million input tokens
  output: number;  // USD per million output tokens
}
```

**`BudgetViolation`** -- A budget threshold exceeded:

```typescript
interface BudgetViolation {
  level: 'perTest' | 'perFile' | 'perSuite';
  name: string;        // Test name, file path, or 'suite'
  actualCost: number;
  budgetCost: number;
}
```

**`BaselineDiff`** -- Result of comparing current costs against a baseline:

```typescript
interface BaselineDiff {
  baselinePath: string;
  baselineTotalCost: number;
  currentTotalCost: number;
  costChange: number;          // Absolute change
  percentageChange: number;    // e.g., 0.15 = 15% increase
  tests: TestCostDiff[];
  newTests: TestCostEntry[];   // Tests in current run but not in baseline
  removedTests: string[];      // Test names in baseline but not in current run
}
```

---

## Built-in Model Pricing

Prices are in USD per million tokens.

| Model | Input ($/MTok) | Output ($/MTok) |
|-------|---------------|-----------------|
| `gpt-4o` | 2.50 | 10.00 |
| `gpt-4o-mini` | 0.15 | 0.60 |
| `gpt-4-turbo` | 10.00 | 30.00 |
| `gpt-4` | 30.00 | 60.00 |
| `gpt-3.5-turbo` | 0.50 | 1.50 |
| `o1` | 15.00 | 60.00 |
| `o1-mini` | 3.00 | 12.00 |
| `o3-mini` | 1.10 | 4.40 |
| `claude-opus-4-20250514` | 15.00 | 75.00 |
| `claude-sonnet-4-20250514` | 3.00 | 15.00 |
| `claude-haiku-3-20250307` | 0.80 | 4.00 |
| `claude-3-5-sonnet-20241022` | 3.00 | 15.00 |
| `claude-3-haiku-20240307` | 0.25 | 1.25 |
| `gemini-1.5-pro` | 1.25 | 5.00 |
| `gemini-1.5-flash` | 0.075 | 0.30 |
| `gemini-2.0-flash` | 0.10 | 0.40 |

Model names support prefix matching: `gpt-4o-2024-08-06` matches `gpt-4o`, `claude-3-5-sonnet-20241022-v2` matches `claude-3-5-sonnet-20241022`. The longest matching prefix is used when multiple prefixes match.

---

## License

MIT
