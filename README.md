# llm-cost-per-test

Per-test LLM API cost tracking with budgets and baseline comparison.

Track per-test-case LLM API costs, enforce dollar-denominated budgets, and detect cost regressions across runs. Zero runtime dependencies.

## Installation

```bash
npm install --save-dev llm-cost-per-test
```

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

// Generate report
const { report, violations } = reporter.finalize();
```

## API

### `createReporter(options?)`

Creates a reporter instance for tracking per-test costs.

```typescript
import { createReporter } from 'llm-cost-per-test';

const reporter = createReporter({
  output: 'table',           // 'table' | 'json' | 'markdown' | 'junit'
  outputFile: 'report.json', // write to file instead of stdout
  budget: {
    perTest: 0.50,           // fail if any test exceeds $0.50
    perFile: 2.00,           // fail if any file exceeds $2.00
    perSuite: 10.00,         // fail if total exceeds $10.00
  },
  baseline: {
    path: '.llm-cost-baseline.json',
    update: false,           // set true to save baseline
    warnThreshold: 0.10,     // warn at 10% increase
    failThreshold: 0.25,     // fail at 25% increase
  },
  pricing: {
    'my-model': { input: 5.00, output: 15.00 },  // $/MTok
  },
  topN: 10,
  showModelBreakdown: true,
  showFileBreakdown: true,
  showPerTestTable: true,
  minCostToShow: 0,
});
```

#### Reporter Methods

- `startTest(testName, filePath)` -- Begin tracking a test
- `endTest(testName)` -- Mark test as complete
- `recordApiCall(testName, model, inputTokens, outputTokens, cost?)` -- Record an LLM API call
- `getTracker(testName)` -- Get the CostTracker for a test
- `generateReport()` -- Generate a CostReport without outputting
- `finalize()` -- Generate report, output it, check budgets/baseline
- `checkBudget()` -- Check current costs against budget thresholds
- `reset()` -- Clear all tracked data

### `createCostTracker(options?)`

Creates a standalone cost tracker for manual cost tracking.

```typescript
import { createCostTracker } from 'llm-cost-per-test';

const tracker = createCostTracker();

tracker.record({
  model: 'gpt-4o',
  inputTokens: 500,
  outputTokens: 150,
});

// Or with explicit cost override:
tracker.record({
  model: 'custom-model',
  inputTokens: 1000,
  outputTokens: 200,
  cost: 0.05,
});

const summary = tracker.getCost();
console.log(summary.totalCost);      // 0.00275
console.log(summary.totalApiCalls);  // 1
console.log(summary.byModel);       // { 'gpt-4o': { cost, calls, inputTokens, outputTokens } }
```

### `calculateCost(model, inputTokens, outputTokens)`

Compute cost for a model and token counts using the built-in pricing table.

```typescript
import { calculateCost } from 'llm-cost-per-test';

const cost = calculateCost('gpt-4o', 500, 150); // $0.00275
```

### `getPrice(model)` / `registerPricing(pricing)`

Look up or register model pricing.

```typescript
import { getPrice, registerPricing } from 'llm-cost-per-test';

const price = getPrice('gpt-4o');
// { input: 2.50, output: 10.00 }  ($/MTok)

registerPricing({
  'my-fine-tuned-model': { input: 5.00, output: 15.00 },
});
```

### Budget Checking

```typescript
import { checkBudget } from 'llm-cost-per-test';

const violations = checkBudget(
  { perTest: 0.50, perSuite: 10.00 },
  testEntries,
  fileEntries,
  totalCost,
);
```

### Baseline Comparison

```typescript
import { loadBaseline, saveBaseline, compareBaseline } from 'llm-cost-per-test';

// Save baseline
saveBaseline('.llm-cost-baseline.json', testEntries, totalCost);

// Load and compare
const baseline = loadBaseline('.llm-cost-baseline.json');
if (baseline) {
  const diff = compareBaseline('.llm-cost-baseline.json', baseline, currentTests, currentTotal);
  console.log(diff.percentageChange); // e.g., 0.15 = 15% increase
}
```

### Output Formatters

```typescript
import { formatTable, formatJSON, formatMarkdown, formatJUnit } from 'llm-cost-per-test';

const tableOutput = formatTable(report, { topN: 5 });
const jsonOutput = formatJSON(report);
const mdOutput = formatMarkdown(report);
const xmlOutput = formatJUnit(report);
```

## Built-in Model Pricing

Prices in USD per million tokens (MTok):

| Model | Input | Output |
|-------|-------|--------|
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| gpt-4-turbo | $10.00 | $30.00 |
| gpt-4 | $30.00 | $60.00 |
| gpt-3.5-turbo | $0.50 | $1.50 |
| o1 | $15.00 | $60.00 |
| o1-mini | $3.00 | $12.00 |
| o3-mini | $1.10 | $4.40 |
| claude-opus-4-20250514 | $15.00 | $75.00 |
| claude-sonnet-4-20250514 | $3.00 | $15.00 |
| claude-haiku-3-20250307 | $0.80 | $4.00 |
| claude-3-5-sonnet-20241022 | $3.00 | $15.00 |
| claude-3-haiku-20240307 | $0.25 | $1.25 |
| gemini-1.5-pro | $1.25 | $5.00 |
| gemini-1.5-flash | $0.075 | $0.30 |
| gemini-2.0-flash | $0.10 | $0.40 |

Model names support prefix matching: `gpt-4o-2024-08-06` matches `gpt-4o`.

## Environment Variables

| Variable | Purpose | Values |
|----------|---------|--------|
| `LLM_COST_BUDGET_PER_TEST` | Override per-test budget | Dollar amount |
| `LLM_COST_BUDGET_PER_FILE` | Override per-file budget | Dollar amount |
| `LLM_COST_BUDGET_PER_SUITE` | Override per-suite budget | Dollar amount |
| `LLM_COST_UPDATE_BASELINE` | Update baseline file | `1`, `true`, `yes` |
| `LLM_COST_OUTPUT` | Override output format | `table`, `json`, `markdown`, `junit` |
| `LLM_COST_OUTPUT_FILE` | Override output file path | File path |

## License

MIT
