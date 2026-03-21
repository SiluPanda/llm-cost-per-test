import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkBudget, resolveBudget, formatViolation } from '../budget';
import type { TestCostEntry, FileCostEntry, BudgetViolation } from '../types';

function makeTestEntry(name: string, cost: number, file = 'test.ts'): TestCostEntry {
  return {
    testName: name,
    filePath: file,
    cost,
    inputTokens: 100,
    outputTokens: 50,
    apiCalls: 1,
    records: [{
      model: 'gpt-4o',
      inputTokens: 100,
      outputTokens: 50,
      cost,
      timestamp: new Date().toISOString(),
    }],
  };
}

function makeFileEntry(path: string, cost: number, testCount = 1): FileCostEntry {
  return { filePath: path, cost, testCount, apiCalls: testCount };
}

describe('budget', () => {
  describe('checkBudget', () => {
    it('returns empty violations when no budgets are set', () => {
      const tests = [makeTestEntry('test1', 1.00)];
      const files = [makeFileEntry('test.ts', 1.00)];
      const violations = checkBudget({}, tests, files, 1.00);
      expect(violations).toHaveLength(0);
    });

    it('returns empty violations when all costs are under budget', () => {
      const tests = [makeTestEntry('test1', 0.10)];
      const files = [makeFileEntry('test.ts', 0.10)];
      const violations = checkBudget(
        { perTest: 0.50, perFile: 1.00, perSuite: 5.00 },
        tests, files, 0.10
      );
      expect(violations).toHaveLength(0);
    });

    it('detects per-test budget violation', () => {
      const tests = [
        makeTestEntry('cheap test', 0.10),
        makeTestEntry('expensive test', 0.60),
      ];
      const files = [makeFileEntry('test.ts', 0.70)];
      const violations = checkBudget({ perTest: 0.50 }, tests, files, 0.70);
      expect(violations).toHaveLength(1);
      expect(violations[0].level).toBe('perTest');
      expect(violations[0].name).toBe('expensive test');
      expect(violations[0].actualCost).toBe(0.60);
      expect(violations[0].budgetCost).toBe(0.50);
    });

    it('detects multiple per-test violations', () => {
      const tests = [
        makeTestEntry('test1', 0.60),
        makeTestEntry('test2', 0.70),
        makeTestEntry('test3', 0.10),
      ];
      const files = [makeFileEntry('test.ts', 1.40)];
      const violations = checkBudget({ perTest: 0.50 }, tests, files, 1.40);
      expect(violations).toHaveLength(2);
      expect(violations.map(v => v.name)).toContain('test1');
      expect(violations.map(v => v.name)).toContain('test2');
    });

    it('detects per-file budget violation', () => {
      const tests = [
        makeTestEntry('test1', 0.80, 'expensive.ts'),
        makeTestEntry('test2', 0.50, 'expensive.ts'),
      ];
      const files = [makeFileEntry('expensive.ts', 1.30, 2)];
      const violations = checkBudget({ perFile: 1.00 }, tests, files, 1.30);
      expect(violations).toHaveLength(1);
      expect(violations[0].level).toBe('perFile');
      expect(violations[0].name).toBe('expensive.ts');
    });

    it('detects per-suite budget violation', () => {
      const tests = [makeTestEntry('test1', 5.00)];
      const files = [makeFileEntry('test.ts', 5.00)];
      const violations = checkBudget({ perSuite: 3.00 }, tests, files, 5.00);
      expect(violations).toHaveLength(1);
      expect(violations[0].level).toBe('perSuite');
      expect(violations[0].name).toBe('suite');
      expect(violations[0].actualCost).toBe(5.00);
    });

    it('reports all violations across all levels', () => {
      const tests = [makeTestEntry('expensive test', 2.00, 'big.ts')];
      const files = [makeFileEntry('big.ts', 2.00)];
      const violations = checkBudget(
        { perTest: 1.00, perFile: 1.50, perSuite: 1.50 },
        tests, files, 2.00
      );
      expect(violations).toHaveLength(3);
      const levels = violations.map(v => v.level);
      expect(levels).toContain('perTest');
      expect(levels).toContain('perFile');
      expect(levels).toContain('perSuite');
    });

    it('does not trigger violation at exact budget boundary', () => {
      const tests = [makeTestEntry('test1', 0.50)];
      const files = [makeFileEntry('test.ts', 0.50)];
      const violations = checkBudget({ perTest: 0.50 }, tests, files, 0.50);
      expect(violations).toHaveLength(0);
    });

    it('handles empty test list', () => {
      const violations = checkBudget({ perTest: 0.50, perSuite: 1.00 }, [], [], 0);
      expect(violations).toHaveLength(0);
    });
  });

  describe('resolveBudget', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns empty budget when no options or env vars', () => {
      const budget = resolveBudget();
      expect(budget.perTest).toBeUndefined();
      expect(budget.perFile).toBeUndefined();
      expect(budget.perSuite).toBeUndefined();
    });

    it('uses options when no env vars set', () => {
      const budget = resolveBudget({ perTest: 0.50, perFile: 2.00, perSuite: 10.00 });
      expect(budget.perTest).toBe(0.50);
      expect(budget.perFile).toBe(2.00);
      expect(budget.perSuite).toBe(10.00);
    });

    it('env var overrides perTest', () => {
      process.env.LLM_COST_BUDGET_PER_TEST = '0.75';
      const budget = resolveBudget({ perTest: 0.50 });
      expect(budget.perTest).toBe(0.75);
    });

    it('env var overrides perFile', () => {
      process.env.LLM_COST_BUDGET_PER_FILE = '3.00';
      const budget = resolveBudget({ perFile: 2.00 });
      expect(budget.perFile).toBe(3.00);
    });

    it('env var overrides perSuite', () => {
      process.env.LLM_COST_BUDGET_PER_SUITE = '15.00';
      const budget = resolveBudget({ perSuite: 10.00 });
      expect(budget.perSuite).toBe(15.00);
    });

    it('ignores invalid env var values', () => {
      process.env.LLM_COST_BUDGET_PER_TEST = 'not-a-number';
      const budget = resolveBudget({ perTest: 0.50 });
      expect(budget.perTest).toBe(0.50);
    });

    it('ignores empty env var values', () => {
      process.env.LLM_COST_BUDGET_PER_TEST = '';
      const budget = resolveBudget({ perTest: 0.50 });
      expect(budget.perTest).toBe(0.50);
    });
  });

  describe('formatViolation', () => {
    it('formats per-test violation', () => {
      const v: BudgetViolation = {
        level: 'perTest',
        name: 'my expensive test',
        actualCost: 0.60,
        budgetCost: 0.50,
      };
      const msg = formatViolation(v);
      expect(msg).toContain('BUDGET VIOLATION');
      expect(msg).toContain('Test');
      expect(msg).toContain('my expensive test');
      expect(msg).toContain('$0.6000');
      expect(msg).toContain('$0.5000');
    });

    it('formats per-file violation', () => {
      const v: BudgetViolation = {
        level: 'perFile',
        name: 'expensive.test.ts',
        actualCost: 2.50,
        budgetCost: 2.00,
      };
      const msg = formatViolation(v);
      expect(msg).toContain('File');
      expect(msg).toContain('expensive.test.ts');
    });

    it('formats per-suite violation', () => {
      const v: BudgetViolation = {
        level: 'perSuite',
        name: 'suite',
        actualCost: 15.00,
        budgetCost: 10.00,
      };
      const msg = formatViolation(v);
      expect(msg).toContain('Suite');
      expect(msg).toContain('suite');
    });
  });
});
