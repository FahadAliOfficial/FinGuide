import { describe, expect, it } from 'vitest';
import { calculationLabel, formatCurrency } from './format.js';

describe('presentation formatting', () => {
  it('formats verified money values', () => expect(formatCurrency('4402.05')).toBe('$4,402.05'));
  it('labels both calculation types', () => {
    expect(calculationLabel('LOAN_PAYMENT')).toBe('Estimated monthly payment');
    expect(calculationLabel('COMPOUND_INTEREST')).toBe('Estimated future value');
  });
});
