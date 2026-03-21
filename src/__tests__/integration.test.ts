import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createReporter, createCostTracker, calculateCost, resetPricing } from '../index';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llm-integration-'));
}

describe('integration', () => {
  beforeEach(() => {
    resetPricing();
  });

  describe('full reporter lifecycle', () => {
    it('tracks multiple tests with different models and produces correct report', () => {
      const reporter = createReporter();

      // Simulate test execution
      reporter.startTest('classify positive', 'tests/classify.test.ts');
      reporter.recordApiCall('classify positive', 'gpt-4o', 150, 42);
      reporter.endTest('classify positive');

      reporter.startTest('classify negative', 'tests/classify.test.ts');
      reporter.recordApiCall('classify negative', 'gpt-4o', 162, 38);
      reporter.endTest('classify negative');

      reporter.startTest('generate description', 'tests/generate.test.ts');
      reporter.recordApiCall('generate description', 'gpt-4o', 520, 280);
      reporter.endTest('generate description');

      reporter.startTest('eval translation', 'eval/translation.test.ts');
      reporter.recordApiCall('eval translation', 'gpt-4o-mini', 400, 200);
      reporter.endTest('eval translation');

      const report = reporter.generateReport();

      // Verify totals
      expect(report.tests).toHaveLength(4);
      expect(report.totalTests).toBe(4);
      expect(report.testsWithCalls).toBe(4);
      expect(report.totalApiCalls).toBe(4);
      expect(report.totalInputTokens).toBe(150 + 162 + 520 + 400);
      expect(report.totalOutputTokens).toBe(42 + 38 + 280 + 200);

      // Verify per-file aggregation
      const classifyFile = report.files.find(f => f.filePath === 'tests/classify.test.ts');
      expect(classifyFile).toBeDefined();
      expect(classifyFile!.testCount).toBe(2);

      const generateFile = report.files.find(f => f.filePath === 'tests/generate.test.ts');
      expect(generateFile).toBeDefined();
      expect(generateFile!.testCount).toBe(1);

      // Verify per-model aggregation
      const gpt4oModel = report.models.find(m => m.model === 'gpt-4o');
      expect(gpt4oModel).toBeDefined();
      expect(gpt4oModel!.apiCalls).toBe(3);

      const miniModel = report.models.find(m => m.model === 'gpt-4o-mini');
      expect(miniModel).toBeDefined();
      expect(miniModel!.apiCalls).toBe(1);

      // Verify model percentages sum to 100%
      const totalPct = report.models.reduce((sum, m) => sum + m.percentage, 0);
      expect(totalPct).toBeCloseTo(1.0, 4);
    });

    it('handles multi-turn conversation with multiple API calls per test', () => {
      const reporter = createReporter();
      reporter.startTest('multi-turn', 'tests/conversation.test.ts');

      // Simulate 4 turns of conversation
      reporter.recordApiCall('multi-turn', 'gpt-4o', 200, 100);
      reporter.recordApiCall('multi-turn', 'gpt-4o', 400, 150);
      reporter.recordApiCall('multi-turn', 'gpt-4o', 600, 200);
      reporter.recordApiCall('multi-turn', 'gpt-4o', 800, 250);

      reporter.endTest('multi-turn');
      const report = reporter.generateReport();

      expect(report.tests[0].apiCalls).toBe(4);
      expect(report.tests[0].records).toHaveLength(4);
      expect(report.tests[0].inputTokens).toBe(2000);
      expect(report.tests[0].outputTokens).toBe(700);
    });

    it('handles test with no LLM calls', () => {
      const reporter = createReporter();
      reporter.startTest('unit test', 'tests/unit.test.ts');
      reporter.endTest('unit test');
      reporter.startTest('llm test', 'tests/llm.test.ts');
      reporter.recordApiCall('llm test', 'gpt-4o', 100, 50);
      reporter.endTest('llm test');

      const report = reporter.generateReport();
      expect(report.totalTests).toBe(2);
      expect(report.testsWithCalls).toBe(1);
      const unitTest = report.tests.find(t => t.testName === 'unit test');
      expect(unitTest!.cost).toBe(0);
    });
  });

  describe('budget enforcement end-to-end', () => {
    it('detects per-test budget violation and includes it in report', () => {
      const reporter = createReporter({ budget: { perTest: 0.001 } });
      reporter.startTest('expensive test', 'test.ts');
      reporter.recordApiCall('expensive test', 'gpt-4o', 500, 150); // $0.00275
      reporter.endTest('expensive test');

      const report = reporter.generateReport();
      expect(report.budgetViolations).toHaveLength(1);
      expect(report.budgetViolations[0].level).toBe('perTest');
      expect(report.budgetViolations[0].name).toBe('expensive test');
      expect(report.budgetViolations[0].actualCost).toBeCloseTo(0.00275, 6);
    });

    it('detects per-file budget violation across multiple tests', () => {
      const reporter = createReporter({ budget: { perFile: 0.003 } });
      reporter.startTest('test A', 'expensive.ts');
      reporter.recordApiCall('test A', 'gpt-4o', 500, 150); // $0.00275
      reporter.startTest('test B', 'expensive.ts');
      reporter.recordApiCall('test B', 'gpt-4o', 500, 150); // $0.00275
      reporter.endTest('test A');
      reporter.endTest('test B');

      const report = reporter.generateReport();
      const fileViolation = report.budgetViolations.find(v => v.level === 'perFile');
      expect(fileViolation).toBeDefined();
      expect(fileViolation!.name).toBe('expensive.ts');
    });

    it('detects per-suite budget violation', () => {
      const reporter = createReporter({ budget: { perSuite: 0.001 } });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 500, 150);
      reporter.startTest('test2', 'b.ts');
      reporter.recordApiCall('test2', 'gpt-4o', 500, 150);
      reporter.endTest('test1');
      reporter.endTest('test2');

      const report = reporter.generateReport();
      const suiteViolation = report.budgetViolations.find(v => v.level === 'perSuite');
      expect(suiteViolation).toBeDefined();
    });

    it('reports multiple violations simultaneously', () => {
      const reporter = createReporter({
        budget: { perTest: 0.001, perSuite: 0.002 },
      });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 500, 150); // $0.00275 > $0.001
      reporter.startTest('test2', 'b.ts');
      reporter.recordApiCall('test2', 'gpt-4o', 500, 150); // $0.00275 > $0.001
      reporter.endTest('test1');
      reporter.endTest('test2');

      const report = reporter.generateReport();
      // 2 per-test + 1 per-suite = 3
      expect(report.budgetViolations.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('baseline round-trip', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = makeTempDir();
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('saves baseline, then detects regression on next run', () => {
      const baselinePath = path.join(tempDir, 'baseline.json');

      // Run 1: Save baseline
      const reporter1 = createReporter({
        baseline: { path: baselinePath, update: true },
      });
      reporter1.startTest('test1', 'a.ts');
      reporter1.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter1.endTest('test1');
      reporter1.generateReport();
      expect(fs.existsSync(baselinePath)).toBe(true);

      // Run 2: Compare against baseline with increased cost
      const reporter2 = createReporter({
        baseline: { path: baselinePath, update: false },
      });
      reporter2.startTest('test1', 'a.ts');
      reporter2.recordApiCall('test1', 'gpt-4o', 500, 250); // much more expensive
      reporter2.endTest('test1');
      const report2 = reporter2.generateReport();

      expect(report2.baselineDiff).toBeDefined();
      expect(report2.baselineDiff!.costChange).toBeGreaterThan(0);
      expect(report2.baselineDiff!.tests).toHaveLength(1);
      expect(report2.baselineDiff!.tests[0].costChange).toBeGreaterThan(0);
    });

    it('detects new tests in baseline diff', () => {
      const baselinePath = path.join(tempDir, 'baseline.json');

      // Run 1: Save baseline with 1 test
      const reporter1 = createReporter({
        baseline: { path: baselinePath, update: true },
      });
      reporter1.startTest('test1', 'a.ts');
      reporter1.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter1.endTest('test1');
      reporter1.generateReport();

      // Run 2: Add a new test
      const reporter2 = createReporter({
        baseline: { path: baselinePath, update: false },
      });
      reporter2.startTest('test1', 'a.ts');
      reporter2.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter2.startTest('test2 NEW', 'b.ts');
      reporter2.recordApiCall('test2 NEW', 'gpt-4o', 200, 100);
      reporter2.endTest('test1');
      reporter2.endTest('test2 NEW');
      const report2 = reporter2.generateReport();

      expect(report2.baselineDiff!.newTests).toHaveLength(1);
      expect(report2.baselineDiff!.newTests[0].testName).toBe('test2 NEW');
    });

    it('detects removed tests in baseline diff', () => {
      const baselinePath = path.join(tempDir, 'baseline.json');

      // Run 1: Save baseline with 2 tests
      const reporter1 = createReporter({
        baseline: { path: baselinePath, update: true },
      });
      reporter1.startTest('test1', 'a.ts');
      reporter1.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter1.startTest('test2', 'b.ts');
      reporter1.recordApiCall('test2', 'gpt-4o', 200, 100);
      reporter1.endTest('test1');
      reporter1.endTest('test2');
      reporter1.generateReport();

      // Run 2: Only 1 test
      const reporter2 = createReporter({
        baseline: { path: baselinePath, update: false },
      });
      reporter2.startTest('test1', 'a.ts');
      reporter2.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter2.endTest('test1');
      const report2 = reporter2.generateReport();

      expect(report2.baselineDiff!.removedTests).toContain('test2');
    });
  });

  describe('output format end-to-end', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = makeTempDir();
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('produces valid JSON file', () => {
      const outPath = path.join(tempDir, 'report.json');
      const reporter = createReporter({ output: 'json', outputFile: outPath });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      reporter.finalize();

      const content = fs.readFileSync(outPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe(1);
      expect(parsed.tests).toHaveLength(1);
      expect(parsed.tests[0].testName).toBe('test1');
    });

    it('produces valid Markdown file', () => {
      const outPath = path.join(tempDir, 'report.md');
      const reporter = createReporter({ output: 'markdown', outputFile: outPath });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      reporter.finalize();

      const content = fs.readFileSync(outPath, 'utf-8');
      expect(content).toContain('## LLM Cost Report');
      expect(content).toContain('test1');
    });

    it('produces valid JUnit XML file', () => {
      const outPath = path.join(tempDir, 'report.xml');
      const reporter = createReporter({ output: 'junit', outputFile: outPath });
      reporter.startTest('test1', 'a.ts');
      reporter.recordApiCall('test1', 'gpt-4o', 100, 50);
      reporter.endTest('test1');
      reporter.finalize();

      const content = fs.readFileSync(outPath, 'utf-8');
      expect(content).toContain('<?xml');
      expect(content).toContain('name="test1"');
      expect(content).toContain('name="llm.cost"');
    });
  });

  describe('CostTracker standalone', () => {
    it('works independently of reporter', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 500, outputTokens: 150 });
      tracker.record({ model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 });
      const summary = tracker.getCost();

      expect(summary.totalApiCalls).toBe(2);
      expect(summary.totalInputTokens).toBe(1500);
      expect(summary.totalOutputTokens).toBe(650);
      expect(summary.totalCost).toBeGreaterThan(0);
      expect(Object.keys(summary.byModel)).toHaveLength(2);
    });

    it('supports manual cost override', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'custom', inputTokens: 100, outputTokens: 50, cost: 0.05 });
      expect(tracker.getCost().totalCost).toBe(0.05);
    });

    it('supports reset and reuse', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
      expect(tracker.getCost().totalApiCalls).toBe(1);
      tracker.reset();
      expect(tracker.getCost().totalApiCalls).toBe(0);
      tracker.record({ model: 'gpt-4o', inputTokens: 200, outputTokens: 100 });
      expect(tracker.getCost().totalApiCalls).toBe(1);
    });
  });

  describe('calculateCost standalone', () => {
    it('computes costs correctly', () => {
      // GPT-4o: $2.50/MTok input, $10.00/MTok output
      const cost = calculateCost('gpt-4o', 500, 150);
      expect(cost).toBeCloseTo(0.00275, 8);
    });

    it('handles zero tokens', () => {
      expect(calculateCost('gpt-4o', 0, 0)).toBe(0);
    });
  });

  describe('empty test run', () => {
    it('produces a valid report with zero everything', () => {
      const reporter = createReporter();
      const report = reporter.generateReport();

      expect(report.version).toBe(1);
      expect(report.totalCost).toBe(0);
      expect(report.totalInputTokens).toBe(0);
      expect(report.totalOutputTokens).toBe(0);
      expect(report.totalApiCalls).toBe(0);
      expect(report.testsWithCalls).toBe(0);
      expect(report.tests).toHaveLength(0);
      expect(report.files).toHaveLength(0);
      expect(report.models).toHaveLength(0);
      expect(report.budgetViolations).toHaveLength(0);
    });
  });

  describe('large-scale test run', () => {
    it('handles 100+ tests efficiently', () => {
      const reporter = createReporter();
      const startTime = Date.now();

      for (let i = 0; i < 200; i++) {
        reporter.startTest(`test-${i}`, `file-${i % 10}.ts`);
        reporter.recordApiCall(`test-${i}`, 'gpt-4o', 100 + i, 50 + i);
        reporter.endTest(`test-${i}`);
      }

      const report = reporter.generateReport();
      const elapsed = Date.now() - startTime;

      expect(report.tests).toHaveLength(200);
      expect(report.files).toHaveLength(10);
      expect(report.totalApiCalls).toBe(200);
      expect(elapsed).toBeLessThan(5000); // Should complete in under 5s
    });
  });
});
