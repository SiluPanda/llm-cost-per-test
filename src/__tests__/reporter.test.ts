import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LLMCostReporter, createReporter } from '../reporter';
import { resetPricing } from '../pricing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llm-reporter-'));
}

describe('LLMCostReporter', () => {
  beforeEach(() => {
    resetPricing();
  });

  describe('startTest / endTest / recordApiCall', () => {
    it('tracks a simple test lifecycle', () => {
      const reporter = createReporter();
      reporter.startTest('my test', 'test.ts');
      reporter.recordApiCall('my test', 'gpt-4o', 500, 150);
      reporter.endTest('my test');
      const report = reporter.generateReport();
      expect(report.tests).toHaveLength(1);
      expect(report.tests[0].testName).toBe('my test');
      expect(report.tests[0].cost).toBeCloseTo(0.00275, 8);
    });

    it('tracks multiple tests', () => {
      const reporter = createReporter();
      reporter.startTest('test A', 'a.ts');
      reporter.startTest('test B', 'b.ts');
      reporter.recordApiCall('test A', 'gpt-4o', 100, 50);
      reporter.recordApiCall('test B', 'gpt-4o-mini', 200, 100);
      reporter.endTest('test A');
      reporter.endTest('test B');
      const report = reporter.generateReport();
      expect(report.tests).toHaveLength(2);
    });

    it('tracks multiple API calls per test', () => {
      const reporter = createReporter();
      reporter.startTest('multi-call test', 'test.ts');
      reporter.recordApiCall('multi-call test', 'gpt-4o', 100, 50);
      reporter.recordApiCall('multi-call test', 'gpt-4o', 200, 100);
      reporter.recordApiCall('multi-call test', 'gpt-4o', 300, 150);
      reporter.endTest('multi-call test');
      const report = reporter.generateReport();
      expect(report.tests[0].apiCalls).toBe(3);
      expect(report.tests[0].records).toHaveLength(3);
    });

    it('auto-creates tracker for recordApiCall without startTest', () => {
      const reporter = createReporter();
      reporter.recordApiCall('auto test', 'gpt-4o', 100, 50);
      const report = reporter.generateReport();
      expect(report.tests).toHaveLength(1);
      expect(report.tests[0].testName).toBe('auto test');
    });

    it('records manual cost override via recordApiCall', () => {
      const reporter = createReporter();
      reporter.startTest('manual cost', 'test.ts');
      reporter.recordApiCall('manual cost', 'custom-model', 100, 50, 0.05);
      reporter.endTest('manual cost');
      const report = reporter.generateReport();
      expect(report.tests[0].cost).toBe(0.05);
    });
  });

  describe('generateReport', () => {
    it('produces correct report structure', () => {
      const reporter = createReporter();
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      const report = reporter.generateReport();

      expect(report.version).toBe(1);
      expect(report.createdAt).toBeDefined();
      expect(typeof report.totalCost).toBe('number');
      expect(typeof report.totalInputTokens).toBe('number');
      expect(typeof report.totalOutputTokens).toBe('number');
      expect(typeof report.totalApiCalls).toBe('number');
      expect(typeof report.testsWithCalls).toBe('number');
      expect(typeof report.totalTests).toBe('number');
      expect(Array.isArray(report.tests)).toBe(true);
      expect(Array.isArray(report.files)).toBe(true);
      expect(Array.isArray(report.models)).toBe(true);
      expect(Array.isArray(report.budgetViolations)).toBe(true);
    });

    it('computes correct totals', () => {
      const reporter = createReporter();
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 500, 150);
      reporter.startTest('test2', 'b.ts');
      reporter.recordApiCall('test2', 'gpt-4o', 300, 100);
      reporter.endTest('test1');
      reporter.endTest('test2');
      const report = reporter.generateReport();

      expect(report.totalInputTokens).toBe(800);
      expect(report.totalOutputTokens).toBe(250);
      expect(report.totalApiCalls).toBe(2);
      expect(report.testsWithCalls).toBe(2);
    });

    it('aggregates file entries', () => {
      const reporter = createReporter();
      reporter.startTest('test1', 'same-file.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.startTest('test2', 'same-file.ts');
      reporter.recordApiCall('test2', 'gpt-4o', 200, 100);
      reporter.endTest('test1');
      reporter.endTest('test2');
      const report = reporter.generateReport();

      expect(report.files).toHaveLength(1);
      expect(report.files[0].filePath).toBe('same-file.ts');
      expect(report.files[0].testCount).toBe(2);
    });

    it('aggregates model entries', () => {
      const reporter = createReporter();
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.startTest('test2', 'b.ts');
      reporter.recordApiCall('test2', 'gpt-4o-mini', 200, 100);
      reporter.endTest('test1');
      reporter.endTest('test2');
      const report = reporter.generateReport();

      expect(report.models).toHaveLength(2);
      const models = report.models.map(m => m.model);
      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-4o-mini');
    });

    it('computes model percentages correctly', () => {
      const reporter = createReporter();
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 1_000_000, 0); // $2.50
      reporter.startTest('test2', 'b.ts');
      reporter.recordApiCall('test2', 'gpt-4o', 1_000_000, 0); // $2.50
      reporter.endTest('test1');
      reporter.endTest('test2');
      const report = reporter.generateReport();

      // Only gpt-4o, so it should be 100%
      expect(report.models[0].percentage).toBeCloseTo(1.0, 4);
    });

    it('reports empty when no tests tracked', () => {
      const reporter = createReporter();
      const report = reporter.generateReport();
      expect(report.tests).toHaveLength(0);
      expect(report.totalCost).toBe(0);
      expect(report.totalApiCalls).toBe(0);
    });

    it('handles test with no API calls', () => {
      const reporter = createReporter();
      reporter.startTest('empty test', 'test.ts');
      reporter.endTest('empty test');
      const report = reporter.generateReport();
      expect(report.tests).toHaveLength(1);
      expect(report.tests[0].cost).toBe(0);
      expect(report.tests[0].apiCalls).toBe(0);
      expect(report.testsWithCalls).toBe(0);
    });

    it('counts totalTests correctly', () => {
      const reporter = createReporter();
      reporter.startTest('test1', 'a.ts');
      reporter.startTest('test2', 'b.ts');
      reporter.startTest('test3', 'c.ts');
      reporter.endTest('test1');
      reporter.endTest('test2');
      reporter.endTest('test3');
      const report = reporter.generateReport();
      expect(report.totalTests).toBe(3);
    });
  });

  describe('checkBudget', () => {
    it('returns empty when no budget set', () => {
      const reporter = createReporter();
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      const violations = reporter.checkBudget();
      expect(violations).toHaveLength(0);
    });

    it('detects per-test budget violation', () => {
      const reporter = createReporter({ budget: { perTest: 0.001 } });
      reporter.startTest('expensive', 'a.ts');
      reporter.recordApiCall('expensive', 'gpt-4o', 500, 150);
      reporter.endTest('expensive');
      const violations = reporter.checkBudget();
      expect(violations).toHaveLength(1);
      expect(violations[0].level).toBe('perTest');
    });

    it('detects per-suite budget violation', () => {
      const reporter = createReporter({ budget: { perSuite: 0.001 } });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 500, 150);
      reporter.endTest('test1');
      const violations = reporter.checkBudget();
      expect(violations).toHaveLength(1);
      expect(violations[0].level).toBe('perSuite');
    });
  });

  describe('finalize', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = makeTempDir();
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('writes report to file when outputFile is set', () => {
      const outPath = path.join(tempDir, 'report.json');
      const reporter = createReporter({ output: 'json', outputFile: outPath });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      reporter.finalize();
      expect(fs.existsSync(outPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      expect(content.version).toBe(1);
    });

    it('returns the formatted output string', () => {
      const reporter = createReporter({ output: 'json' });
      // Suppress stdout
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      const result = reporter.finalize();
      expect(result.output).toBeDefined();
      const parsed = JSON.parse(result.output);
      expect(parsed.version).toBe(1);
      writeSpy.mockRestore();
    });

    it('returns violations in finalize result', () => {
      const reporter = createReporter({ output: 'json', budget: { perTest: 0.001 } });
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 500, 150);
      reporter.endTest('test1');
      const result = reporter.finalize();
      expect(result.violations).toHaveLength(1);
      writeSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('writes to stdout when no outputFile', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const reporter = createReporter({ output: 'table' });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      reporter.finalize();
      expect(writeSpy).toHaveBeenCalled();
      writeSpy.mockRestore();
    });

    it('generates markdown output', () => {
      const outPath = path.join(tempDir, 'report.md');
      const reporter = createReporter({ output: 'markdown', outputFile: outPath });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      reporter.finalize();
      const content = fs.readFileSync(outPath, 'utf-8');
      expect(content).toContain('## LLM Cost Report');
    });

    it('generates junit output', () => {
      const outPath = path.join(tempDir, 'report.xml');
      const reporter = createReporter({ output: 'junit', outputFile: outPath });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      reporter.finalize();
      const content = fs.readFileSync(outPath, 'utf-8');
      expect(content).toContain('<?xml');
    });
  });

  describe('baseline integration', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = makeTempDir();
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('saves baseline when update is true', () => {
      const baselinePath = path.join(tempDir, 'baseline.json');
      const reporter = createReporter({
        baseline: { path: baselinePath, update: true },
      });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      reporter.generateReport();
      expect(fs.existsSync(baselinePath)).toBe(true);
    });

    it('compares against existing baseline', () => {
      const baselinePath = path.join(tempDir, 'baseline.json');

      // Create a baseline first
      const baseline = {
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        totalCost: 0.01,
        tests: {
          'test1': { cost: 0.01, inputTokens: 100, outputTokens: 50, model: 'gpt-4o', apiCalls: 1, file: 'a.ts' },
        },
      };
      fs.writeFileSync(baselinePath, JSON.stringify(baseline));

      const reporter = createReporter({
        baseline: { path: baselinePath, update: false },
      });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 200, 100); // different cost
      reporter.endTest('test1');
      const report = reporter.generateReport();
      expect(report.baselineDiff).toBeDefined();
      expect(report.baselineDiff!.baselinePath).toBe(baselinePath);
    });

    it('handles missing baseline file gracefully', () => {
      const baselinePath = path.join(tempDir, 'nonexistent.json');
      const reporter = createReporter({
        baseline: { path: baselinePath, update: false },
      });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      const report = reporter.generateReport();
      expect(report.baselineDiff).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('clears all tracked data', () => {
      const reporter = createReporter();
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      reporter.reset();
      const report = reporter.generateReport();
      expect(report.tests).toHaveLength(0);
      expect(report.totalCost).toBe(0);
    });
  });

  describe('getTracker', () => {
    it('returns tracker for existing test', () => {
      const reporter = createReporter();
      reporter.startTest('test1', 'a.ts');
      const tracker = reporter.getTracker('test1');
      expect(tracker).toBeDefined();
    });

    it('returns undefined for non-existing test', () => {
      const reporter = createReporter();
      const tracker = reporter.getTracker('nonexistent');
      expect(tracker).toBeUndefined();
    });
  });

  describe('configuration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('uses environment variable for output format', () => {
      process.env.LLM_COST_OUTPUT = 'json';
      const reporter = createReporter();
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      const result = reporter.finalize();
      // Should be valid JSON
      expect(() => JSON.parse(result.output)).not.toThrow();
      writeSpy.mockRestore();
    });

    it('uses environment variable for output file', () => {
      const tempDir = makeTempDir();
      const outPath = path.join(tempDir, 'env-report.json');
      process.env.LLM_COST_OUTPUT = 'json';
      process.env.LLM_COST_OUTPUT_FILE = outPath;
      const reporter = createReporter();
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      reporter.finalize();
      expect(fs.existsSync(outPath)).toBe(true);
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('applies custom pricing from options', () => {
      const reporter = createReporter({
        pricing: { 'custom-model': { input: 100, output: 200 } },
      });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'custom-model', 1_000_000, 1_000_000);
      reporter.endTest('test1');
      const report = reporter.generateReport();
      // 100 + 200 = 300
      expect(report.tests[0].cost).toBe(300);
    });
  });
});

describe('createReporter', () => {
  it('returns an LLMCostReporter instance', () => {
    const reporter = createReporter();
    expect(reporter).toBeInstanceOf(LLMCostReporter);
  });

  it('accepts options', () => {
    const reporter = createReporter({ output: 'json', topN: 5 });
    expect(reporter).toBeInstanceOf(LLMCostReporter);
  });
});
