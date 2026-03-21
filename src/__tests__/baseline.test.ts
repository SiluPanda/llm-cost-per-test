import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadBaseline,
  saveBaseline,
  compareBaseline,
  evaluateBaselineThresholds,
  shouldUpdateBaseline,
} from '../baseline';
import type { CostBaseline, TestCostEntry, BaselineConfig } from '../types';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llm-cost-test-'));
}

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

const sampleBaseline: CostBaseline = {
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  totalCost: 0.0345,
  tests: {
    'test A': { cost: 0.01, inputTokens: 100, outputTokens: 50, model: 'gpt-4o', apiCalls: 1, file: 'a.ts' },
    'test B': { cost: 0.02, inputTokens: 200, outputTokens: 100, model: 'gpt-4o', apiCalls: 1, file: 'b.ts' },
    'test C': { cost: 0.0045, inputTokens: 50, outputTokens: 25, model: 'gpt-4o-mini', apiCalls: 1, file: 'c.ts' },
  },
};

describe('baseline', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadBaseline', () => {
    it('returns null when file does not exist', () => {
      const result = loadBaseline(path.join(tempDir, 'nonexistent.json'));
      expect(result).toBeNull();
    });

    it('loads valid baseline file', () => {
      const filePath = path.join(tempDir, 'baseline.json');
      fs.writeFileSync(filePath, JSON.stringify(sampleBaseline));
      const result = loadBaseline(filePath);
      expect(result).not.toBeNull();
      expect(result!.version).toBe(1);
      expect(result!.totalCost).toBe(0.0345);
      expect(Object.keys(result!.tests)).toHaveLength(3);
    });

    it('returns null for invalid JSON with error message', () => {
      const filePath = path.join(tempDir, 'bad.json');
      fs.writeFileSync(filePath, '{ not valid json }}}');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = loadBaseline(filePath);
      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid JSON')
      );
      errorSpy.mockRestore();
    });

    it('returns null for file with invalid format', () => {
      const filePath = path.join(tempDir, 'wrong.json');
      fs.writeFileSync(filePath, JSON.stringify({ foo: 'bar' }));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = loadBaseline(filePath);
      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid format')
      );
      errorSpy.mockRestore();
    });
  });

  describe('saveBaseline', () => {
    it('writes baseline file', () => {
      const filePath = path.join(tempDir, 'output.json');
      const tests = [
        makeTestEntry('test1', 0.01, 'a.ts'),
        makeTestEntry('test2', 0.02, 'b.ts'),
      ];
      saveBaseline(filePath, tests, 0.03);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.version).toBe(1);
      expect(content.totalCost).toBe(0.03);
      expect(content.tests['test1']).toBeDefined();
      expect(content.tests['test2']).toBeDefined();
    });

    it('creates parent directories if needed', () => {
      const filePath = path.join(tempDir, 'sub/dir/baseline.json');
      saveBaseline(filePath, [], 0);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('includes model, apiCalls, and file in saved baseline', () => {
      const filePath = path.join(tempDir, 'detail.json');
      const tests = [makeTestEntry('test1', 0.01, 'my-file.ts')];
      saveBaseline(filePath, tests, 0.01);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.tests['test1'].model).toBe('gpt-4o');
      expect(content.tests['test1'].apiCalls).toBe(1);
      expect(content.tests['test1'].file).toBe('my-file.ts');
    });

    it('includes createdAt timestamp', () => {
      const filePath = path.join(tempDir, 'ts.json');
      saveBaseline(filePath, [], 0);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('compareBaseline', () => {
    it('returns zero diffs when costs are unchanged', () => {
      const currentTests = [
        makeTestEntry('test A', 0.01, 'a.ts'),
        makeTestEntry('test B', 0.02, 'b.ts'),
        makeTestEntry('test C', 0.0045, 'c.ts'),
      ];
      const diff = compareBaseline('baseline.json', sampleBaseline, currentTests, 0.0345);
      expect(diff.costChange).toBeCloseTo(0, 8);
      expect(diff.percentageChange).toBeCloseTo(0, 8);
      expect(diff.newTests).toHaveLength(0);
      expect(diff.removedTests).toHaveLength(0);
    });

    it('detects cost increase', () => {
      const currentTests = [
        makeTestEntry('test A', 0.02, 'a.ts'), // doubled
        makeTestEntry('test B', 0.02, 'b.ts'),
        makeTestEntry('test C', 0.0045, 'c.ts'),
      ];
      const newTotal = 0.0445;
      const diff = compareBaseline('baseline.json', sampleBaseline, currentTests, newTotal);
      expect(diff.costChange).toBeCloseTo(0.01, 8);
      expect(diff.percentageChange).toBeGreaterThan(0);

      const testADiff = diff.tests.find(t => t.testName === 'test A');
      expect(testADiff).toBeDefined();
      expect(testADiff!.costChange).toBeCloseTo(0.01, 8);
      expect(testADiff!.percentageChange).toBeCloseTo(1.0, 4); // 100% increase
    });

    it('detects cost decrease', () => {
      const currentTests = [
        makeTestEntry('test A', 0.005, 'a.ts'), // halved
        makeTestEntry('test B', 0.02, 'b.ts'),
        makeTestEntry('test C', 0.0045, 'c.ts'),
      ];
      const newTotal = 0.0295;
      const diff = compareBaseline('baseline.json', sampleBaseline, currentTests, newTotal);
      expect(diff.costChange).toBeLessThan(0);

      const testADiff = diff.tests.find(t => t.testName === 'test A');
      expect(testADiff!.costChange).toBeCloseTo(-0.005, 8);
      expect(testADiff!.percentageChange).toBeCloseTo(-0.5, 4); // 50% decrease
    });

    it('identifies new tests', () => {
      const currentTests = [
        makeTestEntry('test A', 0.01, 'a.ts'),
        makeTestEntry('test B', 0.02, 'b.ts'),
        makeTestEntry('test C', 0.0045, 'c.ts'),
        makeTestEntry('test D', 0.015, 'd.ts'), // new
      ];
      const diff = compareBaseline('baseline.json', sampleBaseline, currentTests, 0.0495);
      expect(diff.newTests).toHaveLength(1);
      expect(diff.newTests[0].testName).toBe('test D');
    });

    it('identifies removed tests', () => {
      const currentTests = [
        makeTestEntry('test A', 0.01, 'a.ts'),
        // test B and test C removed
      ];
      const diff = compareBaseline('baseline.json', sampleBaseline, currentTests, 0.01);
      expect(diff.removedTests).toHaveLength(2);
      expect(diff.removedTests).toContain('test B');
      expect(diff.removedTests).toContain('test C');
    });

    it('handles both new and removed tests', () => {
      const currentTests = [
        makeTestEntry('test A', 0.01, 'a.ts'),
        makeTestEntry('test NEW', 0.03, 'new.ts'),
      ];
      const diff = compareBaseline('baseline.json', sampleBaseline, currentTests, 0.04);
      expect(diff.newTests).toHaveLength(1);
      expect(diff.removedTests).toHaveLength(2);
    });

    it('handles empty baseline (baseline zero cost)', () => {
      const emptyBaseline: CostBaseline = {
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        totalCost: 0,
        tests: {},
      };
      const currentTests = [makeTestEntry('test1', 0.01)];
      const diff = compareBaseline('baseline.json', emptyBaseline, currentTests, 0.01);
      expect(diff.percentageChange).toBe(1); // 100% increase from zero
      expect(diff.newTests).toHaveLength(1);
    });

    it('populates baselinePath correctly', () => {
      const diff = compareBaseline('my/path/baseline.json', sampleBaseline, [], 0);
      expect(diff.baselinePath).toBe('my/path/baseline.json');
    });
  });

  describe('evaluateBaselineThresholds', () => {
    it('returns no warn/fail when under threshold', () => {
      const diff = {
        baselinePath: 'b.json',
        baselineTotalCost: 1.00,
        currentTotalCost: 1.05,
        costChange: 0.05,
        percentageChange: 0.05, // 5%
        tests: [],
        newTests: [],
        removedTests: [],
      };
      const config: BaselineConfig = { path: 'b.json', warnThreshold: 0.10, failThreshold: 0.25 };
      const result = evaluateBaselineThresholds(diff, config);
      expect(result.warn).toBe(false);
      expect(result.fail).toBe(false);
      expect(result.message).toBeNull();
    });

    it('warns when exceeding warn threshold but not fail threshold', () => {
      const diff = {
        baselinePath: 'b.json',
        baselineTotalCost: 1.00,
        currentTotalCost: 1.15,
        costChange: 0.15,
        percentageChange: 0.15, // 15%
        tests: [],
        newTests: [],
        removedTests: [],
      };
      const config: BaselineConfig = { path: 'b.json', warnThreshold: 0.10, failThreshold: 0.25 };
      const result = evaluateBaselineThresholds(diff, config);
      expect(result.warn).toBe(true);
      expect(result.fail).toBe(false);
      expect(result.message).toContain('WARNING');
      expect(result.message).toContain('15.0%');
    });

    it('fails when exceeding fail threshold', () => {
      const diff = {
        baselinePath: 'b.json',
        baselineTotalCost: 1.00,
        currentTotalCost: 1.30,
        costChange: 0.30,
        percentageChange: 0.30, // 30%
        tests: [],
        newTests: [],
        removedTests: [],
      };
      const config: BaselineConfig = { path: 'b.json', warnThreshold: 0.10, failThreshold: 0.25 };
      const result = evaluateBaselineThresholds(diff, config);
      expect(result.warn).toBe(true);
      expect(result.fail).toBe(true);
      expect(result.message).toContain('BASELINE VIOLATION');
      expect(result.message).toContain('30.0%');
    });

    it('uses default thresholds when not specified', () => {
      const diff = {
        baselinePath: 'b.json',
        baselineTotalCost: 1.00,
        currentTotalCost: 1.15,
        costChange: 0.15,
        percentageChange: 0.15, // 15% > default 10%
        tests: [],
        newTests: [],
        removedTests: [],
      };
      const config: BaselineConfig = { path: 'b.json' };
      const result = evaluateBaselineThresholds(diff, config);
      expect(result.warn).toBe(true);
      expect(result.fail).toBe(false);
    });

    it('handles cost decrease (no violation)', () => {
      const diff = {
        baselinePath: 'b.json',
        baselineTotalCost: 1.00,
        currentTotalCost: 0.50,
        costChange: -0.50,
        percentageChange: -0.50, // -50%
        tests: [],
        newTests: [],
        removedTests: [],
      };
      const config: BaselineConfig = { path: 'b.json', warnThreshold: 0.10, failThreshold: 0.25 };
      const result = evaluateBaselineThresholds(diff, config);
      expect(result.warn).toBe(false);
      expect(result.fail).toBe(false);
    });
  });

  describe('shouldUpdateBaseline', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns false when no config and no env var', () => {
      expect(shouldUpdateBaseline()).toBe(false);
    });

    it('returns true when config.update is true', () => {
      expect(shouldUpdateBaseline({ path: 'b.json', update: true })).toBe(true);
    });

    it('returns false when config.update is false', () => {
      expect(shouldUpdateBaseline({ path: 'b.json', update: false })).toBe(false);
    });

    it('returns true when env var is "1"', () => {
      process.env.LLM_COST_UPDATE_BASELINE = '1';
      expect(shouldUpdateBaseline({ path: 'b.json', update: false })).toBe(true);
    });

    it('returns true when env var is "true"', () => {
      process.env.LLM_COST_UPDATE_BASELINE = 'true';
      expect(shouldUpdateBaseline()).toBe(true);
    });

    it('returns true when env var is "yes"', () => {
      process.env.LLM_COST_UPDATE_BASELINE = 'yes';
      expect(shouldUpdateBaseline()).toBe(true);
    });

    it('env var overrides config.update=false', () => {
      process.env.LLM_COST_UPDATE_BASELINE = '1';
      expect(shouldUpdateBaseline({ path: 'b.json', update: false })).toBe(true);
    });
  });
});
