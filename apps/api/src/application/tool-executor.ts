import type { CalculationType } from '@finguide/contracts';
import {
  calculateCompoundInterest,
  calculateLoanPayment,
  loanPaymentInputSchema
} from '../domain/finance.js';
import { NotFoundError, UnsupportedRequestError, ValidationError } from '../domain/errors.js';
import type { ModelToolCall, ProductRepository, VerifiedCalculation } from './ports.js';

export const toolNames = {
  compoundInterest: 'calculate_compound_interest',
  loanPayment: 'calculate_loan_payment',
  calculationSummary: 'get_calculation_summary'
} as const;

export class FinancialToolExecutor {
  constructor(private readonly products: ProductRepository) {}

  async execute(call: ModelToolCall): Promise<VerifiedCalculation> {
    switch (call.name) {
      case toolNames.compoundInterest:
        return this.compoundInterest(call.arguments);
      case toolNames.loanPayment:
        return this.loanPayment(call.arguments);
      default:
        throw new UnsupportedRequestError('The selected financial operation is not supported.');
    }
  }

  private compoundInterest(argumentsValue: unknown): VerifiedCalculation {
    const calculated = calculateCompoundInterest(argumentsValue);
    return {
      type: 'COMPOUND_INTEREST' satisfies CalculationType,
      result: calculated.result,
      unit: 'USD',
      inputs: calculated.input,
      product: null,
      productId: null,
      formulaVersion: calculated.formulaVersion
    };
  }

  private async loanPayment(argumentsValue: unknown): Promise<VerifiedCalculation> {
    const parsed = loanPaymentInputSchema.safeParse(argumentsValue);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '), { cause: parsed.error });
    }

    let rate = parsed.data.annualRate;
    let product: Awaited<ReturnType<ProductRepository['findActiveByName']>> = null;
    if (parsed.data.productName !== null) {
      product = await this.products.findActiveByName(parsed.data.productName);
      if (!product || product.type !== 'LOAN') {
        throw new NotFoundError(`No active loan product named "${parsed.data.productName}" was found.`);
      }
      rate = Number(product.annualInterestRate);
    }
    if (rate === null || !Number.isFinite(rate)) {
      throw new ValidationError('The annual rate could not be resolved.');
    }

    const normalizedInput = { ...parsed.data, annualRate: rate, productName: null };
    const calculated = calculateLoanPayment(normalizedInput);
    return {
      type: 'LOAN_PAYMENT' satisfies CalculationType,
      result: calculated.result,
      unit: 'USD',
      inputs: {
        principal: calculated.input.principal,
        annualRate: calculated.input.annualRate ?? rate,
        termYears: calculated.input.termYears,
        ...(product ? { productName: product.name } : {})
      },
      product: product ? { name: product.name, annualInterestRate: product.annualInterestRate } : null,
      productId: product?.id ?? null,
      formulaVersion: calculated.formulaVersion
    };
  }
}
