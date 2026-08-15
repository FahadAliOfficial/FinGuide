import type { CalculationResponse } from '@finguide/contracts';

export function formatCurrency(value: string): string {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(number)
    : value;
}

export function calculationLabel(type: CalculationResponse['type']): string {
  return type === 'LOAN_PAYMENT' ? 'Estimated monthly payment' : 'Estimated future value';
}

