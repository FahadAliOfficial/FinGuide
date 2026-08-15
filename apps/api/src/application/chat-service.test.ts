import { describe, expect, it } from 'vitest';
import { ChatService } from './chat-service.js';
import { FinancialToolExecutor, toolNames } from './tool-executor.js';
import { FakeConversationalLlm, FakeLlm, InMemoryConversations, fakeProducts } from '../test/fakes.js';

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
});
