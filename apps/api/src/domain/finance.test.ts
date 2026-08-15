import { describe, expect, it } from 'vitest';
import { calculateCompoundInterest, calculateLoanPayment } from './finance.js';
import { ValidationError } from './errors.js';

describe('financial formulas', () => {
  it('calculates annual compound interest deterministically', () => {
    const value = calculateCompoundInterest({ principal: 10_000, annualRate: 8, years: 5, compoundsPerYear: 1 });
    expect(value.result).toBe('14693.28');
    expect(value.formulaVersion).toBe('compound-interest-v1');
  });

  it('calculates a standard amortized monthly payment', () => {
    const value = calculateLoanPayment({ principal: 300_000, annualRate: 6.5, termYears: 30, productName: null });
    expect(value.result).toBe('1896.20');
  });

  it('handles zero interest without division by zero', () => {
    const value = calculateLoanPayment({ principal: 120_000, annualRate: 0, termYears: 10, productName: null });
    expect(value.result).toBe('1000.00');
  });

  it.each([
    { principal: -1, annualRate: 8, years: 5, compoundsPerYear: 1 },
    { principal: 1_000, annualRate: 101, years: 5, compoundsPerYear: 1 },
    { principal: 1_000, annualRate: 8, years: 5, compoundsPerYear: 0 }
  ])('rejects unsafe compound inputs: %j', (input) => {
    expect(() => calculateCompoundInterest(input)).toThrow(ValidationError);
  });

  it('requires a loan term that resolves to full months', () => {
    expect(() => calculateLoanPayment({ principal: 1000, annualRate: 5, termYears: 1.01, productName: null })).toThrow(ValidationError);
  });
});

