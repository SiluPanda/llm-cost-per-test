import type { CostReport, BudgetViolation, BaselineDiff } from './types';

// ── Helpers ─────────────────────────────────────────────────────────

function formatDollars(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatPercent(pct: number): string {
  return `${(pct * 100).toFixed(1)}%`;
}

function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

const color = {
  red: (s: string) => shouldUseColor() ? `\x1b[31m${s}\x1b[0m` : s,
  green: (s: string) => shouldUseColor() ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s: string) => shouldUseColor() ? `\x1b[33m${s}\x1b[0m` : s,
  bold: (s: string) => shouldUseColor() ? `\x1b[1m${s}\x1b[0m` : s,
  dim: (s: string) => shouldUseColor() ? `\x1b[2m${s}\x1b[0m` : s,
};

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

// ── Console Table Formatter ─────────────────────────────────────────

export function formatTable(report: CostReport, options?: {
  topN?: number;
  showModelBreakdown?: boolean;
  showFileBreakdown?: boolean;
  showPerTestTable?: boolean;
  minCostToShow?: number;
}): string {
  const lines: string[] = [];
  const topN = options?.topN ?? 10;
  const showModelBreakdown = options?.showModelBreakdown ?? true;
  const showFileBreakdown = options?.showFileBreakdown ?? true;
  const showPerTestTable = options?.showPerTestTable ?? true;
  const minCostToShow = options?.minCostToShow ?? 0;

  lines.push('');
  lines.push(color.bold('LLM Cost Report'));
  lines.push('='.repeat(75));

  // Per-test table
  if (showPerTestTable && report.tests.length > 0) {
    lines.push('');
    lines.push(`  ${padRight('Test', 44)} ${padRight('Model', 14)} ${padLeft('In Tok', 8)} ${padLeft('Out Tok', 8)} ${padLeft('Cost', 9)}`);
    lines.push('  ' + '-'.repeat(83));

    const visibleTests = report.tests.filter(t => t.cost >= minCostToShow);
    const hiddenTests = report.tests.filter(t => t.cost < minCostToShow && minCostToShow > 0);

    for (const test of visibleTests) {
      // Determine primary model
      const modelCounts: Record<string, number> = {};
      for (const record of test.records) {
        modelCounts[record.model] = (modelCounts[record.model] || 0) + 1;
      }
      const primaryModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      const shortModel = primaryModel.length > 13 ? primaryModel.substring(0, 13) : primaryModel;

      lines.push(
        `  ${padRight(test.testName.substring(0, 43), 44)} ${padRight(shortModel, 14)} ${padLeft(formatNumber(test.inputTokens), 8)} ${padLeft(formatNumber(test.outputTokens), 8)} ${padLeft(formatDollars(test.cost), 9)}`
      );
    }

    if (hiddenTests.length > 0) {
      const otherCost = hiddenTests.reduce((sum, t) => sum + t.cost, 0);
      const otherInput = hiddenTests.reduce((sum, t) => sum + t.inputTokens, 0);
      const otherOutput = hiddenTests.reduce((sum, t) => sum + t.outputTokens, 0);
      lines.push(
        `  ${padRight(`(${hiddenTests.length} other tests)`, 44)} ${padRight('', 14)} ${padLeft(formatNumber(otherInput), 8)} ${padLeft(formatNumber(otherOutput), 8)} ${padLeft(formatDollars(otherCost), 9)}`
      );
    }

    lines.push('');
    lines.push(`  Total: ${report.testsWithCalls} tests | ${formatNumber(report.totalInputTokens)} input tokens | ${formatNumber(report.totalOutputTokens)} output tokens | ${formatNumber(report.totalApiCalls)} API calls`);
    lines.push(`  Total cost: ${formatDollars(report.totalCost)}`);
  }

  // Suite Summary
  lines.push('');
  lines.push(`  ${color.bold('Suite Summary')}`);
  lines.push('  ' + '-'.repeat(37));
  lines.push(`  Total tests with LLM calls:    ${report.testsWithCalls} / ${report.totalTests}`);
  lines.push(`  Total API calls:               ${formatNumber(report.totalApiCalls)}`);
  lines.push(`  Total input tokens:            ${formatNumber(report.totalInputTokens)}`);
  lines.push(`  Total output tokens:           ${formatNumber(report.totalOutputTokens)}`);
  lines.push(`  Total cost:                    ${formatDollars(report.totalCost)}`);

  if (report.tests.length > 0) {
    const mostExpensive = [...report.tests].sort((a, b) => b.cost - a.cost)[0];
    lines.push(`  Most expensive test:           ${mostExpensive.testName} (${formatDollars(mostExpensive.cost)})`);

    if (report.files.length > 0) {
      const mostExpensiveFile = [...report.files].sort((a, b) => b.cost - a.cost)[0];
      lines.push(`  Most expensive file:           ${mostExpensiveFile.filePath} (${formatDollars(mostExpensiveFile.cost)})`);
    }
  }

  // Top-N Most Expensive Tests
  if (report.tests.length > 0 && topN > 0) {
    const sorted = [...report.tests].sort((a, b) => b.cost - a.cost).slice(0, topN);
    lines.push('');
    lines.push(`  ${color.bold(`Top ${Math.min(topN, sorted.length)} Most Expensive Tests`)}`);
    lines.push('  ' + '-'.repeat(37));

    for (let i = 0; i < sorted.length; i++) {
      const test = sorted[i];
      const pct = report.totalCost > 0 ? formatPercent(test.cost / report.totalCost) : '0.0%';
      lines.push(`  ${i + 1}. ${padRight(test.testName.substring(0, 40), 41)} ${padLeft(formatDollars(test.cost), 9)}  (${padLeft(pct, 5)})`);
    }
  }

  // Cost by Model
  if (showModelBreakdown && report.models.length > 0) {
    lines.push('');
    lines.push(`  ${color.bold('Cost by Model')}`);
    lines.push('  ' + '-'.repeat(37));

    for (const model of report.models) {
      const pct = formatPercent(model.percentage);
      lines.push(`  ${padRight(model.model.substring(0, 16), 17)} ${padLeft(formatDollars(model.cost), 9)}  (${padLeft(pct, 5)})  ${formatNumber(model.apiCalls)} calls`);
    }
  }

  // Cost by File
  if (showFileBreakdown && report.files.length > 0) {
    lines.push('');
    lines.push(`  ${color.bold('Cost by File')}`);
    lines.push('  ' + '-'.repeat(37));

    for (const file of report.files) {
      const testLabel = file.testCount === 1 ? '1 test' : `${file.testCount} tests`;
      lines.push(`  ${padRight(file.filePath.substring(0, 30), 31)} ${padLeft(formatDollars(file.cost), 9)}   ${testLabel}`);
    }
  }

  // Budget Violations
  if (report.budgetViolations.length > 0) {
    lines.push('');
    for (const v of report.budgetViolations) {
      lines.push(color.red(formatBudgetViolation(v)));
    }
  }

  // Baseline Diff
  if (report.baselineDiff) {
    lines.push('');
    lines.push(formatBaselineDiffTable(report.baselineDiff));
  }

  lines.push('');
  return lines.join('\n');
}

function formatBudgetViolation(v: BudgetViolation): string {
  const levelLabel =
    v.level === 'perTest' ? 'Test' :
    v.level === 'perFile' ? 'File' :
    'Suite';
  return `BUDGET VIOLATION: ${levelLabel} "${v.name}" cost ${formatDollars(v.actualCost)}, exceeding ${v.level} budget of ${formatDollars(v.budgetCost)}.`;
}

function formatBaselineDiffTable(diff: BaselineDiff): string {
  const lines: string[] = [];

  lines.push(`  ${color.bold(`Cost Diff vs. Baseline (${diff.baselinePath})`)}`);
  lines.push('  ' + '='.repeat(65));
  lines.push('');
  lines.push(`  ${padRight('Test', 40)} ${padLeft('Baseline', 10)} ${padLeft('Current', 10)} ${padLeft('Diff', 20)}`);
  lines.push('  ' + '-'.repeat(80));

  for (const t of diff.tests) {
    let diffStr: string;
    if (Math.abs(t.costChange) < 0.00005) {
      diffStr = '--';
    } else {
      const sign = t.costChange > 0 ? '+' : '';
      const pct = formatPercent(t.percentageChange);
      diffStr = `${sign}${formatDollars(t.costChange)} (${sign}${pct})`;
      if (t.percentageChange > 0.10) {
        diffStr += '  !!';
      }
    }
    lines.push(`  ${padRight(t.testName.substring(0, 39), 40)} ${padLeft(formatDollars(t.baselineCost), 10)} ${padLeft(formatDollars(t.currentCost), 10)} ${padLeft(diffStr, 20)}`);
  }

  for (const test of diff.newTests) {
    lines.push(`  ${padRight('[NEW] ' + test.testName.substring(0, 33), 40)} ${padLeft('--', 10)} ${padLeft(formatDollars(test.cost), 10)} ${padLeft('+' + formatDollars(test.cost) + ' (new)', 20)}`);
  }

  for (const name of diff.removedTests) {
    lines.push(`  ${padRight('[REMOVED] ' + name.substring(0, 29), 40)} ${padLeft('--', 10)} ${padLeft('--', 10)} ${padLeft('(removed)', 20)}`);
  }

  lines.push('');
  const totalSign = diff.costChange > 0 ? '+' : '';
  const totalPct = formatPercent(diff.percentageChange);
  lines.push(`  Total: ${formatDollars(diff.baselineTotalCost)} -> ${formatDollars(diff.currentTotalCost)}  (${totalSign}${formatDollars(diff.costChange)}, ${totalSign}${totalPct})`);

  return lines.join('\n');
}

// ── JSON Formatter ──────────────────────────────────────────────────

export function formatJSON(report: CostReport): string {
  return JSON.stringify(report, null, 2);
}

// ── Markdown Formatter ──────────────────────────────────────────────

export function formatMarkdown(report: CostReport): string {
  const lines: string[] = [];

  lines.push('## LLM Cost Report');
  lines.push('');

  if (report.tests.length > 0) {
    lines.push('| Test | Model | Tokens (in/out) | Cost |');
    lines.push('|------|-------|-----------------|------|');

    for (const test of report.tests) {
      const modelCounts: Record<string, number> = {};
      for (const record of test.records) {
        modelCounts[record.model] = (modelCounts[record.model] || 0) + 1;
      }
      const primaryModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

      lines.push(`| ${test.testName} | ${primaryModel} | ${formatNumber(test.inputTokens)} / ${formatNumber(test.outputTokens)} | ${formatDollars(test.cost)} |`);
    }

    lines.push('');
  }

  lines.push(`**Total: ${formatDollars(report.totalCost)}** (${report.testsWithCalls} tests, ${formatNumber(report.totalApiCalls)} API calls)`);

  if (report.baselineDiff) {
    lines.push('');
    lines.push('### Cost Diff vs. Baseline');
    lines.push('| Test | Baseline | Current | Change |');
    lines.push('|------|----------|---------|--------|');

    for (const t of report.baselineDiff.tests) {
      if (Math.abs(t.costChange) < 0.00005) continue;
      const sign = t.costChange > 0 ? '+' : '';
      const pct = formatPercent(t.percentageChange);
      lines.push(`| ${t.testName} | ${formatDollars(t.baselineCost)} | ${formatDollars(t.currentCost)} | ${sign}${pct} |`);
    }

    for (const test of report.baselineDiff.newTests) {
      lines.push(`| ${test.testName} | -- | ${formatDollars(test.cost)} | new |`);
    }

    for (const name of report.baselineDiff.removedTests) {
      lines.push(`| ${name} | -- | -- | removed |`);
    }

    const totalSign = report.baselineDiff.costChange > 0 ? '+' : '';
    const totalPct = formatPercent(report.baselineDiff.percentageChange);
    lines.push(`| **Total** | **${formatDollars(report.baselineDiff.baselineTotalCost)}** | **${formatDollars(report.baselineDiff.currentTotalCost)}** | **${totalSign}${totalPct}** |`);
  }

  if (report.budgetViolations.length > 0) {
    lines.push('');
    lines.push('### Budget Violations');
    for (const v of report.budgetViolations) {
      lines.push(`- ${formatBudgetViolation(v)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── JUnit XML Formatter ─────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function formatJUnit(report: CostReport): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<testsuites tests="${report.totalTests}" name="LLM Cost Report">`);
  lines.push(`  <testsuite name="llm-costs" tests="${report.tests.length}">`);

  for (const test of report.tests) {
    const classname = escapeXml(test.filePath.replace(/\//g, '.').replace(/\.ts$|\.js$/, ''));
    const testName = escapeXml(test.testName);

    // Determine primary model
    const modelCounts: Record<string, number> = {};
    for (const record of test.records) {
      modelCounts[record.model] = (modelCounts[record.model] || 0) + 1;
    }
    const primaryModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

    lines.push(`    <testcase name="${testName}" classname="${classname}">`);
    lines.push('      <properties>');
    lines.push(`        <property name="llm.cost" value="${test.cost.toFixed(4)}" />`);
    lines.push(`        <property name="llm.inputTokens" value="${test.inputTokens}" />`);
    lines.push(`        <property name="llm.outputTokens" value="${test.outputTokens}" />`);
    lines.push(`        <property name="llm.apiCalls" value="${test.apiCalls}" />`);
    lines.push(`        <property name="llm.model" value="${escapeXml(primaryModel)}" />`);
    lines.push('      </properties>');
    lines.push('    </testcase>');
  }

  lines.push('  </testsuite>');
  lines.push('</testsuites>');

  return lines.join('\n');
}
