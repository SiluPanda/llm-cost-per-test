import * as fs from 'node:fs';
import type {
  CostReporterOptions,
  CostReport,
  TestCostEntry,
  FileCostEntry,
  ModelCostEntry,
  BudgetViolation,
  BaselineDiff,
  OutputFormat,
  CostTracker,
} from './types';
import { createCostTracker } from './tracker';
import { registerPricing } from './pricing';
import { checkBudget, resolveBudget, formatViolation } from './budget';
import { loadBaseline, saveBaseline, compareBaseline, evaluateBaselineThresholds, shouldUpdateBaseline } from './baseline';
import { formatTable, formatJSON, formatMarkdown, formatJUnit } from './formatter';

/**
 * Resolve reporter options with defaults and environment variable overrides.
 */
function resolveOptions(options?: CostReporterOptions): Required<Omit<CostReporterOptions, 'baseline'>> & {
  baseline?: CostReporterOptions['baseline'];
} {
  const envOutput = process.env.LLM_COST_OUTPUT as OutputFormat | undefined;
  const envOutputFile = process.env.LLM_COST_OUTPUT_FILE;

  return {
    output: envOutput || options?.output || 'table',
    outputFile: envOutputFile || options?.outputFile || '',
    budget: resolveBudget(options?.budget),
    baseline: options?.baseline,
    pricing: options?.pricing || {},
    interception: options?.interception || 'auto',
    topN: options?.topN ?? 10,
    showModelBreakdown: options?.showModelBreakdown ?? true,
    showFileBreakdown: options?.showFileBreakdown ?? true,
    showPerTestTable: options?.showPerTestTable ?? true,
    minCostToShow: options?.minCostToShow ?? 0,
  };
}

/**
 * LLMCostReporter - A standalone, framework-agnostic cost reporter.
 *
 * Provides methods to track per-test LLM API costs, enforce budgets,
 * compare against baselines, and generate reports in multiple formats.
 *
 * Usage:
 *   const reporter = createReporter(options);
 *   reporter.startTest('test name', 'test/file.ts');
 *   reporter.recordApiCall('test name', 'gpt-4o', 500, 150);
 *   reporter.endTest('test name');
 *   const report = reporter.generateReport();
 */
export class LLMCostReporter {
  private options: ReturnType<typeof resolveOptions>;
  private trackers: Map<string, CostTracker> = new Map();
  private testFiles: Map<string, string> = new Map();
  private completedTests: Set<string> = new Set();
  private totalTestCount = 0;

  constructor(options?: CostReporterOptions) {
    this.options = resolveOptions(options);

    // Register custom pricing if provided
    if (this.options.pricing && Object.keys(this.options.pricing).length > 0) {
      registerPricing(this.options.pricing);
    }
  }

  /**
   * Start tracking a test. Creates a new CostTracker for the test.
   */
  startTest(testName: string, filePath: string): void {
    const tracker = createCostTracker();
    this.trackers.set(testName, tracker);
    this.testFiles.set(testName, filePath);
    this.totalTestCount++;
  }

  /**
   * Mark a test as completed.
   */
  endTest(testName: string): void {
    this.completedTests.add(testName);
  }

  /**
   * Record an LLM API call for a specific test.
   */
  recordApiCall(testName: string, model: string, inputTokens: number, outputTokens: number, cost?: number): void {
    let tracker = this.trackers.get(testName);
    if (!tracker) {
      // Auto-create tracker if startTest wasn't called
      tracker = createCostTracker();
      this.trackers.set(testName, tracker);
      this.totalTestCount++;
      if (!this.testFiles.has(testName)) {
        this.testFiles.set(testName, 'unknown');
      }
    }
    tracker.record({ model, inputTokens, outputTokens, cost });
  }

  /**
   * Get the CostTracker for a specific test.
   */
  getTracker(testName: string): CostTracker | undefined {
    return this.trackers.get(testName);
  }

  /**
   * Generate the full cost report from all tracked tests.
   */
  generateReport(): CostReport {
    const tests = this.buildTestEntries();
    const files = this.buildFileEntries(tests);
    const models = this.buildModelEntries(tests);

    const totalCost = tests.reduce((sum, t) => sum + t.cost, 0);
    const totalInputTokens = tests.reduce((sum, t) => sum + t.inputTokens, 0);
    const totalOutputTokens = tests.reduce((sum, t) => sum + t.outputTokens, 0);
    const totalApiCalls = tests.reduce((sum, t) => sum + t.apiCalls, 0);
    const testsWithCalls = tests.filter(t => t.apiCalls > 0).length;

    // Budget check
    const budgetViolations = checkBudget(this.options.budget, tests, files, totalCost);

    // Baseline comparison
    let baselineDiff: BaselineDiff | undefined;
    if (this.options.baseline?.path) {
      if (shouldUpdateBaseline(this.options.baseline)) {
        saveBaseline(this.options.baseline.path, tests, totalCost);
      } else {
        const baseline = loadBaseline(this.options.baseline.path);
        if (baseline) {
          baselineDiff = compareBaseline(
            this.options.baseline.path,
            baseline,
            tests,
            totalCost,
          );
        }
      }
    }

    const report: CostReport = {
      version: 1,
      createdAt: new Date().toISOString(),
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      totalApiCalls,
      testsWithCalls,
      totalTests: this.totalTestCount || tests.length,
      tests,
      files,
      models,
      budgetViolations,
      baselineDiff,
    };

    return report;
  }

  /**
   * Generate and output the report in the configured format.
   * Returns the report object and any budget/baseline violations.
   */
  finalize(): {
    report: CostReport;
    violations: BudgetViolation[];
    baselineResult: { warn: boolean; fail: boolean; message: string | null } | null;
    output: string;
  } {
    const report = this.generateReport();

    // Format report
    let output: string;
    switch (this.options.output) {
      case 'json':
        output = formatJSON(report);
        break;
      case 'markdown':
        output = formatMarkdown(report);
        break;
      case 'junit':
        output = formatJUnit(report);
        break;
      case 'table':
      default:
        output = formatTable(report, {
          topN: this.options.topN,
          showModelBreakdown: this.options.showModelBreakdown,
          showFileBreakdown: this.options.showFileBreakdown,
          showPerTestTable: this.options.showPerTestTable,
          minCostToShow: this.options.minCostToShow,
        });
        break;
    }

    // Write to file or stdout
    if (this.options.outputFile) {
      fs.writeFileSync(this.options.outputFile, output, 'utf-8');
    } else {
      process.stdout.write(output);
    }

    // Evaluate baseline thresholds
    let baselineResult: { warn: boolean; fail: boolean; message: string | null } | null = null;
    if (report.baselineDiff && this.options.baseline) {
      baselineResult = evaluateBaselineThresholds(report.baselineDiff, this.options.baseline);
      if (baselineResult.message) {
        if (baselineResult.fail) {
          console.error(baselineResult.message);
        } else {
          console.warn(baselineResult.message);
        }
      }
    }

    // Print budget violations
    if (report.budgetViolations.length > 0) {
      for (const v of report.budgetViolations) {
        console.error(formatViolation(v));
      }
    }

    return {
      report,
      violations: report.budgetViolations,
      baselineResult,
      output,
    };
  }

  /**
   * Check budgets against current data.
   */
  checkBudget(): BudgetViolation[] {
    const tests = this.buildTestEntries();
    const files = this.buildFileEntries(tests);
    const totalCost = tests.reduce((sum, t) => sum + t.cost, 0);
    return checkBudget(this.options.budget, tests, files, totalCost);
  }

  /**
   * Reset all tracked data.
   */
  reset(): void {
    this.trackers.clear();
    this.testFiles.clear();
    this.completedTests.clear();
    this.totalTestCount = 0;
  }

  // ── Private Helpers ─────────────────────────────────────────────

  private buildTestEntries(): TestCostEntry[] {
    const entries: TestCostEntry[] = [];

    for (const [testName, tracker] of this.trackers.entries()) {
      const records = tracker.getEntries();
      const summary = tracker.getCost();
      const filePath = this.testFiles.get(testName) || 'unknown';

      entries.push({
        testName,
        filePath,
        cost: summary.totalCost,
        inputTokens: summary.totalInputTokens,
        outputTokens: summary.totalOutputTokens,
        apiCalls: summary.totalApiCalls,
        records: [...records],
      });
    }

    return entries;
  }

  private buildFileEntries(tests: TestCostEntry[]): FileCostEntry[] {
    const fileMap = new Map<string, { cost: number; testCount: number; apiCalls: number }>();

    for (const test of tests) {
      const existing = fileMap.get(test.filePath);
      if (existing) {
        existing.cost += test.cost;
        existing.testCount += 1;
        existing.apiCalls += test.apiCalls;
      } else {
        fileMap.set(test.filePath, {
          cost: test.cost,
          testCount: 1,
          apiCalls: test.apiCalls,
        });
      }
    }

    return Array.from(fileMap.entries()).map(([filePath, data]) => ({
      filePath,
      cost: data.cost,
      testCount: data.testCount,
      apiCalls: data.apiCalls,
    }));
  }

  private buildModelEntries(tests: TestCostEntry[]): ModelCostEntry[] {
    const modelMap = new Map<string, { cost: number; apiCalls: number; inputTokens: number; outputTokens: number }>();

    for (const test of tests) {
      for (const record of test.records) {
        const existing = modelMap.get(record.model);
        if (existing) {
          existing.cost += record.cost;
          existing.apiCalls += 1;
          existing.inputTokens += record.inputTokens;
          existing.outputTokens += record.outputTokens;
        } else {
          modelMap.set(record.model, {
            cost: record.cost,
            apiCalls: 1,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
          });
        }
      }
    }

    const totalCost = tests.reduce((sum, t) => sum + t.cost, 0);

    return Array.from(modelMap.entries())
      .map(([model, data]) => ({
        model,
        cost: data.cost,
        percentage: totalCost > 0 ? data.cost / totalCost : 0,
        apiCalls: data.apiCalls,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
      }))
      .sort((a, b) => b.cost - a.cost);
  }
}

/**
 * Factory function to create a reporter instance.
 */
export function createReporter(options?: CostReporterOptions): LLMCostReporter {
  return new LLMCostReporter(options);
}
