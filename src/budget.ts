import type { CostBudget, BudgetViolation, TestCostEntry, FileCostEntry } from './types';

/**
 * Check cost data against budget thresholds.
 * Returns all violations found across all budget levels.
 */
export function checkBudget(
  budget: CostBudget,
  tests: TestCostEntry[],
  files: FileCostEntry[],
  totalCost: number,
): BudgetViolation[] {
  const violations: BudgetViolation[] = [];

  // Per-test budget check
  if (budget.perTest !== undefined) {
    for (const test of tests) {
      if (test.cost > budget.perTest) {
        violations.push({
          level: 'perTest',
          name: test.testName,
          actualCost: test.cost,
          budgetCost: budget.perTest,
        });
      }
    }
  }

  // Per-file budget check
  if (budget.perFile !== undefined) {
    for (const file of files) {
      if (file.cost > budget.perFile) {
        violations.push({
          level: 'perFile',
          name: file.filePath,
          actualCost: file.cost,
          budgetCost: budget.perFile,
        });
      }
    }
  }

  // Per-suite budget check
  if (budget.perSuite !== undefined) {
    if (totalCost > budget.perSuite) {
      violations.push({
        level: 'perSuite',
        name: 'suite',
        actualCost: totalCost,
        budgetCost: budget.perSuite,
      });
    }
  }

  return violations;
}

/**
 * Resolve budget configuration, applying environment variable overrides.
 * Environment variables take highest priority.
 */
export function resolveBudget(optionsBudget?: CostBudget): CostBudget {
  const budget: CostBudget = { ...optionsBudget };

  const envPerTest = process.env.LLM_COST_BUDGET_PER_TEST;
  if (envPerTest !== undefined && envPerTest !== '') {
    const parsed = parseFloat(envPerTest);
    if (!isNaN(parsed)) {
      budget.perTest = parsed;
    }
  }

  const envPerFile = process.env.LLM_COST_BUDGET_PER_FILE;
  if (envPerFile !== undefined && envPerFile !== '') {
    const parsed = parseFloat(envPerFile);
    if (!isNaN(parsed)) {
      budget.perFile = parsed;
    }
  }

  const envPerSuite = process.env.LLM_COST_BUDGET_PER_SUITE;
  if (envPerSuite !== undefined && envPerSuite !== '') {
    const parsed = parseFloat(envPerSuite);
    if (!isNaN(parsed)) {
      budget.perSuite = parsed;
    }
  }

  return budget;
}

/**
 * Format budget violation messages for display.
 */
export function formatViolation(violation: BudgetViolation): string {
  const levelLabel =
    violation.level === 'perTest' ? 'Test' :
    violation.level === 'perFile' ? 'File' :
    'Suite';

  return `BUDGET VIOLATION: ${levelLabel} "${violation.name}" cost $${violation.actualCost.toFixed(4)}, exceeding ${violation.level} budget of $${violation.budgetCost.toFixed(4)}.`;
}
