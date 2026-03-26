import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCostTracker } from '../tracker';
import { resetPricing } from '../pricing';

describe('CostTracker', () => {
  beforeEach(() => {
    resetPricing();
  });

  describe('record', () => {
    it('records a single entry', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
      const entries = tracker.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].model).toBe('gpt-4o');
      expect(entries[0].inputTokens).toBe(100);
      expect(entries[0].outputTokens).toBe(50);
    });

    it('records multiple entries', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
      tracker.record({ model: 'gpt-4o-mini', inputTokens: 200, outputTokens: 100 });
      tracker.record({ model: 'gpt-4o', inputTokens: 300, outputTokens: 150 });
      expect(tracker.getEntries()).toHaveLength(3);
    });

    it('computes cost from pricing table', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 500, outputTokens: 150 });
      const entries = tracker.getEntries();
      // (500/1M * 2.50) + (150/1M * 10.00) = 0.00125 + 0.0015 = 0.00275
      expect(entries[0].cost).toBeCloseTo(0.00275, 8);
    });

    it('uses manual cost override when provided', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'custom-model', inputTokens: 100, outputTokens: 50, cost: 0.05 });
      const entries = tracker.getEntries();
      expect(entries[0].cost).toBe(0.05);
    });

    it('adds ISO 8601 timestamp to each record', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
      const entries = tracker.getEntries();
      expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('records zero-token entries with zero cost', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 0, outputTokens: 0 });
      const entries = tracker.getEntries();
      expect(entries[0].cost).toBe(0);
    });

    it('handles unknown model with zero cost', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const tracker = createCostTracker();
      tracker.record({ model: 'unknown-model', inputTokens: 100, outputTokens: 50 });
      expect(tracker.getEntries()[0].cost).toBe(0);
    });
  });

  describe('getCost', () => {
    it('returns zero summary for empty tracker', () => {
      const tracker = createCostTracker();
      const summary = tracker.getCost();
      expect(summary.totalCost).toBe(0);
      expect(summary.totalInputTokens).toBe(0);
      expect(summary.totalOutputTokens).toBe(0);
      expect(summary.totalApiCalls).toBe(0);
      expect(Object.keys(summary.byModel)).toHaveLength(0);
    });

    it('aggregates single entry correctly', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 500, outputTokens: 150 });
      const summary = tracker.getCost();
      expect(summary.totalCost).toBeCloseTo(0.00275, 8);
      expect(summary.totalInputTokens).toBe(500);
      expect(summary.totalOutputTokens).toBe(150);
      expect(summary.totalApiCalls).toBe(1);
    });

    it('aggregates multiple entries correctly', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 500, outputTokens: 150 });
      tracker.record({ model: 'gpt-4o', inputTokens: 300, outputTokens: 100 });
      const summary = tracker.getCost();
      expect(summary.totalInputTokens).toBe(800);
      expect(summary.totalOutputTokens).toBe(250);
      expect(summary.totalApiCalls).toBe(2);
    });

    it('provides correct byModel breakdown', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 500, outputTokens: 150 });
      tracker.record({ model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 });
      tracker.record({ model: 'gpt-4o', inputTokens: 300, outputTokens: 100 });
      const summary = tracker.getCost();

      expect(Object.keys(summary.byModel)).toHaveLength(2);

      expect(summary.byModel['gpt-4o'].calls).toBe(2);
      expect(summary.byModel['gpt-4o'].inputTokens).toBe(800);
      expect(summary.byModel['gpt-4o'].outputTokens).toBe(250);

      expect(summary.byModel['gpt-4o-mini'].calls).toBe(1);
      expect(summary.byModel['gpt-4o-mini'].inputTokens).toBe(1000);
      expect(summary.byModel['gpt-4o-mini'].outputTokens).toBe(500);
    });

    it('sums costs across models', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 500, outputTokens: 150 });
      tracker.record({ model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 });
      const summary = tracker.getCost();

      const gpt4oCost = (500 / 1_000_000) * 2.50 + (150 / 1_000_000) * 10.00;
      const miniCost = (1000 / 1_000_000) * 0.15 + (500 / 1_000_000) * 0.60;
      expect(summary.totalCost).toBeCloseTo(gpt4oCost + miniCost, 8);
    });

    it('handles large token counts', () => {
      const tracker = createCostTracker();
      for (let i = 0; i < 100; i++) {
        tracker.record({ model: 'gpt-4o', inputTokens: 10000, outputTokens: 5000 });
      }
      const summary = tracker.getCost();
      expect(summary.totalApiCalls).toBe(100);
      expect(summary.totalInputTokens).toBe(1_000_000);
      expect(summary.totalOutputTokens).toBe(500_000);
      // (1M/1M * 2.50) + (500K/1M * 10.00) = 2.50 + 5.00 = 7.50
      expect(summary.totalCost).toBeCloseTo(7.50, 4);
    });
  });

  describe('getEntries', () => {
    it('returns entries in recording order', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
      tracker.record({ model: 'gpt-4o-mini', inputTokens: 200, outputTokens: 100 });
      tracker.record({ model: 'gpt-4', inputTokens: 300, outputTokens: 150 });
      const entries = tracker.getEntries();
      expect(entries[0].model).toBe('gpt-4o');
      expect(entries[1].model).toBe('gpt-4o-mini');
      expect(entries[2].model).toBe('gpt-4');
    });

    it('returns a copy (modifications do not affect tracker)', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
      const entries = tracker.getEntries();
      expect(entries).toHaveLength(1);
      // getEntries returns ReadonlyArray, but even if cast, it shouldn't affect the tracker
      const mutableEntries = entries as unknown[];
      mutableEntries.push({ model: 'fake', inputTokens: 0, outputTokens: 0, cost: 0, timestamp: '' });
      expect(tracker.getEntries()).toHaveLength(1);
    });
  });

  describe('reset', () => {
    it('clears all entries', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
      tracker.record({ model: 'gpt-4o-mini', inputTokens: 200, outputTokens: 100 });
      expect(tracker.getEntries()).toHaveLength(2);
      tracker.reset();
      expect(tracker.getEntries()).toHaveLength(0);
    });

    it('resets cost summary to zero', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 500, outputTokens: 150 });
      tracker.reset();
      const summary = tracker.getCost();
      expect(summary.totalCost).toBe(0);
      expect(summary.totalApiCalls).toBe(0);
      expect(summary.totalInputTokens).toBe(0);
      expect(summary.totalOutputTokens).toBe(0);
    });

    it('allows recording after reset', () => {
      const tracker = createCostTracker();
      tracker.record({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });
      tracker.reset();
      tracker.record({ model: 'gpt-4o-mini', inputTokens: 200, outputTokens: 100 });
      expect(tracker.getEntries()).toHaveLength(1);
      expect(tracker.getEntries()[0].model).toBe('gpt-4o-mini');
    });
  });

  describe('createCostTracker with options', () => {
    it('accepts custom pricing via options', () => {
      const tracker = createCostTracker({
        pricing: { 'custom-model': { input: 10, output: 20 } },
      });
      tracker.record({ model: 'custom-model', inputTokens: 1_000_000, outputTokens: 1_000_000 });
      const summary = tracker.getCost();
      expect(summary.totalCost).toBe(30); // 10 + 20
    });

    it('isolates custom pricing per tracker instance', () => {
      const trackerA = createCostTracker({
        pricing: { 'shared-model': { input: 10, output: 20 } },
      });
      const trackerB = createCostTracker({
        pricing: { 'shared-model': { input: 100, output: 200 } },
      });

      trackerA.record({ model: 'shared-model', inputTokens: 1_000_000, outputTokens: 1_000_000 });
      trackerB.record({ model: 'shared-model', inputTokens: 1_000_000, outputTokens: 1_000_000 });

      const summaryA = trackerA.getCost();
      const summaryB = trackerB.getCost();

      // Tracker A should use its own pricing: 10 + 20 = 30
      expect(summaryA.totalCost).toBe(30);
      // Tracker B should use its own pricing: 100 + 200 = 300
      expect(summaryB.totalCost).toBe(300);
    });

    it('does not leak instance pricing into the global scope', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      createCostTracker({
        pricing: { 'instance-only-model': { input: 50, output: 50 } },
      });

      // A tracker without custom pricing should NOT see 'instance-only-model'
      const defaultTracker = createCostTracker();
      defaultTracker.record({ model: 'instance-only-model', inputTokens: 1_000_000, outputTokens: 1_000_000 });
      const summary = defaultTracker.getCost();
      // Unknown model => cost 0
      expect(summary.totalCost).toBe(0);
    });
  });
});
