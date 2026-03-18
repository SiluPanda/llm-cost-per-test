# llm-cost-per-test -- Specification

## 1. Overview

`llm-cost-per-test` is a Jest/Vitest reporter plugin that tracks and reports per-test-case LLM API costs in CI. It intercepts LLM API calls during test execution, extracts token usage from API responses, computes cost using model-specific pricing, attributes costs to the specific test case that triggered each call, and produces detailed cost reports -- per-test breakdowns, per-file summaries, per-model aggregates, top-N most expensive tests, and total suite cost. It enforces cost budgets by failing CI when a test, file, or suite exceeds a configured dollar threshold. It compares current costs against a saved baseline to detect cost regressions across pull requests.

The gap this package fills is specific and well-defined. Cost tracking tools for LLM APIs exist as runtime libraries and hosted observability platforms. Helicone intercepts API calls via a proxy and provides a dashboard with per-request cost tracking, but it is a hosted service that requires routing all API traffic through its proxy -- it knows nothing about test cases, test files, or test suites. Langfuse provides tracing and cost tracking with an SDK integration, but it is also a hosted platform focused on production observability, not test-runner integration. The `tokenscost` npm package computes cost from token counts but does not intercept API calls, does not integrate with test runners, and does not attribute costs to tests. The stale `llm-cost` package provides basic token-to-cost calculation but is unmaintained. `model-price-registry` in this monorepo provides a pricing database but no interception or reporting.

None of these tools answer the questions that matter during test development and CI: "Which test case in my eval suite costs the most?" "Did this PR increase eval costs?" "Which tests should I optimize first to reduce my $50/day CI bill?" "Is any single test accidentally calling GPT-4 in a loop?" These questions require a tool that operates at the test-runner level -- one that knows about test cases, test files, describe blocks, and test suites, and can attribute LLM API costs to those units.

`llm-cost-per-test` provides this missing integration. It is a test runner reporter -- a plugin that hooks into Jest's or Vitest's test lifecycle events (`onTestStart`, `onTestResult`, `onRunComplete`) -- combined with a token interception layer that captures LLM API token usage during each test's execution. The interception uses `AsyncLocalStorage` to maintain a per-test cost accumulator that follows async call chains, so when a test calls an LLM API (directly or through layers of application code), the token usage is attributed to the correct test. The reporter collects all per-test cost data and produces formatted output: terminal tables during local development, JSON files for CI processing, Markdown for PR comments, and budget-violation exit codes for CI gating.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `LLMCostReporter` class that implements both the Jest Reporter interface and the Vitest Reporter interface, installable via the test runner's `reporters` configuration array.
- Track per-test-case LLM API costs by intercepting token usage from API responses and attributing each call to the currently executing test using `AsyncLocalStorage`.
- Support three interception methods: SDK wrapping (wrap OpenAI/Anthropic client methods), HTTP interception (intercept `globalThis.fetch` to capture response token usage from known LLM provider endpoints), and manual tracking (a `trackCost()` function for custom integrations).
- Compute cost using the formula `(input_tokens * input_price_per_token) + (output_tokens * output_price_per_token)`, with a built-in model pricing table that covers current OpenAI, Anthropic, and Google models. Integrate with `model-price-registry` from this monorepo for pricing data when available.
- Support streaming responses: accumulate token usage from stream completion events (OpenAI's final chunk with `usage`, Anthropic's `message_delta` with `usage`).
- Produce four output formats: terminal table (default, for local development), JSON file (for CI pipelines and downstream processing), Markdown (for PR comment generation), and JUnit XML annotations (for CI dashboard integration).
- Enforce cost budgets at three levels: per-test (fail if any single test exceeds a dollar threshold), per-file (fail if any test file exceeds a threshold), and per-suite (fail if the total test run exceeds a threshold). Budget violations produce non-zero exit codes.
- Support baseline comparison: save a cost report as a baseline file, compare subsequent runs against the baseline, report which tests increased or decreased in cost, and fail if cost increase exceeds a configured percentage threshold.
- Provide a `trackLLMCost(client)` function that wraps an LLM SDK client with cost tracking, returning a typed proxy that behaves identically to the original client.
- Provide a `createCostTracker(options?)` function for manual cost tracking in custom integrations, returning a `CostTracker` with `record(usage)` and `getCost()` methods.
- Provide a `getCostForCurrentTest()` function that returns the accumulated cost for the currently executing test, enabling in-test cost assertions.
- Read token usage from `llm-vcr` cassette metadata when running in replay mode, so cost reports are available even when no real API calls are made.
- Ship complete TypeScript type definitions for all public APIs, configuration objects, and report types.
- Keep runtime dependencies at zero beyond Node.js built-ins. LLM provider SDKs are not dependencies -- interception works via method wrapping and fetch patching.

### Non-Goals

- **Not an LLM client library.** This package does not call LLMs, construct prompts, or manage conversations. It observes and measures calls made by existing application code. For LLM client functionality, use the OpenAI SDK, Anthropic SDK, or LangChain.
- **Not an observability platform.** This package produces reports at test-run granularity. It does not provide dashboards, time-series storage, alerting, or production monitoring. For hosted observability, use Helicone, Langfuse, or OpenLLMetry.
- **Not a token counter.** This package reads token counts from API responses (where the LLM provider reports actual token usage). It does not count tokens locally using tokenizer libraries. For local token estimation, use `tiktoken` or `@anthropic-ai/tokenizer`.
- **Not a cost optimization tool.** This package reports costs and enforces budgets. It does not suggest prompt changes, model substitutions, or caching strategies to reduce costs. The cost data it produces informs optimization decisions made by the developer.
- **Not a billing reconciliation tool.** Cost calculations use published per-token pricing and may differ from actual invoiced amounts due to volume discounts, committed-use agreements, cached input discounts, or pricing changes. The costs are estimates for comparison and budgeting, not invoicing.
- **Not an HTTP recording library.** This package intercepts HTTP calls to extract token usage metadata from LLM API responses; it does not record or replay full request-response pairs. For recording and replay, use `llm-vcr` from this monorepo.

---

## 3. Target Users and Use Cases

### Eval Suite Operators Managing CI Costs

Teams running LLM evaluation suites in CI face a bill that grows with every test added and every model upgrade. A 200-test eval suite calling GPT-4o costs $3-10 per run. Running it 20 times per day across branches costs $60-200 per day. These teams need visibility into which tests cost the most so they can optimize or downgrade the expensive ones. They configure `llm-cost-per-test` as a reporter, get a cost breakdown in every CI run, and set a per-suite budget of $15 that fails the build if exceeded.

### PR Reviewers Evaluating Cost Impact

When a developer adds new eval tests or changes prompts, the PR review should include the cost impact. Does this change add $0.50/run or $5.00/run? Are the new tests using GPT-4 when GPT-4o-mini would suffice? Reviewers look at the cost diff in the PR comment (generated by `llm-cost-per-test`'s Markdown output) and make informed decisions about whether the cost increase is justified.

### Prompt Engineers Optimizing Eval Costs

Prompt engineers iterating on prompts need rapid feedback on how prompt changes affect cost. Shortening a system prompt saves input tokens. Switching from GPT-4 to Claude Haiku for classification tests saves 10x. Using structured output mode reduces output token waste. The per-test cost breakdown shows exactly how much each change saves, enabling data-driven optimization.

### Platform Teams Setting Cost Guardrails

Platform teams providing shared infrastructure for AI development need guardrails that prevent runaway costs. A developer accidentally calling GPT-4 in a loop inside a test can consume hundreds of dollars before anyone notices. Per-test cost budgets catch this immediately: any single test exceeding $0.50 fails CI with a clear error message identifying the offending test and its actual cost.

### Teams Using llm-vcr for Replay-Mode Cost Reporting

Teams that record LLM API calls with `llm-vcr` and replay them in CI still want to know the cost of their eval suite -- not the cost of the current CI run (which is zero, since everything is replayed), but the cost that would be incurred if running against live APIs. `llm-cost-per-test` reads token usage from `llm-vcr` cassette metadata and reports the cost as if the calls were live, enabling cost tracking and budget enforcement even in replay-only environments.

---

## 4. Core Concepts

### Reporter

A test runner reporter is a plugin that receives lifecycle events from the test framework: test start, test pass, test fail, suite start, suite end, run complete. Jest reporters implement a class with `onTestStart`, `onTestResult`, `onTestSuiteResult`, and `onRunComplete` methods. Vitest reporters implement a similar interface with `onTestStart`, `onTestEnd`, `onFinished`, and other hooks. `LLMCostReporter` implements both interfaces, using the lifecycle events to demarcate test boundaries for cost attribution and to produce the final cost report when the run completes.

### Cost Tracker

A cost tracker is an accumulator that collects token usage records during a test's execution and computes the total cost. Each test gets its own `CostTracker` instance, created when the test starts and finalized when the test ends. The tracker stores an array of `UsageRecord` entries, each representing one LLM API call with its model, input tokens, output tokens, and computed cost. The tracker computes aggregates: total cost, total input tokens, total output tokens, total API calls, and cost breakdown by model.

### Token Interception

Token interception is the mechanism by which `llm-cost-per-test` captures token usage from LLM API calls without requiring the test author to modify their application code. Three interception methods are supported:

- **SDK wrapping**: Wraps LLM provider client methods (e.g., `openai.chat.completions.create`) with a proxy that records the `usage` field from the API response before returning it to the caller.
- **HTTP interception**: Patches `globalThis.fetch` to intercept responses from known LLM provider endpoints, reads the response body (cloned, so the original is not consumed), and extracts the `usage` field.
- **Manual tracking**: A `trackCost()` function that the test author calls explicitly with token usage data, for integrations where automatic interception is not possible.

All three methods feed into the same per-test `CostTracker` via `AsyncLocalStorage`.

### Per-Test Attribution

The fundamental challenge of per-test cost tracking is attribution: when an LLM API call completes, which test triggered it? Tests may run concurrently (Vitest's default), and the API call may be separated from the test by multiple layers of async function calls.

`llm-cost-per-test` solves this with `AsyncLocalStorage`, a Node.js API (stable since Node.js 16) that maintains context across async operations within the same logical execution chain. When a test starts, the reporter creates a new `CostTracker` and enters an `AsyncLocalStorage` context with that tracker. All code executing within the test -- including deeply nested async function calls, promise chains, and callback-based code -- can access the current test's tracker via `AsyncLocalStorage.getStore()`. When an intercepted LLM API call completes, the interception layer reads the current tracker from `AsyncLocalStorage` and records the usage. When the test ends, the tracker is finalized and its data is collected by the reporter.

### Cost Budget

A cost budget is a dollar-denominated threshold that triggers a CI failure when exceeded. Budgets operate at three levels:

- **Per-test budget**: Fails if any single test case exceeds the threshold. Catches runaway tests and accidentally expensive prompts.
- **Per-file budget**: Fails if the total cost of all tests in a single file exceeds the threshold. Catches file-level cost creep.
- **Per-suite budget**: Fails if the total cost of the entire test run exceeds the threshold. Enforces an overall spending limit.

Budget violations are reported as test failures with clear messages identifying the offending test/file and the actual vs. budgeted cost. The reporter exits with a non-zero code to fail CI.

### Baseline Comparison

A baseline is a saved cost report from a previous test run, stored as a JSON file. On subsequent runs, `llm-cost-per-test` compares the current run's costs against the baseline and reports the diff: which tests increased in cost, which decreased, and by how much. A configurable percentage threshold determines whether a cost increase triggers a warning or failure. This enables PR-level cost review: "this PR increased eval costs by 23%, from $4.12 to $5.07."

---

## 5. Token Interception

### AsyncLocalStorage for Test-Scoped Tracking

`AsyncLocalStorage` is the foundation of per-test cost attribution. It is a Node.js API that creates a store (any JavaScript value) and propagates it through the async call chain of whatever code runs within its `run()` method. Unlike global variables or thread-local storage, `AsyncLocalStorage` correctly handles concurrent async operations -- two tests running in parallel each have their own store, and each store follows its own async chain.

**How it works in `llm-cost-per-test`**:

1. The reporter maintains a singleton `AsyncLocalStorage<CostTracker>` instance.
2. When a test starts (via the reporter's `onTestStart` hook), a new `CostTracker` is created.
3. The test's execution is wrapped in `asyncLocalStorage.run(tracker, () => testFn())`. For Jest, this wrapping happens via the reporter's integration with the test lifecycle. For Vitest, it uses the reporter's hooks combined with a setup file that wraps test execution.
4. Inside the test, any code that calls `asyncLocalStorage.getStore()` receives the current test's `CostTracker`.
5. The interception layer (SDK wrapping or HTTP interception) calls `asyncLocalStorage.getStore()` after each LLM API call and records the usage on the returned tracker.
6. When the test ends, the reporter reads the tracker's accumulated data.

**Concurrent test handling**: When Vitest runs tests concurrently, each test's `AsyncLocalStorage.run()` creates an isolated context. Two tests making LLM API calls simultaneously have their costs attributed to the correct test, because each test's async chain carries its own tracker.

**Fallback when no context exists**: If an LLM API call occurs outside any test context (e.g., during module initialization, in a `beforeAll` hook), the interception layer records the usage to a "setup" bucket that is reported separately as "unattributed" cost.

### SDK Interception

SDK interception wraps specific methods on LLM provider client objects with a `Proxy` that records token usage from the response.

**Supported SDK methods**:

| SDK | Method | Usage Location in Response |
|-----|--------|---------------------------|
| OpenAI | `chat.completions.create` | `response.usage.prompt_tokens`, `response.usage.completion_tokens` |
| OpenAI | `completions.create` | `response.usage.prompt_tokens`, `response.usage.completion_tokens` |
| OpenAI | `embeddings.create` | `response.usage.prompt_tokens`, `response.usage.total_tokens` |
| Anthropic | `messages.create` | `response.usage.input_tokens`, `response.usage.output_tokens` |
| Anthropic | `messages.stream` | Final message's `usage.input_tokens`, `usage.output_tokens` |

**How it works**:

```typescript
import { trackLLMCost } from 'llm-cost-per-test';
import OpenAI from 'openai';

const openai = trackLLMCost(new OpenAI());
// openai is a Proxy that behaves identically to the original client.
// Every call to openai.chat.completions.create() records token usage
// on the current test's CostTracker via AsyncLocalStorage.
```

The `trackLLMCost` function returns a deeply nested `Proxy`. When `openai.chat.completions.create()` is called:

1. The proxy intercepts the `create` call.
2. The original method is invoked, producing a response (or a stream).
3. For non-streaming responses: the proxy reads `response.usage`, computes cost using the model pricing table, and records a `UsageRecord` on the current test's `CostTracker`.
4. For streaming responses: the proxy wraps the returned stream/async iterator so that when the stream completes (final chunk with usage data, or the `finalMessage()` helper), the accumulated usage is recorded.
5. The original response is returned to the caller unchanged.

**Type preservation**: The proxy preserves full TypeScript types. `trackLLMCost(client: OpenAI)` returns `OpenAI`. The caller experiences no type changes and no behavioral changes beyond the silent cost recording.

### HTTP Interception

HTTP interception patches `globalThis.fetch` to intercept responses from known LLM provider endpoints and extract token usage from the response body.

**How it works**:

1. When the reporter initializes (or when `enableHTTPInterception()` is called), the original `globalThis.fetch` is saved and replaced with a wrapper.
2. The wrapper inspects each outgoing request URL against known LLM provider patterns:
   - `api.openai.com/v1/chat/completions`
   - `api.openai.com/v1/completions`
   - `api.openai.com/v1/embeddings`
   - `api.anthropic.com/v1/messages`
   - `generativelanguage.googleapis.com/v1beta/models/*/generateContent`
   - `*.openai.azure.com/openai/deployments/*/chat/completions*`
3. If the URL matches and the response is not streaming (`Content-Type` is not `text/event-stream`):
   a. The response is cloned via `response.clone()`.
   b. The clone's body is read as JSON.
   c. The `usage` field is extracted (provider-specific paths: `usage.prompt_tokens`/`usage.completion_tokens` for OpenAI, `usage.input_tokens`/`usage.output_tokens` for Anthropic).
   d. The model name is extracted from the request body or response body.
   e. Cost is computed and recorded on the current test's `CostTracker`.
   f. The original (unconsumed) response is returned to the caller.
4. If the response is streaming:
   a. A `TransformStream` tee captures the stream data.
   b. For OpenAI: the final chunk (with `stream_options.include_usage`) is detected and its `usage` field is recorded.
   c. For Anthropic: the `message_delta` event containing `usage` is detected.
   d. If no usage data is found in the stream (e.g., `stream_options.include_usage` was not set), cost is recorded as "unknown" with zero tokens.
5. If the URL does not match any known endpoint, the request passes through unmodified.
6. When the reporter finalizes (or when `disableHTTPInterception()` is called), the original `globalThis.fetch` is restored.

**Advantages over SDK interception**: Works with any LLM SDK or custom HTTP client. No need to pass clients to `trackLLMCost()`. Captures all LLM calls automatically.

**Limitations**: Requires parsing the response body, which involves cloning the response (additional memory for the clone). Cannot capture token usage from streaming responses that do not include usage data in the stream. Cannot intercept calls in child processes or worker threads.

### Manual Tracking

For cases where automatic interception is not possible -- custom LLM providers, non-standard API formats, calls via message queues, or any other non-HTTP integration -- `llm-cost-per-test` provides a manual tracking API:

```typescript
import { createCostTracker } from 'llm-cost-per-test';

const tracker = createCostTracker();

// After making an LLM call through any mechanism:
tracker.record({
  model: 'gpt-4o',
  inputTokens: 500,
  outputTokens: 150,
});

// Or record with explicit cost:
tracker.record({
  model: 'custom-model',
  inputTokens: 1000,
  outputTokens: 200,
  cost: 0.05, // Override computed cost
});
```

When a `CostTracker` created via `createCostTracker()` is used inside a test, it automatically associates with the current test's context via `AsyncLocalStorage`. When used outside a test, its data is reported as unattributed.

### Interception and Test Lifecycle

The interception lifecycle is tightly coupled to the test lifecycle:

1. **Reporter initialization** (`onRunStart`): HTTP interception is activated if configured. The `AsyncLocalStorage` instance is created.
2. **Test start** (`onTestStart`): A new `CostTracker` is created and associated with the test. The `AsyncLocalStorage` context is entered.
3. **Test execution**: All LLM API calls within the test's async chain are intercepted. Token usage is recorded on the test's `CostTracker`.
4. **Test end** (`onTestResult`): The `AsyncLocalStorage` context is exited. The tracker is finalized. Cost data is collected by the reporter.
5. **Run complete** (`onRunComplete`): All per-test cost data is aggregated. The cost report is produced. Budget checks are evaluated. HTTP interception is deactivated.

---

## 6. Cost Calculation

### Token Counts

Token counts are extracted from LLM API responses. Each provider reports usage in a slightly different format:

**OpenAI** (chat completions, completions):
```json
{
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 42,
    "total_tokens": 192,
    "prompt_tokens_details": {
      "cached_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0
    }
  }
}
```

**Anthropic** (messages):
```json
{
  "usage": {
    "input_tokens": 150,
    "output_tokens": 42,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

**Google** (generateContent):
```json
{
  "usageMetadata": {
    "promptTokenCount": 150,
    "candidatesTokenCount": 42,
    "totalTokenCount": 192
  }
}
```

`llm-cost-per-test` normalizes all provider formats into a canonical `{ inputTokens, outputTokens }` pair.

### Model Pricing

`llm-cost-per-test` maintains a built-in pricing table for commonly used models. Prices are in USD per million tokens (MTok):

| Model | Input ($/MTok) | Output ($/MTok) |
|-------|----------------|-----------------|
| `gpt-4o` | $2.50 | $10.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `gpt-4-turbo` | $10.00 | $30.00 |
| `gpt-4` | $30.00 | $60.00 |
| `gpt-3.5-turbo` | $0.50 | $1.50 |
| `o1` | $15.00 | $60.00 |
| `o1-mini` | $3.00 | $12.00 |
| `o3-mini` | $1.10 | $4.40 |
| `claude-opus-4-20250514` | $15.00 | $75.00 |
| `claude-sonnet-4-20250514` | $3.00 | $15.00 |
| `claude-haiku-3-20250307` | $0.80 | $4.00 |
| `claude-3-5-sonnet-20241022` | $3.00 | $15.00 |
| `claude-3-haiku-20240307` | $0.25 | $1.25 |
| `gemini-1.5-pro` | $1.25 | $5.00 |
| `gemini-1.5-flash` | $0.075 | $0.30 |
| `gemini-2.0-flash` | $0.10 | $0.40 |

Model names are matched with prefix normalization: `gpt-4o-2024-08-06` matches the `gpt-4o` entry. Dated model suffixes are stripped during lookup. If a model is not found in the built-in table, `llm-cost-per-test` checks the `model-price-registry` package (if installed as a peer dependency). If the model is still not found, cost is reported as `0.00` with a warning that the model's pricing is unknown.

**Custom pricing**: Users can provide a custom pricing table via configuration that overrides or extends the built-in table:

```typescript
{
  pricing: {
    'my-fine-tuned-model': { input: 5.00, output: 15.00 }, // $/MTok
  }
}
```

### Cost Formula

For each LLM API call:

```
cost = (inputTokens / 1_000_000 * inputPricePerMTok) + (outputTokens / 1_000_000 * outputPricePerMTok)
```

Example: GPT-4o with 500 input tokens and 150 output tokens:
```
cost = (500 / 1_000_000 * 2.50) + (150 / 1_000_000 * 10.00)
     = 0.00125 + 0.0015
     = $0.00275
```

### Streaming Responses

For streaming responses, token usage may be reported differently depending on the provider and configuration:

**OpenAI with `stream_options.include_usage: true`**: The final chunk in the stream includes a `usage` field identical to the non-streaming response. `llm-cost-per-test` detects this final chunk and records the usage.

**OpenAI without `stream_options.include_usage`**: No usage data is available in the stream. `llm-cost-per-test` records the call with `inputTokens: 0, outputTokens: 0` and emits a warning. The recommendation is to enable `stream_options.include_usage: true` in test environments.

**Anthropic streaming**: Usage data is split across events. `input_tokens` is reported in the `message_start` event, and `output_tokens` is reported in the `message_delta` event (the one with `stop_reason`). `llm-cost-per-test` accumulates both.

### Tool Calls

Tool call tokens are included in the API response's `usage` field by the provider. When an LLM response includes tool calls, the tool call arguments count toward output tokens, and tool results provided in subsequent messages count toward input tokens. No special handling is needed -- `llm-cost-per-test` reads the `usage` field as reported, which already includes tool call tokens.

Multi-turn conversations with tool calls involve multiple API calls per test. Each call is recorded as a separate `UsageRecord`, and the test's total cost is the sum of all records.

---

## 7. Reporter Output

### Per-Test Cost Breakdown

The primary output is a table showing every test's LLM cost:

```
LLM Cost Report
═══════════════════════════════════════════════════════════════════════════

  Test                                        Model         In Tok  Out Tok    Cost
  ─────────────────────────────────────────────────────────────────────────────────
  classifies positive feedback                gpt-4o           150       42  $0.0008
  classifies negative feedback                gpt-4o           162       38  $0.0008
  generates product description               gpt-4o           520      280  $0.0041
  summarizes long document                    gpt-4o          2100      450  $0.0098
  multi-turn tool call conversation           gpt-4o          1800      620  $0.0107
  eval: code review quality                   claude-sonnet    890      350  $0.0079
  eval: translation accuracy (fr)             gpt-4o-mini      400      200  $0.0002
  eval: translation accuracy (de)             gpt-4o-mini      420      210  $0.0002

  Total: 8 tests | 6,442 input tokens | 2,190 output tokens | 28 API calls
  Total cost: $0.0345
```

### Suite Summary

An aggregate summary at the bottom of the report:

```
  Suite Summary
  ─────────────────────────────────────
  Total tests with LLM calls:    8 / 45
  Total API calls:               28
  Total input tokens:            6,442
  Total output tokens:           2,190
  Total cost:                    $0.0345
  Most expensive test:           multi-turn tool call conversation ($0.0107)
  Most expensive file:           eval/quality.test.ts ($0.0079)
```

### Top-N Most Expensive Tests

A ranked list of the most expensive tests, useful for identifying optimization targets:

```
  Top 5 Most Expensive Tests
  ─────────────────────────────────────
  1. multi-turn tool call conversation     $0.0107  (31.0%)
  2. summarizes long document              $0.0098  (28.4%)
  3. eval: code review quality             $0.0079  (22.9%)
  4. generates product description         $0.0041  (11.9%)
  5. classifies positive feedback          $0.0008  ( 2.3%)
```

### Cost by Model Breakdown

Aggregate cost by model, showing which models contribute most to the total:

```
  Cost by Model
  ─────────────────────────────────────
  gpt-4o          $0.0262  (75.9%)  20 calls
  claude-sonnet   $0.0079  (22.9%)   4 calls
  gpt-4o-mini     $0.0004  ( 1.2%)   4 calls
```

### Cost by File Breakdown

Aggregate cost by test file:

```
  Cost by File
  ─────────────────────────────────────
  tests/classify.test.ts       $0.0016   2 tests
  tests/generate.test.ts       $0.0041   1 test
  tests/summarize.test.ts      $0.0098   1 test
  tests/conversation.test.ts   $0.0107   1 test
  eval/quality.test.ts         $0.0079   1 test
  eval/translation.test.ts     $0.0004   2 tests
```

---

## 8. Cost Budget Enforcement

### Per-Test Budget

Fail the run if any single test exceeds a cost threshold:

```typescript
// jest.config.js or vitest.config.ts
reporters: [
  ['llm-cost-per-test', { budget: { perTest: 0.50 } }]
]
```

When a test exceeds the per-test budget:

```
BUDGET VIOLATION: Test "multi-turn tool call conversation" cost $0.52, exceeding per-test budget of $0.50.
  File: tests/conversation.test.ts
  API calls: 12
  Input tokens: 15,200
  Output tokens: 4,800
  Model: gpt-4o
```

### Per-File Budget

Fail the run if any test file's total cost exceeds a threshold:

```typescript
reporters: [
  ['llm-cost-per-test', { budget: { perFile: 2.00 } }]
]
```

### Per-Suite Budget

Fail the run if the total cost of all tests exceeds a threshold:

```typescript
reporters: [
  ['llm-cost-per-test', { budget: { perSuite: 10.00 } }]
]
```

### Budget Configuration

Budgets can be configured through reporter options, environment variables, or a combination:

| Source | Example | Priority |
|--------|---------|----------|
| Reporter options | `{ budget: { perTest: 0.50 } }` | Lowest |
| Environment variable | `LLM_COST_BUDGET_PER_TEST=0.50` | Highest |

Environment variables override reporter options, enabling CI-specific budget overrides without changing configuration files.

### Exit Code on Budget Violation

When a budget is violated:

1. The full cost report is still printed (so the developer can see what happened).
2. The budget violation is printed as an error with the specific test/file/suite that exceeded the budget.
3. The reporter signals the test runner to exit with code 1 (for Jest, by calling `process.exitCode = 1`; for Vitest, by throwing from the reporter's `onFinished` hook).

Multiple budget violations are all reported, not just the first one.

---

## 9. Baseline Comparison

### Saving a Baseline

After a test run, the cost report can be saved as a baseline file:

```typescript
reporters: [
  ['llm-cost-per-test', {
    baseline: {
      path: '.llm-cost-baseline.json',
      update: process.env.LLM_COST_UPDATE_BASELINE === '1',
    }
  }]
]
```

When `update` is true (or `LLM_COST_UPDATE_BASELINE=1`), the current run's cost report is written to the baseline file. This is typically done on the main branch after a PR is merged, so the baseline represents the current expected cost.

### Baseline File Format

```json
{
  "version": 1,
  "createdAt": "2026-03-18T10:00:00.000Z",
  "totalCost": 0.0345,
  "tests": {
    "classifies positive feedback": {
      "cost": 0.0008,
      "inputTokens": 150,
      "outputTokens": 42,
      "model": "gpt-4o",
      "apiCalls": 1,
      "file": "tests/classify.test.ts"
    },
    "multi-turn tool call conversation": {
      "cost": 0.0107,
      "inputTokens": 1800,
      "outputTokens": 620,
      "model": "gpt-4o",
      "apiCalls": 4,
      "file": "tests/conversation.test.ts"
    }
  }
}
```

### Comparing Against Baseline

When a baseline file exists and `update` is false, the reporter compares the current run against the baseline:

```
Cost Diff vs. Baseline (.llm-cost-baseline.json)
═════════════════════════════════════════════════════════════════════

  Test                                   Baseline     Current     Diff
  ──────────────────────────────────────────────────────────────────────
  classifies positive feedback           $0.0008      $0.0008     --
  classifies negative feedback           $0.0008      $0.0008     --
  generates product description          $0.0041      $0.0062     +$0.0021 (+51.2%)  !!
  summarizes long document               $0.0098      $0.0098     --
  multi-turn tool call conversation      $0.0107      $0.0085     -$0.0022 (-20.6%)
  eval: code review quality              $0.0079      $0.0079     --
  [NEW] eval: hallucination check        --           $0.0120     +$0.0120 (new)

  Total: $0.0345 → $0.0460  (+$0.0115, +33.3%)
```

Tests with no cost change show `--`. Tests with cost increases show the increase amount and percentage, with `!!` for increases above the warning threshold. New tests (present in the current run but not in the baseline) are marked `[NEW]`. Removed tests (present in the baseline but not in the current run) are marked `[REMOVED]`.

### Percentage Change Thresholds

Configure when cost changes trigger warnings or failures:

```typescript
reporters: [
  ['llm-cost-per-test', {
    baseline: {
      path: '.llm-cost-baseline.json',
      warnThreshold: 0.10,  // Warn if total cost increases by >10%
      failThreshold: 0.25,  // Fail if total cost increases by >25%
    }
  }]
]
```

When the total cost increase exceeds `failThreshold`, the reporter fails the run with:

```
BASELINE VIOLATION: Total cost increased by 33.3% (from $0.0345 to $0.0460),
exceeding the fail threshold of 25%.
```

When the increase is between `warnThreshold` and `failThreshold`, a warning is printed but the run does not fail.

### PR Comment Integration

The Markdown output format is designed for use with GitHub Actions to post cost diffs as PR comments:

```yaml
# .github/workflows/cost-report.yml
- name: Run tests with cost tracking
  run: npm test -- --reporter=llm-cost-per-test --outputFile=cost-report.md --outputFormat=markdown

- name: Comment on PR
  uses: actions/github-script@v7
  with:
    script: |
      const fs = require('fs');
      const body = fs.readFileSync('cost-report.md', 'utf-8');
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body,
      });
```

---

## 10. API Surface

### Installation

```bash
npm install --save-dev llm-cost-per-test
```

### Core Exports

```typescript
import {
  LLMCostReporter,
  trackLLMCost,
  createCostTracker,
  getCostForCurrentTest,
  enableHTTPInterception,
  disableHTTPInterception,
} from 'llm-cost-per-test';
```

### `LLMCostReporter`

The test runner reporter class. Implements both the Jest `Reporter` interface and the Vitest `Reporter` interface.

**Jest configuration** (`jest.config.js`):
```javascript
module.exports = {
  reporters: [
    'default',
    ['llm-cost-per-test', {
      output: 'table',
      budget: { perTest: 0.50, perSuite: 10.00 },
      baseline: { path: '.llm-cost-baseline.json' },
    }],
  ],
};
```

**Vitest configuration** (`vitest.config.ts`):
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: [
      'default',
      ['llm-cost-per-test', {
        output: 'table',
        budget: { perTest: 0.50, perSuite: 10.00 },
        baseline: { path: '.llm-cost-baseline.json' },
      }],
    ],
  },
});
```

**Reporter class interface**:

```typescript
class LLMCostReporter {
  constructor(globalConfig: unknown, reporterOptions: CostReporterOptions);

  // Jest Reporter interface
  onRunStart(results: AggregatedResult, options: ReporterOnStartOptions): void;
  onTestStart(test: Test): void;
  onTestResult(test: Test, testResult: TestResult, results: AggregatedResult): void;
  onRunComplete(testContexts: Set<TestContext>, results: AggregatedResult): Promise<void>;

  // Vitest Reporter interface
  onInit(ctx: Vitest): void;
  onTestStart?(test: RunnerTestCase): void;
  onTestEnd?(test: RunnerTestCase): void;
  onFinished(files: File[], errors: unknown[]): Promise<void>;
}
```

### `trackLLMCost(client)`

Wraps an LLM SDK client with cost tracking. Returns a proxy that behaves identically to the original client but records token usage on the current test's `CostTracker`.

```typescript
function trackLLMCost<T extends object>(client: T): T;
```

**Usage**:

```typescript
import OpenAI from 'openai';
import { trackLLMCost } from 'llm-cost-per-test';

const openai = trackLLMCost(new OpenAI());

// In a test:
it('generates a response', async () => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
  });
  // Token usage automatically recorded on this test's tracker.
  expect(response.choices[0].message.content).toBeDefined();
});
```

Works with OpenAI and Anthropic SDK clients. For other SDKs, use HTTP interception or manual tracking.

### `createCostTracker(options?)`

Creates a manual cost tracker for recording token usage from custom integrations.

```typescript
function createCostTracker(options?: TrackerOptions): CostTracker;

interface CostTracker {
  /** Record a single LLM API call's token usage. */
  record(usage: UsageInput): void;

  /** Get the accumulated cost summary. */
  getCost(): CostSummary;

  /** Get all recorded usage entries. */
  getEntries(): ReadonlyArray<UsageRecord>;

  /** Reset the tracker (clear all recorded entries). */
  reset(): void;
}

interface UsageInput {
  /** Model name (e.g., 'gpt-4o', 'claude-sonnet-4-20250514'). */
  model: string;

  /** Number of input/prompt tokens. */
  inputTokens: number;

  /** Number of output/completion tokens. */
  outputTokens: number;

  /** Override the computed cost with an explicit dollar amount. */
  cost?: number;
}
```

**Usage**:

```typescript
import { createCostTracker } from 'llm-cost-per-test';

const tracker = createCostTracker();

// After a custom LLM API call:
tracker.record({
  model: 'gpt-4o',
  inputTokens: 500,
  outputTokens: 150,
});

const summary = tracker.getCost();
console.log(summary.totalCost); // 0.00275
```

### `getCostForCurrentTest()`

Returns the accumulated cost for the currently executing test. Useful for in-test cost assertions.

```typescript
function getCostForCurrentTest(): CostSummary | null;
```

**Usage**:

```typescript
import { getCostForCurrentTest } from 'llm-cost-per-test';

it('stays within cost budget', async () => {
  await myLLMFunction();

  const cost = getCostForCurrentTest();
  expect(cost).not.toBeNull();
  expect(cost!.totalCost).toBeLessThan(0.01);
});
```

Returns `null` when called outside a test context.

### `enableHTTPInterception(options?)` / `disableHTTPInterception()`

Manually control HTTP-level interception. Normally managed by the reporter, but can be called directly for advanced use cases.

```typescript
function enableHTTPInterception(options?: HTTPInterceptionOptions): void;
function disableHTTPInterception(): void;

interface HTTPInterceptionOptions {
  /** Additional URL patterns to intercept. */
  providerPatterns?: Array<{ name: string; pattern: RegExp }>;
}
```

### Type Definitions

```typescript
// ── Configuration ────────────────────────────────────────────────────

interface CostReporterOptions {
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

  /** Interception mode. Default: 'auto'.
   *  'auto': enable HTTP interception automatically.
   *  'sdk': only track via trackLLMCost() wrappers.
   *  'manual': only track via createCostTracker().
   *  'off': disable all interception (reporter only collects manually tracked data). */
  interception?: 'auto' | 'sdk' | 'manual' | 'off';

  /** Number of top-N most expensive tests to display. Default: 10. */
  topN?: number;

  /** Whether to show per-model cost breakdown. Default: true. */
  showModelBreakdown?: boolean;

  /** Whether to show per-file cost breakdown. Default: true. */
  showFileBreakdown?: boolean;

  /** Whether to show the full per-test table. Default: true. */
  showPerTestTable?: boolean;

  /** Minimum cost threshold for a test to appear in the report.
   *  Tests below this cost are grouped as "other". Default: 0 (show all). */
  minCostToShow?: number;

  /** Integration with llm-vcr. When provided, reads cost data from cassettes. */
  vcr?: { cassettesDir: string };
}

type OutputFormat = 'table' | 'json' | 'markdown' | 'junit';

interface CostBudget {
  /** Maximum cost per individual test (USD). */
  perTest?: number;

  /** Maximum cost per test file (USD). */
  perFile?: number;

  /** Maximum total cost for the entire test run (USD). */
  perSuite?: number;
}

interface BaselineConfig {
  /** Path to the baseline file. */
  path: string;

  /** Whether to update the baseline with the current run's data.
   *  Default: false. Override with LLM_COST_UPDATE_BASELINE=1. */
  update?: boolean;

  /** Percentage increase that triggers a warning. Default: 0.10 (10%). */
  warnThreshold?: number;

  /** Percentage increase that triggers a failure. Default: 0.25 (25%). */
  failThreshold?: number;
}

interface ModelPricing {
  /** Price per million input tokens (USD). */
  input: number;

  /** Price per million output tokens (USD). */
  output: number;
}

interface TrackerOptions {
  /** Custom pricing table. Merges with built-in pricing. */
  pricing?: Record<string, ModelPricing>;
}

// ── Report Types ─────────────────────────────────────────────────────

interface CostReport {
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

interface TestCostEntry {
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

interface UsageRecord {
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

interface CostSummary {
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

interface FileCostEntry {
  /** File path. */
  filePath: string;

  /** Total cost for all tests in this file. */
  cost: number;

  /** Number of tests in this file with LLM calls. */
  testCount: number;

  /** Number of API calls in this file. */
  apiCalls: number;
}

interface ModelCostEntry {
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

interface BudgetViolation {
  /** Budget level that was violated. */
  level: 'perTest' | 'perFile' | 'perSuite';

  /** Name of the offending test, file, or 'suite'. */
  name: string;

  /** Actual cost. */
  actualCost: number;

  /** Budget threshold. */
  budgetCost: number;
}

interface BaselineDiff {
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

interface TestCostDiff {
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

// ── Baseline File ────────────────────────────────────────────────────

interface CostBaseline {
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
```

---

## 11. Test Runner Configuration

### Jest

Add `llm-cost-per-test` to the `reporters` array in `jest.config.js`:

```javascript
module.exports = {
  reporters: [
    'default', // Keep the default reporter for test pass/fail output
    ['llm-cost-per-test', {
      output: 'table',
      outputFile: 'cost-report.json',
      budget: { perTest: 0.50, perSuite: 10.00 },
      baseline: { path: '.llm-cost-baseline.json' },
      topN: 10,
    }],
  ],
};
```

**Jest setup file** (optional, for SDK wrapping):

```typescript
// jest.setup.ts
import { enableHTTPInterception } from 'llm-cost-per-test';

// Enable automatic HTTP interception for all tests.
// This is done automatically by the reporter if interception: 'auto',
// but can be called explicitly in a setup file for more control.
enableHTTPInterception();
```

**How the Jest reporter works**: Jest reporters receive lifecycle events from the Jest test runner. `LLMCostReporter` receives `onTestStart` when a test begins, giving it the test name and file path. It receives `onTestResult` when a test file completes, with the results of all tests in that file. It receives `onRunComplete` when all tests are done. The reporter uses these events to:

1. Create a `CostTracker` per test at `onTestStart`.
2. Collect and finalize the tracker at `onTestResult`.
3. Produce the full report at `onRunComplete`.

Note: Jest runs each test file in a separate worker process. `AsyncLocalStorage` contexts are per-process, so HTTP interception and SDK wrapping must be set up in each worker (via the `setupFilesAfterFramework` configuration). The reporter runs in the main process and collects cost data from workers via Jest's built-in reporter communication channel.

### Vitest

Add `llm-cost-per-test` to the `reporters` array in `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: [
      'default',
      ['llm-cost-per-test', {
        output: 'table',
        budget: { perSuite: 5.00 },
      }],
    ],
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

**Vitest setup file** (for SDK wrapping and HTTP interception):

```typescript
// vitest.setup.ts
import { enableHTTPInterception } from 'llm-cost-per-test';

enableHTTPInterception();
```

**How the Vitest reporter works**: Vitest reporters run in the main thread and receive events from test workers. The `onInit` hook provides access to the Vitest context. `onTestStart` and `onTestEnd` hooks fire for each test. `onFinished` fires when all tests are complete. Vitest supports concurrent tests by default, and `AsyncLocalStorage` correctly isolates cost tracking across concurrent tests within the same worker.

---

## 12. Output Formats

### Terminal Table (Default)

The default format for local development. Uses ANSI color codes for readability: green for tests under budget, yellow for tests approaching budget, red for budget violations. Colors are disabled when `NO_COLOR` is set, stdout is not a TTY, or `--no-color` is passed.

The terminal table includes the per-test breakdown, suite summary, top-N list, model breakdown, and file breakdown as shown in section 7.

### JSON File

Machine-readable format for CI pipelines and downstream processing tools:

```json
{
  "version": 1,
  "createdAt": "2026-03-18T10:00:00.000Z",
  "totalCost": 0.0345,
  "totalInputTokens": 6442,
  "totalOutputTokens": 2190,
  "totalApiCalls": 28,
  "testsWithCalls": 8,
  "totalTests": 45,
  "tests": [
    {
      "testName": "classifies positive feedback",
      "filePath": "tests/classify.test.ts",
      "cost": 0.0008,
      "inputTokens": 150,
      "outputTokens": 42,
      "apiCalls": 1,
      "records": [
        {
          "model": "gpt-4o",
          "inputTokens": 150,
          "outputTokens": 42,
          "cost": 0.0008,
          "timestamp": "2026-03-18T10:00:01.234Z"
        }
      ]
    }
  ],
  "files": [],
  "models": [],
  "budgetViolations": [],
  "baselineDiff": null
}
```

Configure with `output: 'json'` and `outputFile: 'path/to/report.json'`.

### Markdown

Designed for posting as a PR comment via GitHub Actions or similar CI systems. Produces a formatted Markdown table with the cost diff against baseline (if available):

```markdown
## LLM Cost Report

| Test | Model | Tokens (in/out) | Cost |
|------|-------|-----------------|------|
| classifies positive feedback | gpt-4o | 150 / 42 | $0.0008 |
| classifies negative feedback | gpt-4o | 162 / 38 | $0.0008 |
| generates product description | gpt-4o | 520 / 280 | $0.0041 |
| summarizes long document | gpt-4o | 2,100 / 450 | $0.0098 |

**Total: $0.0345** (8 tests, 28 API calls)

### Cost Diff vs. Baseline
| Test | Baseline | Current | Change |
|------|----------|---------|--------|
| generates product description | $0.0041 | $0.0062 | +51.2% |
| multi-turn tool call conversation | $0.0107 | $0.0085 | -20.6% |
| **Total** | **$0.0345** | **$0.0460** | **+33.3%** |
```

Configure with `output: 'markdown'`.

### JUnit XML Annotations

Adds cost data as properties to JUnit XML test case elements, compatible with CI dashboards that parse JUnit XML:

```xml
<testcase name="classifies positive feedback" classname="tests.classify" time="0.234">
  <properties>
    <property name="llm.cost" value="0.0008" />
    <property name="llm.inputTokens" value="150" />
    <property name="llm.outputTokens" value="42" />
    <property name="llm.apiCalls" value="1" />
    <property name="llm.model" value="gpt-4o" />
  </properties>
</testcase>
```

Configure with `output: 'junit'`. This format is designed to be used alongside (not instead of) the standard JUnit reporter.

---

## 13. Configuration

### All Options with Defaults

```typescript
const defaults: CostReporterOptions = {
  output: 'table',               // 'table' | 'json' | 'markdown' | 'junit'
  outputFile: undefined,         // File path for report output (stdout if unset)
  budget: {
    perTest: undefined,          // No per-test budget by default
    perFile: undefined,          // No per-file budget by default
    perSuite: undefined,         // No per-suite budget by default
  },
  baseline: {
    path: undefined,             // No baseline by default
    update: false,               // Override with LLM_COST_UPDATE_BASELINE=1
    warnThreshold: 0.10,         // Warn at 10% increase
    failThreshold: 0.25,         // Fail at 25% increase
  },
  pricing: {},                   // Custom model pricing (merges with built-in)
  interception: 'auto',         // 'auto' | 'sdk' | 'manual' | 'off'
  topN: 10,                     // Show top 10 most expensive tests
  showModelBreakdown: true,     // Show cost-by-model table
  showFileBreakdown: true,      // Show cost-by-file table
  showPerTestTable: true,       // Show full per-test table
  minCostToShow: 0,             // Show all tests (0 = no minimum)
  vcr: undefined,               // llm-vcr integration config
};
```

### Environment Variables

| Variable | Purpose | Values |
|----------|---------|--------|
| `LLM_COST_BUDGET_PER_TEST` | Override per-test budget | Dollar amount (e.g., `0.50`) |
| `LLM_COST_BUDGET_PER_FILE` | Override per-file budget | Dollar amount |
| `LLM_COST_BUDGET_PER_SUITE` | Override per-suite budget | Dollar amount |
| `LLM_COST_UPDATE_BASELINE` | Update the baseline file | `1`, `true`, `yes` |
| `LLM_COST_OUTPUT` | Override output format | `table`, `json`, `markdown`, `junit` |
| `LLM_COST_OUTPUT_FILE` | Override output file path | File path |

Environment variables override reporter options. This enables CI-specific configuration without modifying test configuration files.

### Configuration Resolution Order

1. **Built-in defaults** (lowest priority).
2. **Reporter options** passed in `jest.config.js` / `vitest.config.ts`.
3. **Environment variables** (highest priority).

---

## 14. Integration with the npm-master Ecosystem

### llm-vcr

`llm-vcr` records and replays LLM API calls for deterministic, zero-cost testing. `llm-cost-per-test` integrates with `llm-vcr` in two ways:

**1. Cost tracking during recording**: When `llm-vcr` is in `record` or `auto` mode and real API calls are being made, `llm-cost-per-test` intercepts the calls normally and reports real costs. This gives developers accurate cost feedback during the recording phase.

**2. Cost reporting from cassettes in replay mode**: When `llm-vcr` is in `replay` mode (no real API calls), `llm-cost-per-test` reads token usage from cassette entry metadata (`costEstimate.inputTokens`, `costEstimate.outputTokens`) and reports the cost as if the calls were live. This requires configuring the `vcr` option:

```typescript
reporters: [
  ['llm-cost-per-test', {
    vcr: { cassettesDir: '__cassettes__' },
  }]
]
```

**Combined usage**:

```typescript
import { withCassette } from 'llm-vcr';
import { trackLLMCost } from 'llm-cost-per-test';
import OpenAI from 'openai';

const openai = trackLLMCost(new OpenAI());

it('generates a summary', async () => {
  await withCassette('generates-summary', async () => {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Summarize: ...' }],
    });
    expect(response.choices[0].message.content).toBeDefined();
  });
  // In record mode: real API call, real cost tracked.
  // In replay mode: replayed from cassette, cost read from cassette metadata.
});
```

### model-price-registry

`model-price-registry` provides an auto-updating registry of LLM pricing across providers. When installed as a peer dependency, `llm-cost-per-test` uses it as a fallback pricing source for models not in the built-in table. This ensures that new models (released after the last `llm-cost-per-test` update) have accurate pricing without requiring a package update:

```typescript
import { getPrice } from 'model-price-registry';

// Internal: llm-cost-per-test checks built-in table first,
// falls back to model-price-registry
const price = builtInPrices[model] ?? getPrice(model) ?? { input: 0, output: 0 };
```

### llm-regression

`llm-regression` detects semantic regression in LLM outputs across model versions and prompt changes. Cost data from `llm-cost-per-test` complements regression data: when a prompt change causes both a quality regression and a cost increase, the combined data tells the full story. The cost baseline diff can be included alongside the regression report in PR comments.

---

## 15. Testing Strategy

### Unit Tests

**Cost calculation tests**:
- OpenAI usage format: correct cost computed from `prompt_tokens` and `completion_tokens`.
- Anthropic usage format: correct cost computed from `input_tokens` and `output_tokens`.
- Google usage format: correct cost computed from `promptTokenCount` and `candidatesTokenCount`.
- Known model pricing: GPT-4o, Claude Sonnet, Gemini Flash all produce correct costs.
- Unknown model: cost is 0.00 with a warning.
- Custom pricing: overrides built-in pricing.
- Dated model names: `gpt-4o-2024-08-06` matches `gpt-4o` pricing.
- Zero tokens: cost is 0.00.
- Large token counts: no overflow or precision issues.

**CostTracker tests**:
- Record a single usage entry: `getCost()` returns correct summary.
- Record multiple entries: `getCost()` sums correctly.
- Record entries with different models: `byModel` breakdown is correct.
- `reset()`: clears all entries and resets cost to 0.
- `getEntries()`: returns all recorded entries in order.
- Manual cost override: `record({ cost: 0.05 })` uses the provided cost instead of computing it.

**AsyncLocalStorage attribution tests**:
- Two concurrent async operations: each records to its own tracker.
- Deeply nested async calls: tracker propagates through the chain.
- No active context: usage is recorded as unattributed.
- Context isolation: one test's tracker does not leak to another.

**SDK interception tests**:
- `trackLLMCost(openaiClient)`: returns a proxy that behaves identically to the original.
- Non-streaming call: `usage` field is captured from the response.
- Streaming call with usage: final chunk's `usage` is captured.
- Anthropic client: `usage.input_tokens`/`usage.output_tokens` captured.
- Return value: original response is returned unmodified.
- Error handling: if the API call throws, the error propagates and no usage is recorded.

**HTTP interception tests**:
- `enableHTTPInterception()`: patches `globalThis.fetch`.
- `disableHTTPInterception()`: restores original `globalThis.fetch`.
- Request to OpenAI endpoint: response is cloned, usage extracted, original returned.
- Request to non-LLM endpoint: passes through unmodified.
- Streaming response with usage: usage extracted from final chunk.
- Streaming response without usage: recorded with zero tokens and a warning.
- Concurrent fetch calls: each attributed to the correct test via `AsyncLocalStorage`.

**Budget enforcement tests**:
- Per-test budget exceeded: violation reported with test name and cost.
- Per-test budget not exceeded: no violation.
- Per-file budget exceeded: violation reported with file path and cost.
- Per-suite budget exceeded: violation reported with total cost.
- Multiple violations: all reported, not just the first.
- Budget from environment variable: overrides reporter options.

**Baseline comparison tests**:
- No baseline file: no diff in report.
- Baseline exists, costs unchanged: all diffs are zero.
- Baseline exists, costs increased: positive diff with percentage.
- Baseline exists, costs decreased: negative diff with percentage.
- New tests not in baseline: marked as `[NEW]`.
- Removed tests not in current run: marked as `[REMOVED]`.
- Warn threshold exceeded: warning emitted but run does not fail.
- Fail threshold exceeded: run fails.
- `update: true`: baseline file overwritten with current data.

**Output format tests**:
- Table format: produces correctly formatted ASCII table.
- JSON format: produces valid JSON matching `CostReport` schema.
- Markdown format: produces valid Markdown with tables.
- JUnit format: produces valid XML with cost properties.

### Integration Tests

- **Full Jest lifecycle**: Configure reporter in a mock Jest environment. Simulate test start, test result, run complete. Verify cost report is produced with correct data.
- **Full Vitest lifecycle**: Same as Jest but with Vitest reporter hooks.
- **SDK wrapping end-to-end**: Wrap an OpenAI client, make a call to a mock HTTP server that returns a realistic LLM response with usage data, verify the cost is recorded and appears in the report.
- **HTTP interception end-to-end**: Enable HTTP interception, make a fetch call to a mock LLM endpoint, verify the cost is recorded.
- **Concurrent test attribution**: Simulate two tests running concurrently, each making LLM calls, verify costs are attributed to the correct test.
- **Budget failure end-to-end**: Configure a per-test budget, run a test that exceeds it, verify the reporter signals a failure.
- **Baseline round-trip**: Save a baseline, modify costs, compare, verify the diff is correct.

### Edge Cases

- Test makes no LLM calls: test appears in report with $0.00 cost.
- LLM response has no `usage` field: recorded with zero tokens and a warning.
- Model name is empty or null: cost computed as zero with a warning.
- Very large number of API calls in a single test (100+): no performance degradation.
- Reporter receives no test events (empty test run): produces an empty report.
- Baseline file is corrupt JSON: error with clear message, run continues without baseline comparison.
- Two reporters configured simultaneously: each operates independently.
- Test framework shutdown before `onRunComplete`: partial report is not written (data is lost gracefully, no crash).

### Test Framework

Tests use Vitest, matching the project's existing `vitest run` configuration in `package.json`. Integration tests that simulate LLM API responses use a local HTTP server (`node:http`) that returns canned responses with realistic `usage` fields.

---

## 16. Performance

### Interception Overhead

The performance overhead of `llm-cost-per-test` is negligible relative to the cost of LLM API calls themselves:

| Operation | Overhead |
|-----------|----------|
| `AsyncLocalStorage.getStore()` per intercepted call | < 0.01ms |
| Response clone + JSON parse (HTTP interception) | < 1ms for typical LLM responses |
| SDK proxy method call overhead | < 0.01ms |
| `CostTracker.record()` per call | < 0.01ms |
| Cost report generation (100 tests) | < 10ms |
| Baseline file read + comparison | < 5ms |

The response cloning in HTTP interception is the most expensive operation. For a typical LLM response body (1-10KB), `response.clone()` and `response.json()` on the clone take under 1ms. For very large responses (100KB+), this may reach 5-10ms, which is still negligible compared to the API call latency (100-5000ms).

### Memory Usage

Each `UsageRecord` is approximately 200 bytes. A test with 10 API calls adds ~2KB of cost tracking data. A test suite with 200 tests, each making 5 API calls, adds ~200KB of cost tracking data. This is negligible.

The response clone in HTTP interception temporarily doubles the response body in memory. For typical LLM responses, this is 1-10KB. The clone is garbage-collected after the usage data is extracted.

### Streaming Overhead

For streaming responses, `llm-cost-per-test` does not buffer the full stream. It inspects individual chunks for usage data (typically only present in the final chunk). The overhead is one conditional check per chunk (checking if the chunk contains `usage`), which is under 0.01ms.

---

## 17. Dependencies

### Runtime Dependencies

None. `llm-cost-per-test` uses only Node.js built-in APIs:

| API | Purpose |
|-----|---------|
| `node:async_hooks` (`AsyncLocalStorage`) | Per-test cost attribution across async calls |
| `globalThis.fetch` | HTTP interception (patching and restoration) |
| `node:fs/promises` | Baseline file and report file read/write |
| `node:path` | File path construction |

### Peer Dependencies (Optional)

| Package | Version | Purpose | When Required |
|---------|---------|---------|---------------|
| `model-price-registry` | `^0.1.0` | Fallback pricing for unknown models | When a model is not in the built-in pricing table |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `vitest` | Test runner |
| `eslint` | Linter |
| `openai` | Used in integration tests for SDK interception testing |
| `@anthropic-ai/sdk` | Used in integration tests for Anthropic SDK interception testing |

### Compatibility

- Node.js >= 18 (requires `AsyncLocalStorage`, `globalThis.fetch`, ES2022).
- TypeScript >= 5.0.
- Compatible with Jest >= 29 and Vitest >= 1.0 as test framework hosts.
- Compatible with any LLM provider SDK that uses `fetch` for HTTP calls.

---

## 18. File Structure

```
llm-cost-per-test/
  package.json
  tsconfig.json
  SPEC.md
  README.md
  src/
    index.ts                    Main entry point. Exports LLMCostReporter,
                                trackLLMCost, createCostTracker, getCostForCurrentTest,
                                enableHTTPInterception, disableHTTPInterception,
                                and all types.
    types.ts                    All TypeScript interfaces and type definitions:
                                CostReporterOptions, CostReport, TestCostEntry,
                                UsageRecord, CostSummary, CostBudget, CostBaseline,
                                BaselineDiff, ModelPricing, TrackerOptions.
    reporter.ts                 LLMCostReporter class. Implements Jest Reporter
                                and Vitest Reporter interfaces. Manages test lifecycle,
                                collects cost data, produces reports, enforces budgets.
    tracker.ts                  CostTracker class. Accumulates UsageRecords,
                                computes cost summaries, per-model breakdown.
                                createCostTracker() factory function.
    context.ts                  AsyncLocalStorage setup. Provides getActiveTracker(),
                                runWithTracker(), getCostForCurrentTest().
    pricing.ts                  Built-in model pricing table. Price lookup by model
                                name with prefix matching. Custom pricing merge.
                                model-price-registry integration.
    interception/
      sdk.ts                    SDK-level interception. trackLLMCost() function.
                                Proxy-based wrapping for OpenAI and Anthropic
                                client methods. Streaming response handling.
      http.ts                   HTTP-level interception. enableHTTPInterception(),
                                disableHTTPInterception(). Fetch patching, URL
                                pattern matching, response cloning, usage extraction.
      providers.ts              LLM provider URL patterns and response format
                                parsers. Extracts model name and usage from
                                provider-specific response formats.
    budget.ts                   Budget enforcement logic. Evaluates per-test,
                                per-file, and per-suite budgets against cost data.
                                Produces BudgetViolation entries.
    baseline.ts                 Baseline comparison. Reads baseline file, computes
                                diffs, evaluates warn/fail thresholds. Writes
                                updated baseline file.
    output/
      table.ts                  Terminal table formatter. ANSI colors, column
                                alignment, summary sections, top-N list.
      json.ts                   JSON output formatter. Serializes CostReport
                                to JSON.
      markdown.ts               Markdown output formatter. Tables for PR comments.
      junit.ts                  JUnit XML formatter. Adds cost properties to
                                test case elements.
    vcr-integration.ts          llm-vcr integration. Reads cassette files,
                                extracts cost metadata, feeds into CostTracker.
  src/__tests__/
    tracker.test.ts             CostTracker unit tests.
    context.test.ts             AsyncLocalStorage attribution tests.
    pricing.test.ts             Price lookup and calculation tests.
    sdk-interception.test.ts    SDK wrapping tests.
    http-interception.test.ts   HTTP interception tests.
    budget.test.ts              Budget enforcement tests.
    baseline.test.ts            Baseline comparison tests.
    output/
      table.test.ts             Terminal table output tests.
      json.test.ts              JSON output tests.
      markdown.test.ts          Markdown output tests.
      junit.test.ts             JUnit XML output tests.
    reporter.test.ts            Reporter lifecycle integration tests.
    integration.test.ts         End-to-end tests with mock HTTP server.
    vcr-integration.test.ts     llm-vcr integration tests.
```

The `src/index.ts` exports:

```typescript
// Reporter
export { LLMCostReporter } from './reporter';

// Core functions
export { trackLLMCost } from './interception/sdk';
export { createCostTracker } from './tracker';
export { getCostForCurrentTest } from './context';
export { enableHTTPInterception, disableHTTPInterception } from './interception/http';

// Types
export type {
  CostReporterOptions,
  OutputFormat,
  CostBudget,
  BaselineConfig,
  ModelPricing,
  TrackerOptions,
  CostReport,
  TestCostEntry,
  UsageRecord,
  CostSummary,
  FileCostEntry,
  ModelCostEntry,
  BudgetViolation,
  BaselineDiff,
  TestCostDiff,
  CostBaseline,
  CostTracker,
  UsageInput,
  HTTPInterceptionOptions,
} from './types';
```

The default export is `LLMCostReporter` (for test runner `reporters` array configuration where the module path is used directly).

---

## 19. Implementation Roadmap

### Phase 1: Core Cost Tracking (v0.1.0)

Deliver the minimum viable cost tracker: pricing table, CostTracker, AsyncLocalStorage context, and SDK interception.

**Order of implementation**:

1. **Types** (`types.ts`): Define all public types -- `CostReporterOptions`, `CostReport`, `TestCostEntry`, `UsageRecord`, `CostSummary`, `ModelPricing`, `CostBudget`, `CostBaseline`, `CostTracker`, `UsageInput`.
2. **Pricing** (`pricing.ts`): Built-in model pricing table. `getPrice(model)` function with prefix matching. Custom pricing merge.
3. **Tracker** (`tracker.ts`): `CostTracker` class with `record()`, `getCost()`, `getEntries()`, `reset()`. `createCostTracker()` factory.
4. **Context** (`context.ts`): `AsyncLocalStorage<CostTracker>` singleton. `getActiveTracker()`, `runWithTracker()`, `getCostForCurrentTest()`.
5. **SDK interception** (`interception/sdk.ts`): `trackLLMCost()` with Proxy-based wrapping for OpenAI client. Non-streaming only in this phase.
6. **Entry point** (`index.ts`): Public exports.

### Phase 2: HTTP Interception and Reporters (v0.2.0)

Add HTTP-level interception and the test runner reporter.

1. **Provider patterns** (`interception/providers.ts`): URL patterns for OpenAI, Anthropic, Google. Response format parsers for usage extraction.
2. **HTTP interception** (`interception/http.ts`): Fetch patching, URL matching, response cloning, usage extraction.
3. **Reporter** (`reporter.ts`): `LLMCostReporter` implementing Jest and Vitest reporter interfaces. Test lifecycle hooks, cost data collection.
4. **Table output** (`output/table.ts`): Terminal table formatter with per-test breakdown, summary, top-N list.

### Phase 3: Budget Enforcement and Baseline Comparison (v0.3.0)

Add cost budgets and baseline diffing.

1. **Budget** (`budget.ts`): Per-test, per-file, per-suite budget evaluation. `BudgetViolation` generation. Environment variable overrides.
2. **Baseline** (`baseline.ts`): Baseline file read/write. Cost diff computation. Warn/fail threshold evaluation.
3. **Integration into reporter**: Budget checks at `onRunComplete`. Baseline comparison at `onRunComplete`. Exit code on violation.

### Phase 4: Streaming Support and Anthropic (v0.4.0)

Add streaming response handling and Anthropic SDK support.

1. **Streaming SDK interception**: Wrap OpenAI streaming responses to capture usage from final chunk. Wrap Anthropic `.stream()` method.
2. **Streaming HTTP interception**: Detect streaming responses, inspect chunks for usage data.
3. **Anthropic SDK interception**: Proxy wrapping for `messages.create` and `messages.stream`.

### Phase 5: Additional Output Formats and Integrations (v0.5.0)

Add JSON, Markdown, JUnit output formats and llm-vcr integration.

1. **JSON output** (`output/json.ts`): Serialize `CostReport` to JSON.
2. **Markdown output** (`output/markdown.ts`): Generate PR-comment-friendly Markdown.
3. **JUnit output** (`output/junit.ts`): Add cost properties to JUnit XML.
4. **llm-vcr integration** (`vcr-integration.ts`): Read cassette files, extract cost metadata.

### Phase 6: Testing and Documentation (v1.0.0)

Production-ready release with comprehensive test suite and documentation.

1. Unit tests for all modules as described in section 15.
2. Integration tests with mock HTTP server.
3. README with quick start, configuration guide, and API reference.
4. JSDoc comments on all public exports.

---

## 20. Example Use Cases

### Example 1: CI Cost Dashboard

A team runs a 200-test eval suite in CI. They configure `llm-cost-per-test` to output JSON and upload the report to their dashboard.

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    reporters: [
      'default',
      ['llm-cost-per-test', {
        output: 'json',
        outputFile: 'cost-report.json',
        topN: 20,
      }],
    ],
  },
});
```

```yaml
# .github/workflows/test.yml
- run: npm test
- uses: actions/upload-artifact@v4
  with:
    name: cost-report
    path: cost-report.json
```

The JSON report is archived as a CI artifact. A dashboard reads these artifacts across runs and plots cost trends over time: total cost per run, cost per model, and the top 10 most expensive tests.

### Example 2: PR Cost Review

A developer adds 5 new eval tests. The team wants to see the cost impact in the PR.

```yaml
# .github/workflows/cost-comment.yml
- run: npm test
- name: Post cost report to PR
  uses: actions/github-script@v7
  with:
    script: |
      const fs = require('fs');
      const body = fs.readFileSync('cost-report.md', 'utf-8');
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body,
      });
```

The PR comment shows the cost diff against the baseline: "This PR adds 5 tests costing $0.82/run, increasing total eval cost from $3.45 to $4.27 (+23.8%)." The reviewer sees the breakdown and approves or requests that some tests use cheaper models.

### Example 3: Eval Budget Enforcement

A platform team sets a hard budget to prevent runaway costs:

```typescript
reporters: [
  ['llm-cost-per-test', {
    budget: {
      perTest: 0.50,   // No single test should cost more than $0.50
      perSuite: 15.00, // The whole suite should cost less than $15
    },
  }],
]
```

A developer accidentally writes a test that calls GPT-4 in a loop 50 times. The test costs $3.20. CI fails immediately with:

```
BUDGET VIOLATION: Test "generate-all-categories" cost $3.20, exceeding per-test budget of $0.50.
```

The developer fixes the test before it runs hundreds of times across branches.

### Example 4: Cost Optimization Tracking

A team tracks cost over time as they optimize their eval suite. Each optimization is measurable:

**Week 1**: Baseline cost is $8.50/run.
**Week 2**: Switch classification tests from GPT-4o to GPT-4o-mini. Cost drops to $6.20/run. Baseline diff shows: "classifies positive feedback: $0.0008 -> $0.0001 (-87.5%)".
**Week 3**: Shorten system prompts by 200 tokens. Cost drops to $5.10/run. Baseline diff shows input token reductions across 40 tests.
**Week 4**: Add response caching for deterministic prompts. Cost drops to $3.80/run.

Each week's improvement is quantified in the baseline diff, giving the team a clear return-on-investment for optimization effort.

### Example 5: In-Test Cost Assertions

A developer writes a test that should be cheap and wants to enforce it at the test level:

```typescript
import { getCostForCurrentTest } from 'llm-cost-per-test';

it('classifies feedback cheaply', async () => {
  const result = await classify('Great product!');
  expect(result.label).toBe('positive');

  const cost = getCostForCurrentTest();
  expect(cost!.totalCost).toBeLessThan(0.001);
  expect(cost!.totalApiCalls).toBe(1);
});
```

This assertion catches regressions where a code change accidentally introduces additional API calls or switches to a more expensive model.

### Example 6: Replay-Mode Cost Reporting with llm-vcr

A team uses `llm-vcr` for deterministic CI tests and wants cost visibility even in replay mode:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    reporters: [
      'default',
      ['llm-cost-per-test', {
        vcr: { cassettesDir: '__cassettes__' },
        baseline: { path: '.llm-cost-baseline.json' },
      }],
    ],
  },
});
```

In CI (replay mode), no real API calls are made, but the cost report shows what the suite would cost based on cassette token data. The team tracks this "would-cost" over time and uses it to make decisions about when to re-record cassettes with cheaper models.
