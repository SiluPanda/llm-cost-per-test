import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import type { CostBaseline, BaselineDiff, TestCostEntry, TestCostDiff, BaselineConfig } from './types';

/**
 * Load a baseline JSON file. Returns null if the file does not exist.
 * If the file exists but contains invalid JSON, logs an error and returns null.
 */
export function loadBaseline(path: string): CostBaseline | null {
  try {
    if (!fs.existsSync(path)) {
      return null;
    }
    const content = fs.readFileSync(path, 'utf-8');
    const parsed = JSON.parse(content) as CostBaseline;

    // Basic validation
    if (typeof parsed.version !== 'number' || typeof parsed.totalCost !== 'number' || !parsed.tests) {
      console.error(`[llm-cost-per-test] Baseline file "${path}" has invalid format. Skipping baseline comparison.`);
      return null;
    }

    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`[llm-cost-per-test] Baseline file "${path}" contains invalid JSON. Skipping baseline comparison.`);
    } else {
      console.error(`[llm-cost-per-test] Failed to read baseline file "${path}": ${err}`);
    }
    return null;
  }
}

/**
 * Save a baseline file with the current run's cost data.
 */
export function saveBaseline(path: string, tests: TestCostEntry[], totalCost: number): void {
  const baseline: CostBaseline = {
    version: 1,
    createdAt: new Date().toISOString(),
    totalCost,
    tests: {},
  };

  for (const test of tests) {
    // Determine the primary model (most used)
    const modelCounts: Record<string, number> = {};
    for (const record of test.records) {
      modelCounts[record.model] = (modelCounts[record.model] || 0) + 1;
    }
    const primaryModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

    baseline.tests[test.testName] = {
      cost: test.cost,
      inputTokens: test.inputTokens,
      outputTokens: test.outputTokens,
      model: primaryModel,
      apiCalls: test.apiCalls,
      file: test.filePath,
    };
  }

  const dir = nodePath.dirname(path);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(path, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
}

/**
 * Compare current costs against a baseline. Returns a BaselineDiff.
 */
export function compareBaseline(
  baselinePath: string,
  baseline: CostBaseline,
  currentTests: TestCostEntry[],
  currentTotalCost: number,
): BaselineDiff {
  const costChange = currentTotalCost - baseline.totalCost;
  const percentageChange = baseline.totalCost === 0 ? (currentTotalCost > 0 ? 1 : 0) : costChange / baseline.totalCost;

  const testDiffs: TestCostDiff[] = [];
  const newTests: TestCostEntry[] = [];
  const currentTestMap = new Map<string, TestCostEntry>();

  for (const test of currentTests) {
    currentTestMap.set(test.testName, test);
  }

  // Check current tests against baseline
  for (const test of currentTests) {
    const baselineTest = baseline.tests[test.testName];
    if (baselineTest) {
      const diff = test.cost - baselineTest.cost;
      const pctChange = baselineTest.cost === 0 ? (test.cost > 0 ? 1 : 0) : diff / baselineTest.cost;
      testDiffs.push({
        testName: test.testName,
        baselineCost: baselineTest.cost,
        currentCost: test.cost,
        costChange: diff,
        percentageChange: pctChange,
      });
    } else {
      newTests.push(test);
    }
  }

  // Find removed tests (in baseline but not in current)
  const removedTests: string[] = [];
  for (const testName of Object.keys(baseline.tests)) {
    if (!currentTestMap.has(testName)) {
      removedTests.push(testName);
    }
  }

  return {
    baselinePath,
    baselineTotalCost: baseline.totalCost,
    currentTotalCost,
    costChange,
    percentageChange,
    tests: testDiffs,
    newTests,
    removedTests,
  };
}

/**
 * Check if the baseline diff exceeds the configured thresholds.
 * Returns { warn: boolean, fail: boolean } indicating the status.
 */
export function evaluateBaselineThresholds(
  diff: BaselineDiff,
  config: BaselineConfig,
): { warn: boolean; fail: boolean; message: string | null } {
  const warnThreshold = config.warnThreshold ?? 0.10;
  const failThreshold = config.failThreshold ?? 0.25;

  if (diff.percentageChange > failThreshold) {
    const pct = (diff.percentageChange * 100).toFixed(1);
    return {
      warn: true,
      fail: true,
      message: `BASELINE VIOLATION: Total cost increased by ${pct}% (from $${diff.baselineTotalCost.toFixed(4)} to $${diff.currentTotalCost.toFixed(4)}), exceeding the fail threshold of ${(failThreshold * 100).toFixed(0)}%.`,
    };
  }

  if (diff.percentageChange > warnThreshold) {
    const pct = (diff.percentageChange * 100).toFixed(1);
    return {
      warn: true,
      fail: false,
      message: `WARNING: Total cost increased by ${pct}% (from $${diff.baselineTotalCost.toFixed(4)} to $${diff.currentTotalCost.toFixed(4)}), exceeding the warn threshold of ${(warnThreshold * 100).toFixed(0)}%.`,
    };
  }

  return { warn: false, fail: false, message: null };
}

/**
 * Resolve whether the baseline should be updated based on config and env vars.
 */
export function shouldUpdateBaseline(config?: BaselineConfig): boolean {
  const envValue = process.env.LLM_COST_UPDATE_BASELINE;
  if (envValue === '1' || envValue === 'true' || envValue === 'yes') {
    return true;
  }
  return config?.update === true;
}
