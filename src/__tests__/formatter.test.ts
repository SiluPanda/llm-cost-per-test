import { describe, it, expect } from 'vitest';
import { formatTable, formatJSON, formatMarkdown, formatJUnit } from '../formatter';
import type { CostReport, TestCostEntry } from '../types';

function makeTestEntry(name: string, cost: number, model = 'gpt-4o', inputTokens = 100, outputTokens = 50, file = 'test.ts'): TestCostEntry {
  return {
    testName: name,
    filePath: file,
    cost,
    inputTokens,
    outputTokens,
    apiCalls: 1,
    records: [{
      model,
      inputTokens,
      outputTokens,
      cost,
      timestamp: '2026-01-01T00:00:00.000Z',
    }],
  };
}

function makeReport(overrides?: Partial<CostReport>): CostReport {
  const tests = overrides?.tests ?? [
    makeTestEntry('classifies positive feedback', 0.0008, 'gpt-4o', 150, 42, 'tests/classify.test.ts'),
    makeTestEntry('generates product description', 0.0041, 'gpt-4o', 520, 280, 'tests/generate.test.ts'),
    makeTestEntry('summarizes long document', 0.0098, 'gpt-4o', 2100, 450, 'tests/summarize.test.ts'),
  ];

  const totalCost = tests.reduce((s, t) => s + t.cost, 0);
  const totalInputTokens = tests.reduce((s, t) => s + t.inputTokens, 0);
  const totalOutputTokens = tests.reduce((s, t) => s + t.outputTokens, 0);

  return {
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    totalApiCalls: tests.length,
    testsWithCalls: tests.length,
    totalTests: tests.length + 5,
    tests,
    files: [
      { filePath: 'tests/classify.test.ts', cost: 0.0008, testCount: 1, apiCalls: 1 },
      { filePath: 'tests/generate.test.ts', cost: 0.0041, testCount: 1, apiCalls: 1 },
      { filePath: 'tests/summarize.test.ts', cost: 0.0098, testCount: 1, apiCalls: 1 },
    ],
    models: [
      { model: 'gpt-4o', cost: totalCost, percentage: 1.0, apiCalls: 3, inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    ],
    budgetViolations: [],
    ...overrides,
  };
}

describe('formatTable', () => {
  it('produces output containing the report header', () => {
    const output = formatTable(makeReport());
    expect(output).toContain('LLM Cost Report');
  });

  it('includes per-test entries', () => {
    const output = formatTable(makeReport());
    expect(output).toContain('classifies positive feedback');
    expect(output).toContain('generates product description');
    expect(output).toContain('summarizes long document');
  });

  it('includes suite summary section', () => {
    const output = formatTable(makeReport());
    expect(output).toContain('Suite Summary');
    expect(output).toContain('Total tests with LLM calls');
    expect(output).toContain('Total API calls');
    expect(output).toContain('Total cost');
  });

  it('includes most expensive test', () => {
    const output = formatTable(makeReport());
    expect(output).toContain('Most expensive test');
    expect(output).toContain('summarizes long document');
  });

  it('includes top-N section', () => {
    const output = formatTable(makeReport(), { topN: 2 });
    expect(output).toContain('Top 2 Most Expensive Tests');
    expect(output).toContain('summarizes long document');
  });

  it('includes cost by model section', () => {
    const output = formatTable(makeReport(), { showModelBreakdown: true });
    expect(output).toContain('Cost by Model');
    expect(output).toContain('gpt-4o');
  });

  it('includes cost by file section', () => {
    const output = formatTable(makeReport(), { showFileBreakdown: true });
    expect(output).toContain('Cost by File');
    expect(output).toContain('tests/classify.test.ts');
  });

  it('hides model breakdown when disabled', () => {
    const output = formatTable(makeReport(), { showModelBreakdown: false });
    expect(output).not.toContain('Cost by Model');
  });

  it('hides file breakdown when disabled', () => {
    const output = formatTable(makeReport(), { showFileBreakdown: false });
    expect(output).not.toContain('Cost by File');
  });

  it('hides per-test table when disabled', () => {
    const output = formatTable(makeReport(), { showPerTestTable: false });
    // Should still have suite summary but not the test table header
    expect(output).toContain('Suite Summary');
  });

  it('filters tests below minCostToShow', () => {
    const output = formatTable(makeReport(), { minCostToShow: 0.005 });
    // Only summarizes long document should appear (0.0098 > 0.005)
    expect(output).toContain('summarizes long document');
    expect(output).toContain('other tests');
  });

  it('handles empty report', () => {
    const report = makeReport({ tests: [], files: [], models: [] });
    const output = formatTable(report);
    expect(output).toContain('LLM Cost Report');
    expect(output).toContain('Suite Summary');
  });

  it('includes budget violations', () => {
    const report = makeReport({
      budgetViolations: [{
        level: 'perTest',
        name: 'expensive test',
        actualCost: 0.60,
        budgetCost: 0.50,
      }],
    });
    const output = formatTable(report);
    expect(output).toContain('BUDGET VIOLATION');
    expect(output).toContain('expensive test');
  });

  it('includes baseline diff when available', () => {
    const report = makeReport({
      baselineDiff: {
        baselinePath: 'baseline.json',
        baselineTotalCost: 0.01,
        currentTotalCost: 0.015,
        costChange: 0.005,
        percentageChange: 0.50,
        tests: [{
          testName: 'test A',
          baselineCost: 0.01,
          currentCost: 0.015,
          costChange: 0.005,
          percentageChange: 0.50,
        }],
        newTests: [],
        removedTests: [],
      },
    });
    const output = formatTable(report);
    expect(output).toContain('Cost Diff vs. Baseline');
    expect(output).toContain('baseline.json');
  });
});

describe('formatJSON', () => {
  it('produces valid JSON', () => {
    const output = formatJSON(makeReport());
    const parsed = JSON.parse(output);
    expect(parsed).toBeDefined();
  });

  it('includes version field', () => {
    const parsed = JSON.parse(formatJSON(makeReport()));
    expect(parsed.version).toBe(1);
  });

  it('includes createdAt field', () => {
    const parsed = JSON.parse(formatJSON(makeReport()));
    expect(parsed.createdAt).toBeDefined();
  });

  it('includes all cost totals', () => {
    const parsed = JSON.parse(formatJSON(makeReport()));
    expect(typeof parsed.totalCost).toBe('number');
    expect(typeof parsed.totalInputTokens).toBe('number');
    expect(typeof parsed.totalOutputTokens).toBe('number');
    expect(typeof parsed.totalApiCalls).toBe('number');
  });

  it('includes test entries with records', () => {
    const parsed = JSON.parse(formatJSON(makeReport()));
    expect(parsed.tests).toHaveLength(3);
    expect(parsed.tests[0].records).toHaveLength(1);
    expect(parsed.tests[0].testName).toBeDefined();
    expect(parsed.tests[0].filePath).toBeDefined();
  });

  it('includes files array', () => {
    const parsed = JSON.parse(formatJSON(makeReport()));
    expect(Array.isArray(parsed.files)).toBe(true);
  });

  it('includes models array', () => {
    const parsed = JSON.parse(formatJSON(makeReport()));
    expect(Array.isArray(parsed.models)).toBe(true);
  });

  it('includes budgetViolations array', () => {
    const parsed = JSON.parse(formatJSON(makeReport()));
    expect(Array.isArray(parsed.budgetViolations)).toBe(true);
  });

  it('includes baselineDiff when present', () => {
    const report = makeReport({
      baselineDiff: {
        baselinePath: 'b.json',
        baselineTotalCost: 1.0,
        currentTotalCost: 1.5,
        costChange: 0.5,
        percentageChange: 0.5,
        tests: [],
        newTests: [],
        removedTests: [],
      },
    });
    const parsed = JSON.parse(formatJSON(report));
    expect(parsed.baselineDiff).toBeDefined();
    expect(parsed.baselineDiff.baselinePath).toBe('b.json');
  });
});

describe('formatMarkdown', () => {
  it('starts with ## LLM Cost Report heading', () => {
    const output = formatMarkdown(makeReport());
    expect(output).toContain('## LLM Cost Report');
  });

  it('contains markdown table with Test column', () => {
    const output = formatMarkdown(makeReport());
    expect(output).toContain('| Test | Model | Tokens (in/out) | Cost |');
    expect(output).toContain('|------|-------|-----------------|------|');
  });

  it('includes test entries in table', () => {
    const output = formatMarkdown(makeReport());
    expect(output).toContain('classifies positive feedback');
    expect(output).toContain('generates product description');
  });

  it('includes total summary line', () => {
    const output = formatMarkdown(makeReport());
    expect(output).toContain('**Total:');
    expect(output).toContain('3 tests');
    expect(output).toContain('API calls');
  });

  it('includes baseline diff section when available', () => {
    const report = makeReport({
      baselineDiff: {
        baselinePath: 'b.json',
        baselineTotalCost: 0.01,
        currentTotalCost: 0.015,
        costChange: 0.005,
        percentageChange: 0.50,
        tests: [{
          testName: 'test A',
          baselineCost: 0.01,
          currentCost: 0.015,
          costChange: 0.005,
          percentageChange: 0.50,
        }],
        newTests: [],
        removedTests: [],
      },
    });
    const output = formatMarkdown(report);
    expect(output).toContain('### Cost Diff vs. Baseline');
    expect(output).toContain('test A');
  });

  it('includes budget violations section when present', () => {
    const report = makeReport({
      budgetViolations: [{
        level: 'perTest',
        name: 'expensive',
        actualCost: 1.0,
        budgetCost: 0.5,
      }],
    });
    const output = formatMarkdown(report);
    expect(output).toContain('### Budget Violations');
    expect(output).toContain('BUDGET VIOLATION');
  });

  it('handles empty report', () => {
    const report = makeReport({ tests: [], files: [], models: [] });
    const output = formatMarkdown(report);
    expect(output).toContain('## LLM Cost Report');
    expect(output).toContain('**Total:');
  });
});

describe('formatJUnit', () => {
  it('produces valid XML header', () => {
    const output = formatJUnit(makeReport());
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  });

  it('contains testsuites element', () => {
    const output = formatJUnit(makeReport());
    expect(output).toContain('<testsuites');
    expect(output).toContain('</testsuites>');
  });

  it('contains testsuite element', () => {
    const output = formatJUnit(makeReport());
    expect(output).toContain('<testsuite name="llm-costs"');
    expect(output).toContain('</testsuite>');
  });

  it('contains testcase elements for each test', () => {
    const output = formatJUnit(makeReport());
    expect(output).toContain('name="classifies positive feedback"');
    expect(output).toContain('name="generates product description"');
    expect(output).toContain('name="summarizes long document"');
  });

  it('includes llm.cost property', () => {
    const output = formatJUnit(makeReport());
    expect(output).toContain('name="llm.cost"');
  });

  it('includes llm.inputTokens property', () => {
    const output = formatJUnit(makeReport());
    expect(output).toContain('name="llm.inputTokens"');
  });

  it('includes llm.outputTokens property', () => {
    const output = formatJUnit(makeReport());
    expect(output).toContain('name="llm.outputTokens"');
  });

  it('includes llm.apiCalls property', () => {
    const output = formatJUnit(makeReport());
    expect(output).toContain('name="llm.apiCalls"');
  });

  it('includes llm.model property', () => {
    const output = formatJUnit(makeReport());
    expect(output).toContain('name="llm.model"');
    expect(output).toContain('value="gpt-4o"');
  });

  it('escapes XML special characters in test names', () => {
    const tests = [makeTestEntry('test with <special> & "chars"', 0.01)];
    const report = makeReport({ tests });
    const output = formatJUnit(report);
    expect(output).toContain('&lt;special&gt;');
    expect(output).toContain('&amp;');
    expect(output).toContain('&quot;chars&quot;');
  });

  it('converts file path to classname format', () => {
    const output = formatJUnit(makeReport());
    expect(output).toContain('classname="tests.classify.test"');
  });

  it('handles empty report', () => {
    const report = makeReport({ tests: [] });
    const output = formatJUnit(report);
    expect(output).toContain('<testsuite name="llm-costs" tests="0"');
  });
});
