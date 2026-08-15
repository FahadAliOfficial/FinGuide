import { describe, expect, it } from 'vitest';
import { FinancialToolExecutor, toolNames } from './tool-executor.js';
import type { ProductRepository } from './ports.js';
import { NotFoundError, UnsupportedRequestError, ValidationError } from '../domain/errors.js';

const products: ProductRepository = {
  findActiveByName: async (name) => name.toLowerCase() === 'home loan'
    ? { id: 'product-1', name: 'Home Loan', type: 'LOAN', annualInterestRate: '6.5' }
    : null
};
const executor = new FinancialToolExecutor(products);

describe('financial tool executor', () => {
  it('grounds a named loan in the stored rate', async () => {
    const result = await executor.execute({
      name: toolNames.loanPayment,
      arguments: { principal: 300_000, annualRate: null, termYears: 30, productName: 'Home Loan' }
    });
    expect(result).toMatchObject({
      result: '1896.20',
      productId: 'product-1',
      product: { name: 'Home Loan', annualInterestRate: '6.5' },
      inputs: { annualRate: 6.5 }
    });
  });

  it('rejects unknown products', async () => {
    await expect(executor.execute({
      name: toolNames.loanPayment,
      arguments: { principal: 1000, annualRate: null, termYears: 1, productName: 'Imaginary Loan' }
    })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects conflicting rate sources', async () => {
    await expect(executor.execute({
      name: toolNames.loanPayment,
      arguments: { principal: 1000, annualRate: 5, termYears: 1, productName: 'Home Loan' }
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects non-allow-listed tool names', async () => {
    await expect(executor.execute({ name: 'run_arbitrary_code', arguments: {} })).rejects.toBeInstanceOf(UnsupportedRequestError);
  });
});

