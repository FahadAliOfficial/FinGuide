import type {
  ChatHistoryItem,
  CalculationSummaryScope,
  ConversationRepository,
  LlmGateway,
  ModelToolCall,
  ProductRepository,
  StoredMessage,
  VerifiedCalculation,
  VerifiedCalculationSummary,
  VerifiedToolResult
} from '../application/ports.js';
import type { ConversationSummary } from '@finguide/contracts';
import { NotFoundError } from '../domain/errors.js';

export const fakeProducts: ProductRepository = {
  findActiveByName: async (name) => name.toLowerCase() === 'home loan'
    ? { id: 'product-1', name: 'Home Loan', type: 'LOAN', annualInterestRate: '6.5' }
    : null
};

export class InMemoryConversations implements ConversationRepository {
  private sequence = 0;
  readonly records = new Map<string, StoredMessage[]>();

  async resolveConversation(requestedId?: string): Promise<string> {
    if (requestedId && !this.records.has(requestedId)) throw new NotFoundError('Conversation not found.');
    const id = requestedId ?? 'cmockconversation00001';
    if (!this.records.has(id)) this.records.set(id, []);
    return id;
  }
  async appendUserMessage(id: string, content: string): Promise<void> { this.add(id, 'USER', content, null); }
  async recentMessages(id: string, limit: number): Promise<ChatHistoryItem[]> {
    return (this.records.get(id) ?? []).slice(-limit).map(({ role, content }) => ({ role, content }));
  }
  async appendAssistantResult(id: string, content: string, value: VerifiedCalculation): Promise<{ id: string; createdAt: Date }> {
    const calculation = {
      type: value.type,
      result: value.result,
      unit: value.unit,
      inputs: value.inputs,
      product: value.product,
      formulaVersion: value.formulaVersion
    };
    return this.add(id, 'ASSISTANT', content, calculation);
  }
  async appendAssistantMessage(id: string, content: string): Promise<{ id: string; createdAt: Date }> {
    return this.add(id, 'ASSISTANT', content, null);
  }
  async appendAssistantError(id: string, content: string): Promise<void> { this.add(id, 'ASSISTANT', content, null); }
  async getMessages(id: string): Promise<StoredMessage[]> {
    const value = this.records.get(id);
    if (!value) throw new NotFoundError('Conversation not found.');
    return value;
  }
  async listConversations(limit: number): Promise<ConversationSummary[]> {
    return [...this.records.entries()].map(([id, messages]) => ({
      id,
      title: messages.find((message) => message.role === 'USER')?.content ?? 'New conversation',
      preview: messages.at(-1)?.content ?? '',
      messageCount: messages.length,
      updatedAt: messages.at(-1)?.createdAt.toISOString() ?? new Date('2026-08-15T00:00:00Z').toISOString()
    })).slice(0, limit);
  }
  async getCalculationSummary(id: string, scope: CalculationSummaryScope): Promise<VerifiedCalculationSummary> {
    const messages = scope === 'CURRENT_CONVERSATION'
      ? (this.records.get(id) ?? [])
      : [...this.records.values()].flat();
    const calculations = messages.flatMap((message) => message.calculation ? [message.calculation] : []);
    const compoundInterest = calculations.filter((calculation) => calculation.type === 'COMPOUND_INTEREST').length;
    const loanPayments = calculations.filter((calculation) => calculation.type === 'LOAN_PAYMENT').length;
    return { kind: 'CALCULATION_SUMMARY', scope, total: calculations.length, compoundInterest, loanPayments };
  }
  private add(id: string, role: 'USER' | 'ASSISTANT', content: string, calculation: StoredMessage['calculation']): StoredMessage {
    const message = { id: `message-${++this.sequence}`, role, content, createdAt: new Date('2026-08-15T00:00:00Z'), calculation };
    this.records.get(id)?.push(message);
    return message;
  }
}

export class FakeLlm implements LlmGateway {
  constructor(private readonly call: ModelToolCall, private readonly explanation = 'The verified result is shown below. This is an estimate, not financial advice.') {}
  async completeCalculation(_history: ChatHistoryItem[], execute: (call: ModelToolCall) => Promise<VerifiedToolResult>) {
    const result = await execute(this.call);
    if ('kind' in result) throw new Error('FakeLlm expected a financial calculation');
    return { kind: 'calculation' as const, explanation: this.explanation, calculation: result };
  }
}

export class FakeConversationalLlm implements LlmGateway {
  constructor(private readonly reply: string) {}
  async completeCalculation() {
    return { kind: 'conversation' as const, explanation: this.reply, calculation: null };
  }
}

export class FakeSummaryLlm implements LlmGateway {
  constructor(private readonly scope: CalculationSummaryScope) {}
  async completeCalculation(
    _history: ChatHistoryItem[],
    execute: (call: ModelToolCall) => Promise<VerifiedToolResult>
  ) {
    const result = await execute({ name: 'get_calculation_summary', arguments: { scope: this.scope } });
    if (!('kind' in result)) throw new Error('FakeSummaryLlm expected a calculation summary');
    return {
      kind: 'conversation' as const,
      explanation: `${result.total} total calculation(s): ${result.compoundInterest} compound interest and ${result.loanPayments} loan payment(s).`,
      calculation: null
    };
  }
}
