# llm-cost-per-test -- Implementation Tasks

This file tracks all implementation tasks derived from SPEC.md. Each task is granular, actionable, and maps to a specific feature, configuration option, error handling case, or edge case from the spec.

---

## Phase 1: Project Scaffolding and Type Definitions

- [ ] **Install dev dependencies** -- Add `typescript`, `vitest`, `eslint`, `openai`, and `@anthropic-ai/sdk` as devDependencies in `package.json`. Add `model-price-registry` as an optional peerDependency. | Status: not_done
- [ ] **Configure ESLint** -- Add an ESLint configuration file appropriate for a TypeScript project. Ensure `npm run lint` works. | Status: not_done
- [ ] **Create `src/types.ts`** -- Define all public TypeScript interfaces and types: `CostReporterOptions`, `OutputFormat`, `CostBudget`, `BaselineConfig`, `ModelPricing`, `TrackerOptions`, `CostReport`, `TestCostEntry`, `UsageRecord`, `CostSummary`, `FileCostEntry`, `ModelCostEntry`, `BudgetViolation`, `BaselineDiff`, `TestCostDiff`, `CostBaseline`, `CostTracker`, `UsageInput`, `HTTPInterceptionOptions`. All JSDoc comments as specified in section 10. | Status: not_done
- [ ] **Create directory structure** -- Create the following directories: `src/interception/`, `src/output/`, `src/__tests__/`, `src/__tests__/output/`. | Status: not_done

---

## Phase 2: Pricing Module

- [ ] **Implement built-in pricing table (`src/pricing.ts`)** -- Create the pricing table covering all models listed in section 6: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo`, `o1`, `o1-mini`, `o3-mini`, `claude-opus-4-20250514`, `claude-sonnet-4-20250514`, `claude-haiku-3-20250307`, `claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307`, `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0-flash`. Prices in USD per million tokens. | Status: not_done
- [ ] **Implement `getPrice(model)` with prefix matching** -- Look up pricing by model name. Strip dated suffixes (e.g., `gpt-4o-2024-08-06` matches `gpt-4o`). Return `{ input, output }` or `null` if not found. | Status: not_done
- [ ] **Implement custom pricing merge** -- Accept a `Record<string, ModelPricing>` from user configuration and merge it with the built-in table, with custom prices taking precedence. | Status: not_done
- [ ] **Implement `model-price-registry` fallback** -- When a model is not found in the built-in table or custom pricing, attempt to load `model-price-registry` (optional peer dep) and call `getPrice(model)`. If the package is not installed, skip gracefully. | Status: not_done
- [ ] **Handle unknown models** -- When a model has no pricing in any source, return `{ input: 0, output: 0 }` and emit a warning that the model's pricing is unknown. | Status: not_done
- [ ] **Write `src/__tests__/pricing.test.ts`** -- Tests for: known model pricing lookup, prefix matching with dated suffixes, custom pricing override, unknown model returns zero with warning, zero tokens produce zero cost, large token counts have no overflow or precision issues. | Status: not_done

---

## Phase 3: Cost Tracker

- [ ] **Implement `CostTracker` class (`src/tracker.ts`)** -- Accumulates `UsageRecord` entries. Methods: `record(usage: UsageInput)`, `getCost(): CostSummary`, `getEntries(): ReadonlyArray<UsageRecord>`, `reset()`. Uses `getPrice()` from `pricing.ts` to compute cost for each record. Supports explicit cost override via `usage.cost`. | Status: not_done
- [ ] **Implement cost computation in `record()`** -- Apply formula: `(inputTokens / 1_000_000 * inputPricePerMTok) + (outputTokens / 1_000_000 * outputPricePerMTok)`. If `usage.cost` is provided, use it instead of computing. | Status: not_done
- [ ] **Implement `getCost()` aggregation** -- Return `CostSummary` with `totalCost`, `totalInputTokens`, `totalOutputTokens`, `totalApiCalls`, and `byModel` breakdown (cost, calls, inputTokens, outputTokens per model). | Status: not_done
- [ ] **Implement `createCostTracker(options?)` factory** -- Factory function that creates a `CostTracker` instance, optionally with custom pricing. When used inside a test context, automatically associates with the current test's `AsyncLocalStorage` context. | Status: not_done
- [ ] **Add timestamp to UsageRecord** -- Each recorded entry gets an ISO 8601 timestamp at the time of recording. | Status: not_done
- [ ] **Write `src/__tests__/tracker.test.ts`** -- Tests for: single entry recording, multiple entries summing, different models in `byModel` breakdown, `reset()` clears all data, `getEntries()` returns entries in order, manual cost override, zero tokens, large token counts. | Status: not_done

---

## Phase 4: AsyncLocalStorage Context

- [ ] **Implement `AsyncLocalStorage` singleton (`src/context.ts`)** -- Create and export an `AsyncLocalStorage<CostTracker>` instance. Provide `getActiveTracker()` to get the current test's tracker (returns `undefined` if outside a test context). | Status: not_done
- [ ] **Implement `runWithTracker(tracker, fn)`** -- Wraps a function execution inside `asyncLocalStorage.run(tracker, fn)` so all async code within `fn` has access to the tracker. | Status: not_done
- [ ] **Implement `getCostForCurrentTest()`** -- Returns the accumulated `CostSummary` for the currently executing test by reading the active tracker from `AsyncLocalStorage`. Returns `null` when called outside a test context. | Status: not_done
- [ ] **Handle unattributed usage** -- When `getActiveTracker()` returns `undefined` (code running outside any test, e.g., `beforeAll`, module initialization), record usage to a separate "unattributed" bucket. | Status: not_done
- [ ] **Write `src/__tests__/context.test.ts`** -- Tests for: two concurrent async operations each record to their own tracker, deeply nested async calls propagate the tracker, no active context returns null/undefined, context isolation between tests. | Status: not_done

---

## Phase 5: SDK Interception

- [ ] **Implement `trackLLMCost(client)` (`src/interception/sdk.ts`)** -- Accept an LLM SDK client object and return a deeply nested `Proxy` that intercepts API call methods while preserving the original type signature (`trackLLMCost<T>(client: T): T`). | Status: not_done
- [ ] **Implement OpenAI `chat.completions.create` interception** -- Intercept calls, invoke the original method, read `response.usage.prompt_tokens` and `response.usage.completion_tokens`, compute cost, record on the active tracker via `AsyncLocalStorage`. Return the original response unchanged. | Status: not_done
- [ ] **Implement OpenAI `completions.create` interception** -- Same pattern as chat completions: read `response.usage.prompt_tokens` and `response.usage.completion_tokens`. | Status: not_done
- [ ] **Implement OpenAI `embeddings.create` interception** -- Read `response.usage.prompt_tokens` and `response.usage.total_tokens` (output tokens = total - prompt). | Status: not_done
- [ ] **Implement Anthropic `messages.create` interception** -- Read `response.usage.input_tokens` and `response.usage.output_tokens`. | Status: not_done
- [ ] **Implement OpenAI streaming response interception** -- Wrap the returned stream/async iterator. Detect the final chunk with `usage` field (when `stream_options.include_usage: true`). Record usage from the final chunk. If no usage data in stream, record zero tokens with a warning. | Status: not_done
- [ ] **Implement Anthropic `messages.stream` interception** -- Wrap the stream. Accumulate `input_tokens` from `message_start` event and `output_tokens` from `message_delta` event (with `stop_reason`). Record combined usage. | Status: not_done
- [ ] **Handle API call errors in SDK interception** -- If the original API call throws, propagate the error to the caller without recording any usage. | Status: not_done
- [ ] **Extract model name from SDK calls** -- Read the `model` parameter from the request arguments to determine which model pricing to use. | Status: not_done
- [ ] **Write `src/__tests__/sdk-interception.test.ts`** -- Tests for: proxy returns object behaving identically to original, non-streaming usage captured from OpenAI response, non-streaming usage captured from Anthropic response, streaming with usage captures final chunk, Anthropic streaming accumulates from multiple events, return value is unmodified, error propagation with no usage recorded, embeddings usage captured. | Status: not_done

---

## Phase 6: HTTP Interception

- [ ] **Implement provider URL patterns (`src/interception/providers.ts`)** -- Define regex patterns for known LLM endpoints: `api.openai.com/v1/chat/completions`, `api.openai.com/v1/completions`, `api.openai.com/v1/embeddings`, `api.anthropic.com/v1/messages`, `generativelanguage.googleapis.com/v1beta/models/*/generateContent`, `*.openai.azure.com/openai/deployments/*/chat/completions*`. | Status: not_done
- [ ] **Implement provider-specific response parsers** -- Extract model name and usage from each provider's response format: OpenAI (`usage.prompt_tokens`/`usage.completion_tokens`), Anthropic (`usage.input_tokens`/`usage.output_tokens`), Google (`usageMetadata.promptTokenCount`/`usageMetadata.candidatesTokenCount`). | Status: not_done
- [ ] **Implement `enableHTTPInterception()` (`src/interception/http.ts`)** -- Save original `globalThis.fetch`, replace with wrapper that inspects outgoing request URLs against provider patterns. | Status: not_done
- [ ] **Implement `disableHTTPInterception()`** -- Restore original `globalThis.fetch`. | Status: not_done
- [ ] **Implement non-streaming response interception** -- For matching URLs with non-streaming responses: clone response via `response.clone()`, read clone as JSON, extract usage field, compute cost, record on active tracker. Return original unconsumed response to caller. | Status: not_done
- [ ] **Implement streaming response interception** -- For matching URLs with streaming responses (`Content-Type: text/event-stream`): use `TransformStream` tee to inspect chunks. For OpenAI: detect final chunk with `usage`. For Anthropic: detect `message_delta` with `usage`. Record extracted usage. | Status: not_done
- [ ] **Handle streaming without usage data** -- If a streaming response completes without any usage data found (e.g., `stream_options.include_usage` not set), record with zero tokens and emit a warning. | Status: not_done
- [ ] **Pass through non-LLM requests** -- If the request URL does not match any known LLM provider pattern, pass the request through to the original fetch unmodified. | Status: not_done
- [ ] **Support custom provider patterns** -- Accept `HTTPInterceptionOptions.providerPatterns` to add additional URL patterns beyond the built-in set. | Status: not_done
- [ ] **Extract model name from request body** -- Parse the request body to extract the `model` field for cost calculation. Fall back to extracting from the response body if not found in the request. | Status: not_done
- [ ] **Write `src/__tests__/http-interception.test.ts`** -- Tests for: `enableHTTPInterception` patches fetch, `disableHTTPInterception` restores original, OpenAI endpoint has usage extracted, non-LLM endpoint passes through unmodified, streaming response with usage extracted from final chunk, streaming without usage records zero with warning, concurrent fetch calls attributed to correct test via AsyncLocalStorage, Google endpoint usage extraction, Azure OpenAI endpoint matching. | Status: not_done

---

## Phase 7: Reporter (Jest and Vitest)

- [ ] **Implement `LLMCostReporter` class (`src/reporter.ts`)** -- Single class implementing both Jest Reporter and Vitest Reporter interfaces. Constructor accepts `(globalConfig: unknown, reporterOptions: CostReporterOptions)`. | Status: not_done
- [ ] **Implement Jest reporter hooks** -- `onRunStart`: initialize AsyncLocalStorage, activate HTTP interception if configured. `onTestStart`: create CostTracker for the test, enter AsyncLocalStorage context. `onTestResult`: finalize tracker, collect cost data. `onRunComplete`: aggregate all data, produce report, check budgets. | Status: not_done
- [ ] **Implement Vitest reporter hooks** -- `onInit(ctx)`: store Vitest context, initialize. `onTestStart`: create tracker. `onTestEnd`: finalize tracker. `onFinished(files, errors)`: aggregate, report, check budgets. | Status: not_done
- [ ] **Implement configuration resolution** -- Merge built-in defaults, reporter options, and environment variables in that priority order. Environment variables: `LLM_COST_OUTPUT`, `LLM_COST_OUTPUT_FILE`, `LLM_COST_BUDGET_PER_TEST`, `LLM_COST_BUDGET_PER_FILE`, `LLM_COST_BUDGET_PER_SUITE`, `LLM_COST_UPDATE_BASELINE`. | Status: not_done
- [ ] **Implement interception mode selection** -- Based on `interception` option (`'auto'`, `'sdk'`, `'manual'`, `'off'`): `auto` enables HTTP interception automatically, `sdk` only tracks via `trackLLMCost()`, `manual` only tracks via `createCostTracker()`, `off` disables all interception. | Status: not_done
- [ ] **Implement cost data aggregation** -- At `onRunComplete`/`onFinished`: compute per-file aggregates (`FileCostEntry[]`), per-model aggregates (`ModelCostEntry[]` with percentages), total suite cost, tests with calls count, total API calls count. | Status: not_done
- [ ] **Implement report generation dispatch** -- Based on `output` format, delegate to the appropriate formatter (table, json, markdown, junit). Write to `outputFile` if configured, otherwise stdout. | Status: not_done
- [ ] **Implement exit code on budget violation** -- For Jest: set `process.exitCode = 1`. For Vitest: throw from `onFinished` hook. Ensure full report is still printed before failure. | Status: not_done
- [ ] **Handle test with no LLM calls** -- Tests that make no LLM API calls appear in the report with $0.00 cost. | Status: not_done
- [ ] **Handle empty test run** -- If no test events are received, produce an empty report (zero tests, zero cost). | Status: not_done
- [ ] **Handle reporter shutdown before completion** -- If the framework shuts down before `onRunComplete`, do not crash. Data is lost gracefully. | Status: not_done
- [ ] **Write `src/__tests__/reporter.test.ts`** -- Tests for: full Jest lifecycle simulation (start, test result, complete), full Vitest lifecycle simulation, configuration resolution with env vars overriding options, interception mode selection, empty test run, cost data aggregation correctness. | Status: not_done

---

## Phase 8: Budget Enforcement

- [ ] **Implement budget evaluation logic (`src/budget.ts`)** -- Accept cost data and budget configuration. Evaluate per-test, per-file, and per-suite budgets. Return `BudgetViolation[]`. | Status: not_done
- [ ] **Implement per-test budget check** -- Iterate all test cost entries. If any test's cost exceeds `budget.perTest`, create a `BudgetViolation` with `level: 'perTest'`, the test name, actual cost, and budget threshold. | Status: not_done
- [ ] **Implement per-file budget check** -- Aggregate cost per file. If any file's total cost exceeds `budget.perFile`, create a `BudgetViolation` with `level: 'perFile'`. | Status: not_done
- [ ] **Implement per-suite budget check** -- If total suite cost exceeds `budget.perSuite`, create a `BudgetViolation` with `level: 'perSuite'`. | Status: not_done
- [ ] **Report all violations, not just the first** -- Collect and return all violations found across all budget levels. | Status: not_done
- [ ] **Implement environment variable budget overrides** -- Read `LLM_COST_BUDGET_PER_TEST`, `LLM_COST_BUDGET_PER_FILE`, `LLM_COST_BUDGET_PER_SUITE` from `process.env`. Parse as floats. Override reporter option values. | Status: not_done
- [ ] **Format budget violation messages** -- Produce clear error messages identifying the offending test/file/suite, actual cost, budget threshold, API calls, token counts, and model. Match the format shown in section 8 of the spec. | Status: not_done
- [ ] **Write `src/__tests__/budget.test.ts`** -- Tests for: per-test exceeded, per-test not exceeded, per-file exceeded, per-suite exceeded, multiple violations all reported, budget from env var overrides options, no budget configured returns no violations. | Status: not_done

---

## Phase 9: Baseline Comparison

- [ ] **Implement baseline file reading (`src/baseline.ts`)** -- Read a JSON file matching the `CostBaseline` schema. Handle file-not-found gracefully (no baseline, no diff). | Status: not_done
- [ ] **Handle corrupt baseline file** -- If the baseline file exists but contains invalid JSON, emit a clear error message and continue the run without baseline comparison (do not crash). | Status: not_done
- [ ] **Implement baseline file writing** -- When `baseline.update` is `true` (or `LLM_COST_UPDATE_BASELINE=1`/`true`/`yes`), write the current run's cost data to the baseline file in `CostBaseline` format with `version: 1`, `createdAt` timestamp, `totalCost`, and per-test entries keyed by test name. | Status: not_done
- [ ] **Implement cost diff computation** -- Compare current run's per-test costs against baseline. Compute absolute and percentage change for each test. Identify new tests (in current but not baseline) and removed tests (in baseline but not current). Compute total cost change. | Status: not_done
- [ ] **Implement warn threshold evaluation** -- If total cost percentage increase exceeds `warnThreshold` but not `failThreshold`, emit a warning but do not fail the run. | Status: not_done
- [ ] **Implement fail threshold evaluation** -- If total cost percentage increase exceeds `failThreshold`, fail the run with a clear message: "Total cost increased by X% (from $Y to $Z), exceeding the fail threshold of W%." | Status: not_done
- [ ] **Produce `BaselineDiff` report data** -- Populate `BaselineDiff` with `baselinePath`, `baselineTotalCost`, `currentTotalCost`, `costChange`, `percentageChange`, per-test diffs (`TestCostDiff[]`), `newTests`, `removedTests`. Include in the `CostReport`. | Status: not_done
- [ ] **Write `src/__tests__/baseline.test.ts`** -- Tests for: no baseline file (no diff), baseline exists with unchanged costs (zero diffs), costs increased (positive diff with percentage), costs decreased (negative diff), new tests marked `[NEW]`, removed tests marked `[REMOVED]`, warn threshold triggers warning without failure, fail threshold triggers failure, `update: true` overwrites baseline file, corrupt baseline JSON produces error and continues. | Status: not_done

---

## Phase 10: Output Formatters

### Terminal Table

- [ ] **Implement terminal table formatter (`src/output/table.ts`)** -- Produce the per-test cost breakdown table with columns: Test, Model, In Tok, Out Tok, Cost. Format numbers with commas. Right-align numeric columns. | Status: not_done
- [ ] **Implement suite summary section** -- Total tests with LLM calls, total API calls, total input/output tokens, total cost, most expensive test, most expensive file. | Status: not_done
- [ ] **Implement top-N most expensive tests section** -- Ranked list with rank number, test name, cost, and percentage of total. Number of items controlled by `topN` option. | Status: not_done
- [ ] **Implement cost-by-model breakdown section** -- Table with model name, total cost, percentage of total, number of API calls. Controlled by `showModelBreakdown` option. | Status: not_done
- [ ] **Implement cost-by-file breakdown section** -- Table with file path, total cost, test count. Controlled by `showFileBreakdown` option. | Status: not_done
- [ ] **Implement ANSI color support** -- Green for under budget, yellow for approaching budget, red for violations. Disable colors when `NO_COLOR` env var is set, stdout is not a TTY, or `--no-color` flag is present. | Status: not_done
- [ ] **Implement `minCostToShow` filtering** -- Tests below `minCostToShow` threshold are grouped as "other" in the per-test table. Controlled by `showPerTestTable` option. | Status: not_done
- [ ] **Implement baseline diff table in terminal output** -- When baseline data is available, show the cost diff table with Baseline, Current, and Diff columns. Mark changes with `!!` for increases above warning threshold. Mark `[NEW]` and `[REMOVED]` tests. | Status: not_done

### JSON Output

- [ ] **Implement JSON formatter (`src/output/json.ts`)** -- Serialize the full `CostReport` object to JSON. Match the schema shown in section 12. Include all fields: `version`, `createdAt`, totals, `tests[]`, `files[]`, `models[]`, `budgetViolations[]`, `baselineDiff`. | Status: not_done

### Markdown Output

- [ ] **Implement Markdown formatter (`src/output/markdown.ts`)** -- Generate Markdown with: `## LLM Cost Report` heading, per-test table with columns (Test, Model, Tokens in/out, Cost), total summary line, and optional baseline diff table (`### Cost Diff vs. Baseline`). Designed for GitHub PR comments. | Status: not_done

### JUnit XML Output

- [ ] **Implement JUnit XML formatter (`src/output/junit.ts`)** -- Generate XML `<testcase>` elements with `<properties>` containing `llm.cost`, `llm.inputTokens`, `llm.outputTokens`, `llm.apiCalls`, `llm.model`. Compatible with CI dashboard JUnit parsers. | Status: not_done

### Output Format Tests

- [ ] **Write `src/__tests__/output/table.test.ts`** -- Verify terminal table formatting: correct column alignment, number formatting, summary sections, top-N list, color codes present/absent based on TTY/NO_COLOR. | Status: not_done
- [ ] **Write `src/__tests__/output/json.test.ts`** -- Verify JSON output is valid JSON matching `CostReport` schema. All fields present and correctly typed. | Status: not_done
- [ ] **Write `src/__tests__/output/markdown.test.ts`** -- Verify Markdown output contains valid Markdown tables, headings, and formatting. | Status: not_done
- [ ] **Write `src/__tests__/output/junit.test.ts`** -- Verify JUnit XML output is valid XML with correct `<properties>` elements. | Status: not_done

---

## Phase 11: llm-vcr Integration

- [ ] **Implement cassette reader (`src/vcr-integration.ts`)** -- Read cassette files from the configured `cassettesDir`. Extract token usage from cassette entry metadata fields: `costEstimate.inputTokens`, `costEstimate.outputTokens`. Extract model name from cassette entries. | Status: not_done
- [ ] **Feed cassette cost data into CostTracker** -- When in replay mode (no real API calls), create `UsageRecord` entries from cassette metadata and record them on the appropriate test's tracker. | Status: not_done
- [ ] **Handle recording mode** -- When `llm-vcr` is in `record` or `auto` mode (real API calls), let normal interception handle cost tracking. Do not double-count from both interception and cassettes. | Status: not_done
- [ ] **Write `src/__tests__/vcr-integration.test.ts`** -- Tests for: reading cassette files, extracting cost metadata, feeding into tracker, replay mode cost reporting, no double-counting in record mode. | Status: not_done

---

## Phase 12: Entry Point and Public API

- [ ] **Update `src/index.ts` with all exports** -- Export `LLMCostReporter` as both named and default export. Export `trackLLMCost`, `createCostTracker`, `getCostForCurrentTest`, `enableHTTPInterception`, `disableHTTPInterception`. Export all types listed in section 10 as type exports. | Status: not_done
- [ ] **Verify type definitions compile correctly** -- Run `tsc` and verify `dist/index.d.ts` contains all expected type exports. Verify consumers can import all public APIs with correct types. | Status: not_done

---

## Phase 13: Integration Tests

- [ ] **Write `src/__tests__/integration.test.ts` -- Mock HTTP server test** -- Create a local HTTP server (`node:http`) that returns realistic LLM API responses with usage fields. Make fetch calls to the mock server with HTTP interception enabled. Verify costs are recorded correctly. | Status: not_done
- [ ] **Integration test: SDK wrapping end-to-end** -- Wrap a mock OpenAI client, call it against a mock HTTP server, verify cost appears in the report. | Status: not_done
- [ ] **Integration test: concurrent test attribution** -- Simulate two tests running concurrently, each making LLM calls via intercepted fetch, verify costs are attributed to the correct test. | Status: not_done
- [ ] **Integration test: budget failure end-to-end** -- Configure a per-test budget, run a test that exceeds it, verify the reporter signals failure. | Status: not_done
- [ ] **Integration test: baseline round-trip** -- Save a baseline, modify costs, compare, verify the diff report is correct. | Status: not_done
- [ ] **Integration test: full reporter lifecycle with Jest hooks** -- Simulate the Jest reporter lifecycle (onRunStart, onTestStart, onTestResult, onRunComplete) with mock data, verify the complete cost report is produced. | Status: not_done
- [ ] **Integration test: full reporter lifecycle with Vitest hooks** -- Same as above but with Vitest reporter hooks (onInit, onTestStart, onTestEnd, onFinished). | Status: not_done

---

## Phase 14: Edge Cases and Error Handling

- [ ] **Handle LLM response with no `usage` field** -- Record with zero tokens and emit a warning. Do not crash. | Status: not_done
- [ ] **Handle empty or null model name** -- Compute cost as zero and emit a warning. | Status: not_done
- [ ] **Handle very large number of API calls in a single test (100+)** -- Ensure no performance degradation. UsageRecord array should handle this without issues. | Status: not_done
- [ ] **Handle two reporters configured simultaneously** -- Each reporter instance operates independently with its own state. | Status: not_done
- [ ] **Handle test framework shutdown before `onRunComplete`** -- Partial data is not written. No crash occurs. | Status: not_done
- [ ] **Handle `response.clone()` failure in HTTP interception** -- If cloning fails, log a warning and pass through the original response without recording usage. | Status: not_done
- [ ] **Handle non-JSON response body from LLM endpoint** -- If the response body cannot be parsed as JSON, log a warning and skip usage extraction. | Status: not_done

---

## Phase 15: Configuration and Environment Variables

- [ ] **Implement all environment variable overrides** -- Support `LLM_COST_BUDGET_PER_TEST`, `LLM_COST_BUDGET_PER_FILE`, `LLM_COST_BUDGET_PER_SUITE` (dollar amounts), `LLM_COST_UPDATE_BASELINE` (`1`, `true`, `yes`), `LLM_COST_OUTPUT` (`table`, `json`, `markdown`, `junit`), `LLM_COST_OUTPUT_FILE` (file path). All override reporter options. | Status: not_done
- [ ] **Implement configuration defaults** -- All defaults as specified in section 13: `output: 'table'`, `outputFile: undefined`, `budget: {}`, `baseline: { update: false, warnThreshold: 0.10, failThreshold: 0.25 }`, `pricing: {}`, `interception: 'auto'`, `topN: 10`, `showModelBreakdown: true`, `showFileBreakdown: true`, `showPerTestTable: true`, `minCostToShow: 0`, `vcr: undefined`. | Status: not_done
- [ ] **Implement 3-level configuration resolution** -- Built-in defaults (lowest) -> reporter options -> environment variables (highest). | Status: not_done

---

## Phase 16: Provider-Specific Token Normalization

- [ ] **Normalize OpenAI usage format** -- Map `usage.prompt_tokens` to `inputTokens` and `usage.completion_tokens` to `outputTokens`. Handle `prompt_tokens_details` and `completion_tokens_details` fields (read but not required). | Status: not_done
- [ ] **Normalize Anthropic usage format** -- Map `usage.input_tokens` to `inputTokens` and `usage.output_tokens` to `outputTokens`. Handle `cache_creation_input_tokens` and `cache_read_input_tokens` fields (read but not required). | Status: not_done
- [ ] **Normalize Google usage format** -- Map `usageMetadata.promptTokenCount` to `inputTokens` and `usageMetadata.candidatesTokenCount` to `outputTokens`. | Status: not_done
- [ ] **Handle tool call tokens** -- No special handling needed; tool call tokens are included in the provider's `usage` field. Verify this works correctly with multi-turn tool-calling responses. | Status: not_done

---

## Phase 17: Documentation

- [ ] **Write README.md** -- Quick start guide, installation instructions, Jest and Vitest configuration examples, API reference for all public exports (`LLMCostReporter`, `trackLLMCost`, `createCostTracker`, `getCostForCurrentTest`, `enableHTTPInterception`, `disableHTTPInterception`), configuration options table, environment variables table, output format examples, budget enforcement examples, baseline comparison examples, llm-vcr integration example. | Status: not_done
- [ ] **Add JSDoc comments to all public exports** -- Every exported function, class, interface, and type should have JSDoc comments matching the descriptions in the spec. | Status: not_done
- [ ] **Version bump `package.json`** -- Ensure version is set appropriately for the release phase (start at `0.1.0` for Phase 1, bump per phase as features land). | Status: not_done

---

## Phase 18: Build, Lint, and CI Readiness

- [ ] **Verify `npm run build` succeeds** -- `tsc` compiles without errors. `dist/` contains all expected `.js`, `.d.ts`, and `.js.map` files. | Status: not_done
- [ ] **Verify `npm run lint` passes** -- No ESLint errors or warnings. | Status: not_done
- [ ] **Verify `npm run test` passes** -- All unit and integration tests pass via `vitest run`. | Status: not_done
- [ ] **Verify `package.json` `files` field** -- Only `dist` is included in the published package. Source files, tests, and spec are excluded. | Status: not_done
- [ ] **Verify `package.json` `main` and `types` fields** -- `main` points to `dist/index.js`, `types` points to `dist/index.d.ts`. | Status: not_done
- [ ] **Verify default export** -- `LLMCostReporter` is the default export so test runner `reporters` arrays can reference the module path directly. | Status: not_done
