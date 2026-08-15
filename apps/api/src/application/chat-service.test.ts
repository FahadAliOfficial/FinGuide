import { describe, expect, it, vi } from 'vitest';
import { ChatService } from './chat-service.js';
import { FinancialToolExecutor, toolNames } from './tool-executor.js';
import { FakeConversationalLlm, FakeLlm, FakeSummaryLlm, InMemoryConversations, fakeProducts } from '../test/fakes.js';
import { UpstreamError } from '../domain/errors.js';
import type { DiagnosticLogger, LlmGateway } from './ports.js';

describe('chat service', () => {
  it('coordinates model intent, backend calculation, and audit storage', async () => {
    const conversations = new InMemoryConversations();
    const service = new ChatService(
      conversations,
      new FakeLlm({ name: toolNames.compoundInterest, arguments: { principal: 10_000, annualRate: 8, years: 5, compoundsPerYear: 1 } }),
      new FinancialToolExecutor(fakeProducts),
      12
    );

    const response = await service.send('What will $10,000 become after 5 years at 8%?');
    expect(response.calculation.result).toBe('14693.28');
    const history = await service.history(response.conversationId);
    expect(history.messages).toHaveLength(2);
    expect(history.messages[1]?.calculation?.formulaVersion).toBe('compound-interest-v1');
  });

  it('persists conversational replies without inventing a calculation', async () => {
    const conversations = new InMemoryConversations();
    const service = new ChatService(
      conversations,
      new FakeConversationalLlm('Hello! Ask me about compound interest or a monthly loan payment.'),
      new FinancialToolExecutor(fakeProducts),
      12
    );

    const response = await service.send('Hello, how are you?');

    expect(response.calculation).toBeNull();
    expect(response.message.content).toContain('Hello!');
    const history = await service.history(response.conversationId);
    expect(history.messages).toHaveLength(2);
    expect(history.messages[1]?.calculation).toBeNull();
  });

  it('answers calculation-history questions from backend-stored records', async () => {
    const conversations = new InMemoryConversations();
    const tools = new FinancialToolExecutor(fakeProducts);
    const calculationService = new ChatService(
      conversations,
      new FakeLlm({ name: toolNames.compoundInterest, arguments: { principal: 1_000, annualRate: 5, years: 1, compoundsPerYear: 1 } }),
      tools,
      12
    );
    await calculationService.send('Calculate one compound-interest result.');

    const summaryService = new ChatService(
      conversations,
      new FakeSummaryLlm('ALL_CONVERSATIONS'),
      tools,
      12
    );
    const response = await summaryService.send('How many calculations have you made total for me?');

    expect(response.calculation).toBeNull();
    expect(response.message.content).toContain('1 total calculation');
    expect(response.message.content).toContain('1 compound interest');
  });

  it('emits request-correlated diagnostic events without logging message content or tool arguments', async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const logger: DiagnosticLogger = { info, warn, error };
    const service = new ChatService(
      new InMemoryConversations(),
      new FakeLlm({ name: toolNames.compoundInterest, arguments: { principal: 10_000, annualRate: 8, years: 5, compoundsPerYear: 1 } }),
      new FinancialToolExecutor(fakeProducts),
      12,
      logger
    );

    await service.send('private financial question', undefined, 'request-123');

    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'llm.tool_selected',
      requestId: 'request-123',
      toolName: toolNames.compoundInterest
    }), 'LLM selected tool');
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'chat.completed',
      requestId: 'request-123',
      outcome: 'calculation',
      calculationType: 'COMPOUND_INTEREST'
    }), 'chat request completed');
    expect(JSON.stringify(info.mock.calls)).not.toContain('private financial question');
    expect(JSON.stringify(info.mock.calls)).not.toContain('principal');
    expect(error).not.toHaveBeenCalled();
  });

  it('logs safe diagnostic context when chat processing fails', async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const logger: DiagnosticLogger = { info, warn, error };
    const failingLlm: LlmGateway = {
      completeCalculation: async () => { throw new UpstreamError('Provider unavailable'); }
    };
    const service = new ChatService(
      new InMemoryConversations(),
      failingLlm,
      new FinancialToolExecutor(fakeProducts),
      12,
      logger
    );

    await expect(service.send('Calculate something.', undefined, 'request-456'))
      .rejects.toMatchObject({ code: 'AI_SERVICE_ERROR' });

    expect(error).toHaveBeenCalledWith(expect.objectContaining({
      event: 'chat.failed',
      requestId: 'request-456',
      errorCode: 'AI_SERVICE_ERROR',
      status: 503
    }), 'chat request failed');
  });

  it('records expected client failures as warnings instead of server errors', async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const service = new ChatService(
      new InMemoryConversations(),
      new FakeLlm({
        name: toolNames.loanPayment,
        arguments: { principal: 100_000, annualRate: null, termYears: 20, productName: 'Unknown Loan' }
      }),
      new FinancialToolExecutor(fakeProducts),
      12,
      { info, warn, error }
    );

    await expect(service.send('Use an unknown product.', undefined, 'request-789'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      event: 'chat.failed',
      requestId: 'request-789',
      errorCode: 'NOT_FOUND',
      status: 404
    }), 'chat request rejected');
    expect(error).not.toHaveBeenCalled();
  });

  it('diagnoses a secondary failure while persisting the safe assistant error', async () => {
    const conversations = new InMemoryConversations();
    vi.spyOn(conversations, 'appendAssistantError').mockRejectedValue(new Error('database unavailable'));
    const error = vi.fn();
    const service = new ChatService(
      conversations,
      { completeCalculation: async () => { throw new UpstreamError('Provider unavailable'); } },
      new FinancialToolExecutor(fakeProducts),
      12,
      { info: vi.fn(), warn: vi.fn(), error }
    );

    await expect(service.send('Calculate something.', undefined, 'request-999'))
      .rejects.toMatchObject({ code: 'AI_SERVICE_ERROR' });

    expect(error).toHaveBeenCalledWith(expect.objectContaining({
      event: 'chat.error_persistence_failed',
      requestId: 'request-999'
    }), 'failed to persist safe assistant error');
  });
});
