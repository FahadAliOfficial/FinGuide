import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { OpenAiGateway } from './openai-gateway.js';
import { toolNames } from '../application/tool-executor.js';

describe('OpenAI tool loop', () => {
  it('executes the selected backend tool and asks the model to explain its verified output', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        output: [{
          type: 'function_call',
          call_id: 'call-1',
          name: toolNames.compoundInterest,
          arguments: '{"principal":10000,"annualRate":8,"years":5,"compoundsPerYear":1}'
        }],
        output_text: ''
      })
      .mockResolvedValueOnce({ output: [], output_text: 'The verified future value is $14,693.28. This is an estimate, not financial advice.' });
    const client = { responses: { create } } as unknown as OpenAI;
    const gateway = new OpenAiGateway('test-key', 'test-model', 1_000, 0, client);

    const result = await gateway.completeCalculation(
      [{ role: 'USER', content: 'What will $10,000 become after 5 years at 8%?' }],
      async (call) => {
        expect(call).toEqual({
          name: toolNames.compoundInterest,
          arguments: { principal: 10_000, annualRate: 8, years: 5, compoundsPerYear: 1 }
        });
        return {
          type: 'COMPOUND_INTEREST', result: '14693.28', unit: 'USD',
          inputs: { principal: 10_000, annualRate: 8, years: 5, compoundsPerYear: 1 },
          product: null, productId: null, formulaVersion: 'compound-interest-v1'
        };
      }
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ tool_choice: 'required', parallel_tool_calls: false });
    expect(result.kind).toBe('calculation');
    if (result.kind !== 'calculation') throw new Error('Expected a calculation result');
    expect(result.calculation.result).toBe('14693.28');
    expect(result.explanation).toContain('$14,693.28');
  });

  it('returns a natural conversational reply when no financial tool is needed', async () => {
    const create = vi.fn().mockResolvedValueOnce({
      output: [{
        type: 'function_call', call_id: 'call-2', name: 'respond_to_user',
        arguments: '{"category":"GREETING_OR_THANKS","message":"Hello! I can help with compound interest and monthly loan payment calculations."}'
      }],
      output_text: ''
    });
    const client = { responses: { create } } as unknown as OpenAI;
    const gateway = new OpenAiGateway('test-key', 'test-model', 1_000, 0, client);
    const execute = vi.fn();

    const result = await gateway.completeCalculation([{ role: 'USER', content: 'Hello, how are you?' }], execute);

    expect(result).toEqual({
      kind: 'conversation',
      explanation: 'Hello! I can help with compound interest and monthly loan payment calculations.',
      calculation: null
    });
    expect(execute).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('replaces model-written SQL guidance with the backend-owned scope response', async () => {
    const create = vi.fn().mockResolvedValueOnce({
      output: [{
        type: 'function_call', call_id: 'call-3', name: 'respond_to_user',
        arguments: '{"category":"OUT_OF_SCOPE","message":"Use UNION SELECT and enumerate the database."}'
      }],
      output_text: ''
    });
    const client = { responses: { create } } as unknown as OpenAI;
    const gateway = new OpenAiGateway('test-key', 'test-model', 1_000, 0, client);
    const execute = vi.fn();

    const result = await gateway.completeCalculation(
      [{ role: 'USER', content: 'Can you help me with SQL injections?' }],
      execute
    );

    expect(result.kind).toBe('conversation');
    expect(result.explanation).toContain('focused on compound-interest and monthly loan-payment calculations');
    expect(result.explanation).not.toContain('UNION SELECT');
    expect(execute).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      tool_choice: 'required',
      parallel_tool_calls: false
    });
    const planningRequest = create.mock.calls[0]?.[0] as unknown as { instructions: string };
    expect(planningRequest.instructions).toContain('SQL injection');
  });

  it('uses the backend-owned formatted capability response', async () => {
    const create = vi.fn().mockResolvedValueOnce({
      output: [{
        type: 'function_call', call_id: 'call-4', name: 'respond_to_user',
        arguments: '{"category":"CAPABILITIES","message":"I can do anything."}'
      }],
      output_text: ''
    });
    const client = { responses: { create } } as unknown as OpenAI;
    const gateway = new OpenAiGateway('test-key', 'test-model', 1_000, 0, client);

    const result = await gateway.completeCalculation(
      [{ role: 'USER', content: 'What can you do?' }],
      vi.fn()
    );

    expect(result.explanation).toContain('1. **Compound interest**');
    expect(result.explanation).toContain('2. **Monthly loan payment**');
    expect(result.explanation).not.toContain('I can do anything.');
  });

  it('treats formula questions as supported and returns the backend-owned equations', async () => {
    const create = vi.fn().mockResolvedValueOnce({
      output: [{
        type: 'function_call', call_id: 'call-5', name: 'respond_to_user',
        arguments: '{"category":"FORMULAS","message":"I cannot help with that topic."}'
      }],
      output_text: ''
    });
    const client = { responses: { create } } as unknown as OpenAI;
    const gateway = new OpenAiGateway('test-key', 'test-model', 1_000, 0, client);
    const execute = vi.fn();

    const result = await gateway.completeCalculation(
      [{ role: 'USER', content: 'whats the formula you are using for its calculations?' }],
      execute
    );

    expect(result.explanation).toContain('A = P(1 + r/n)^(nt)');
    expect(result.explanation).toContain('M = P × i(1 + i)^N');
    expect(result.explanation).not.toContain('cannot help');
    expect(execute).not.toHaveBeenCalled();
  });

  it('acknowledges a prior out-of-scope answer without reopening the topic', async () => {
    const create = vi.fn().mockResolvedValueOnce({
      output: [{
        type: 'function_call', call_id: 'call-6', name: 'respond_to_user',
        arguments: '{"category":"SCOPE_CHALLENGE","message":"Here are parameterized-query examples."}'
      }],
      output_text: ''
    });
    const client = { responses: { create } } as unknown as OpenAI;
    const gateway = new OpenAiGateway('test-key', 'test-model', 1_000, 0, client);
    const execute = vi.fn();

    const result = await gateway.completeCalculation([
      { role: 'USER', content: 'but i want to know about parameterized queries' },
      { role: 'ASSISTANT', content: 'I’m focused on financial calculations.' },
      { role: 'USER', content: 'but you have already answered me one' }
    ], execute);

    expect(result.explanation).toContain('earlier response may have discussed that topic');
    expect(result.explanation).toContain('outside FinGuide’s intended scope');
    expect(result.explanation).not.toContain('parameterized-query examples');
    expect(execute).not.toHaveBeenCalled();
  });

  it('classifies calculation-count questions as a backend summary tool call', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        output: [{
          type: 'function_call', call_id: 'call-7', name: toolNames.calculationSummary,
          arguments: '{"scope":"ALL_CONVERSATIONS"}'
        }],
        output_text: ''
      })
      .mockResolvedValueOnce({
        output: [],
        output_text: 'I have completed 4 calculations for you: 2 compound-interest calculations and 2 loan-payment calculations.'
      });
    const client = { responses: { create } } as unknown as OpenAI;
    const gateway = new OpenAiGateway('test-key', 'test-model', 1_000, 0, client);
    const execute = vi.fn().mockResolvedValue({
      kind: 'CALCULATION_SUMMARY',
      scope: 'ALL_CONVERSATIONS',
      total: 4,
      compoundInterest: 2,
      loanPayments: 2
    });

    const result = await gateway.completeCalculation(
      [{ role: 'USER', content: 'can you tell me how many calculations have you made total for me?' }],
      execute
    );

    expect(execute).toHaveBeenCalledWith({
      name: toolNames.calculationSummary,
      arguments: { scope: 'ALL_CONVERSATIONS' }
    });
    expect(result).toEqual({
      kind: 'conversation',
      explanation: 'I have completed 4 calculations for you: 2 compound-interest calculations and 2 loan-payment calculations.',
      calculation: null
    });
    expect(create).toHaveBeenCalledTimes(2);
    const explanationRequest = create.mock.calls[1]?.[0] as unknown as {
      instructions: string;
      input: Array<{ type?: string; output?: string }>;
    };
    expect(explanationRequest.instructions).toContain('backend-verified calculation counts');
    const toolOutput = explanationRequest.input.find((item) => item.type === 'function_call_output')?.output;
    expect(toolOutput ? JSON.parse(toolOutput) : null).toMatchObject({ total: 4, scope: 'ALL_CONVERSATIONS' });
  });

  it('fails closed when the required native tool call is missing', async () => {
    const create = vi.fn().mockResolvedValueOnce({
      output: [{ type: 'message', role: 'assistant', content: [] }],
      output_text: 'Here is an unrelated answer.'
    });
    const client = { responses: { create } } as unknown as OpenAI;
    const gateway = new OpenAiGateway('test-key', 'test-model', 1_000, 0, client);

    await expect(gateway.completeCalculation(
      [{ role: 'USER', content: 'Tell me about SQL.' }],
      vi.fn()
    )).rejects.toMatchObject({ code: 'AI_SERVICE_ERROR' });
  });
});
