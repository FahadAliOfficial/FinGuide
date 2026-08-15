import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { ValidationError } from './errors.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const boundedNumber = (label: string, max: number, allowZero = false): z.ZodNumber => {
  const number = z.number().finite().max(max, `${label} exceeds the supported maximum`);
  return allowZero
    ? number.gte(0, `${label} must be zero or greater`)
    : number.gt(0, `${label} must be greater than zero`);
};

export const compoundInterestInputSchema = z.object({
  principal: boundedNumber('Principal', 1_000_000_000),
  annualRate: boundedNumber('Annual rate', 100, true),
  years: boundedNumber('Years', 100),
  compoundsPerYear: z.number().int().min(1).max(365)
}).strict();

export const loanPaymentInputSchema = z.object({
  principal: boundedNumber('Principal', 1_000_000_000),
  annualRate: boundedNumber('Annual rate', 100, true).nullable(),
  termYears: boundedNumber('Term', 50),
  productName: z.string().trim().min(1).max(100).nullable()
}).strict().superRefine((value, context) => {
  if ((value.annualRate === null) === (value.productName === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide either annualRate or productName, but not both' });
  }
  const months = value.termYears * 12;
  if (!Number.isInteger(months)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['termYears'], message: 'Term must resolve to a whole number of months' });
  }
});

export type CompoundInterestInput = z.infer<typeof compoundInterestInputSchema>;
export type LoanPaymentInput = z.infer<typeof loanPaymentInputSchema>;

export interface FinancialResult {
  result: string;
  formulaVersion: 'compound-interest-v1' | 'amortized-loan-v1';
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '), { cause: parsed.error });
  }
  return parsed.data;
}

export function calculateCompoundInterest(untrusted: unknown): FinancialResult & { input: CompoundInterestInput } {
  const input = parseOrThrow(compoundInterestInputSchema, untrusted);
  const principal = new Decimal(input.principal);
  const periodicRate = new Decimal(input.annualRate).div(100).div(input.compoundsPerYear);
  const periods = new Decimal(input.compoundsPerYear).mul(input.years);
  const amount = principal.mul(periodicRate.plus(1).pow(periods));

  return { input, result: amount.toDecimalPlaces(2).toFixed(2), formulaVersion: 'compound-interest-v1' };
}

export function calculateLoanPayment(untrusted: unknown): FinancialResult & { input: LoanPaymentInput } {
  const input = parseOrThrow(loanPaymentInputSchema, untrusted);
  if (input.annualRate === null) {
    throw new ValidationError('A resolved annual rate is required for the formula');
  }

  const principal = new Decimal(input.principal);
  const months = new Decimal(input.termYears).mul(12);
  const monthlyRate = new Decimal(input.annualRate).div(100).div(12);
  const payment = monthlyRate.isZero()
    ? principal.div(months)
    : principal.mul(monthlyRate.mul(monthlyRate.plus(1).pow(months))).div(monthlyRate.plus(1).pow(months).minus(1));

  return { input, result: payment.toDecimalPlaces(2).toFixed(2), formulaVersion: 'amortized-loan-v1' };
}
