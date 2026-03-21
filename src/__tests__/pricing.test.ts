import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPrice, calculateCost, registerPricing, resetPricing, getBuiltInPricing } from '../pricing';

describe('pricing', () => {
  beforeEach(() => {
    resetPricing();
  });

  describe('getPrice', () => {
    it('returns correct pricing for gpt-4o', () => {
      const price = getPrice('gpt-4o');
      expect(price.input).toBe(2.50);
      expect(price.output).toBe(10.00);
    });

    it('returns correct pricing for gpt-4o-mini', () => {
      const price = getPrice('gpt-4o-mini');
      expect(price.input).toBe(0.15);
      expect(price.output).toBe(0.60);
    });

    it('returns correct pricing for gpt-4-turbo', () => {
      const price = getPrice('gpt-4-turbo');
      expect(price.input).toBe(10.00);
      expect(price.output).toBe(30.00);
    });

    it('returns correct pricing for gpt-4', () => {
      const price = getPrice('gpt-4');
      expect(price.input).toBe(30.00);
      expect(price.output).toBe(60.00);
    });

    it('returns correct pricing for gpt-3.5-turbo', () => {
      const price = getPrice('gpt-3.5-turbo');
      expect(price.input).toBe(0.50);
      expect(price.output).toBe(1.50);
    });

    it('returns correct pricing for o1', () => {
      const price = getPrice('o1');
      expect(price.input).toBe(15.00);
      expect(price.output).toBe(60.00);
    });

    it('returns correct pricing for o1-mini', () => {
      const price = getPrice('o1-mini');
      expect(price.input).toBe(3.00);
      expect(price.output).toBe(12.00);
    });

    it('returns correct pricing for o3-mini', () => {
      const price = getPrice('o3-mini');
      expect(price.input).toBe(1.10);
      expect(price.output).toBe(4.40);
    });

    it('returns correct pricing for claude-opus-4-20250514', () => {
      const price = getPrice('claude-opus-4-20250514');
      expect(price.input).toBe(15.00);
      expect(price.output).toBe(75.00);
    });

    it('returns correct pricing for claude-sonnet-4-20250514', () => {
      const price = getPrice('claude-sonnet-4-20250514');
      expect(price.input).toBe(3.00);
      expect(price.output).toBe(15.00);
    });

    it('returns correct pricing for claude-3-haiku-20240307', () => {
      const price = getPrice('claude-3-haiku-20240307');
      expect(price.input).toBe(0.25);
      expect(price.output).toBe(1.25);
    });

    it('returns correct pricing for gemini-1.5-pro', () => {
      const price = getPrice('gemini-1.5-pro');
      expect(price.input).toBe(1.25);
      expect(price.output).toBe(5.00);
    });

    it('returns correct pricing for gemini-1.5-flash', () => {
      const price = getPrice('gemini-1.5-flash');
      expect(price.input).toBe(0.075);
      expect(price.output).toBe(0.30);
    });

    it('returns correct pricing for gemini-2.0-flash', () => {
      const price = getPrice('gemini-2.0-flash');
      expect(price.input).toBe(0.10);
      expect(price.output).toBe(0.40);
    });

    it('matches model with dated suffix via prefix matching', () => {
      const price = getPrice('gpt-4o-2024-08-06');
      expect(price.input).toBe(2.50);
      expect(price.output).toBe(10.00);
    });

    it('matches gpt-4-turbo with dated suffix', () => {
      const price = getPrice('gpt-4-turbo-2024-04-09');
      expect(price.input).toBe(10.00);
      expect(price.output).toBe(30.00);
    });

    it('matches claude model with additional suffix', () => {
      const price = getPrice('claude-3-5-sonnet-20241022-v2');
      expect(price.input).toBe(3.00);
      expect(price.output).toBe(15.00);
    });

    it('returns zero pricing for unknown model with warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const price = getPrice('unknown-model-xyz');
      expect(price.input).toBe(0);
      expect(price.output).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown model "unknown-model-xyz"')
      );
      warnSpy.mockRestore();
    });

    it('only warns once per unknown model', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      getPrice('unknown-model-abc');
      getPrice('unknown-model-abc');
      getPrice('unknown-model-abc');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it('warns separately for different unknown models', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      getPrice('unknown-a');
      getPrice('unknown-b');
      expect(warnSpy).toHaveBeenCalledTimes(2);
      warnSpy.mockRestore();
    });
  });

  describe('registerPricing', () => {
    it('custom pricing overrides built-in pricing', () => {
      registerPricing({ 'gpt-4o': { input: 5.00, output: 20.00 } });
      const price = getPrice('gpt-4o');
      expect(price.input).toBe(5.00);
      expect(price.output).toBe(20.00);
    });

    it('custom pricing adds new models', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      registerPricing({ 'my-custom-model': { input: 1.00, output: 2.00 } });
      const price = getPrice('my-custom-model');
      expect(price.input).toBe(1.00);
      expect(price.output).toBe(2.00);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('custom pricing supports prefix matching', () => {
      registerPricing({ 'my-model': { input: 3.00, output: 6.00 } });
      const price = getPrice('my-model-v2');
      expect(price.input).toBe(3.00);
      expect(price.output).toBe(6.00);
    });

    it('multiple registerPricing calls merge', () => {
      registerPricing({ 'model-a': { input: 1.00, output: 2.00 } });
      registerPricing({ 'model-b': { input: 3.00, output: 4.00 } });
      expect(getPrice('model-a').input).toBe(1.00);
      expect(getPrice('model-b').input).toBe(3.00);
    });
  });

  describe('calculateCost', () => {
    it('computes cost correctly for gpt-4o', () => {
      // 500 input tokens, 150 output tokens
      // cost = (500/1M * 2.50) + (150/1M * 10.00) = 0.00125 + 0.0015 = 0.00275
      const cost = calculateCost('gpt-4o', 500, 150);
      expect(cost).toBeCloseTo(0.00275, 8);
    });

    it('computes cost correctly for gpt-4o-mini', () => {
      // 1000 input, 500 output
      // cost = (1000/1M * 0.15) + (500/1M * 0.60) = 0.00015 + 0.0003 = 0.00045
      const cost = calculateCost('gpt-4o-mini', 1000, 500);
      expect(cost).toBeCloseTo(0.00045, 8);
    });

    it('returns zero cost for zero tokens', () => {
      const cost = calculateCost('gpt-4o', 0, 0);
      expect(cost).toBe(0);
    });

    it('returns zero cost for unknown model', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const cost = calculateCost('nonexistent-model', 1000, 1000);
      expect(cost).toBe(0);
    });

    it('handles large token counts without overflow', () => {
      // 10 million tokens
      const cost = calculateCost('gpt-4o', 10_000_000, 10_000_000);
      // cost = (10M/1M * 2.50) + (10M/1M * 10.00) = 25 + 100 = 125
      expect(cost).toBeCloseTo(125, 4);
    });

    it('handles very small token counts', () => {
      const cost = calculateCost('gpt-4o', 1, 1);
      // cost = (1/1M * 2.50) + (1/1M * 10.00) = 0.0000025 + 0.00001 = 0.0000125
      expect(cost).toBeCloseTo(0.0000125, 10);
    });

    it('uses custom pricing when registered', () => {
      registerPricing({ 'custom': { input: 100, output: 200 } });
      const cost = calculateCost('custom', 1_000_000, 1_000_000);
      // cost = (1M/1M * 100) + (1M/1M * 200) = 100 + 200 = 300
      expect(cost).toBe(300);
    });
  });

  describe('getBuiltInPricing', () => {
    it('returns all built-in models', () => {
      const pricing = getBuiltInPricing();
      expect(Object.keys(pricing).length).toBeGreaterThanOrEqual(16);
      expect(pricing['gpt-4o']).toBeDefined();
      expect(pricing['claude-opus-4-20250514']).toBeDefined();
      expect(pricing['gemini-2.0-flash']).toBeDefined();
    });

    it('returns a copy that cannot modify the original', () => {
      const pricing = getBuiltInPricing();
      (pricing as Record<string, unknown>)['gpt-4o'] = { input: 999, output: 999 };
      // Original should be unchanged
      const fresh = getPrice('gpt-4o');
      expect(fresh.input).toBe(2.50);
    });
  });

  describe('resetPricing', () => {
    it('clears custom pricing', () => {
      registerPricing({ 'custom-model': { input: 1, output: 2 } });
      expect(getPrice('custom-model').input).toBe(1);
      resetPricing();
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(getPrice('custom-model').input).toBe(0);
      spy.mockRestore();
    });

    it('clears warned models set', () => {
      resetPricing();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      getPrice('warn-reset-model');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      resetPricing();
      getPrice('warn-reset-model');
      expect(warnSpy).toHaveBeenCalledTimes(2);
      warnSpy.mockRestore();
    });
  });
});
