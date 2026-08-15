import type { ChatResponse, ConversationListResponse, HistoryResponse } from '@finguide/contracts';
import { AppError, UpstreamError } from '../domain/errors.js';
import type { ConversationRepository, LlmGateway } from './ports.js';
import type { FinancialToolExecutor } from './tool-executor.js';

export class ChatService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly llm: LlmGateway,
    private readonly tools: FinancialToolExecutor,
    private readonly historyLimit: number
  ) {}

  async send(message: string, requestedConversationId?: string): Promise<ChatResponse> {
    const conversationId = await this.conversations.resolveConversation(requestedConversationId);
    await this.conversations.appendUserMessage(conversationId, message);

    try {
      const history = await this.conversations.recentMessages(conversationId, this.historyLimit);
      const completed = await this.llm.completeCalculation(history, (call) => this.tools.execute(call));
      const saved = completed.kind === 'calculation'
        ? await this.conversations.appendAssistantResult(conversationId, completed.explanation, completed.calculation)
        : await this.conversations.appendAssistantMessage(conversationId, completed.explanation);

      const calculation = completed.kind === 'calculation' ? {
        type: completed.calculation.type,
        result: completed.calculation.result,
        unit: completed.calculation.unit,
        inputs: completed.calculation.inputs,
        product: completed.calculation.product,
        formulaVersion: completed.calculation.formulaVersion
      } : null;
      return {
        conversationId,
        message: {
          id: saved.id,
          role: 'ASSISTANT',
          content: completed.explanation,
          createdAt: saved.createdAt.toISOString()
        },
        calculation
      };
    } catch (error) {
      const safeMessage = error instanceof AppError && error.expose
        ? error.message
        : 'I could not complete that calculation right now. Please try again.';
      await this.conversations.appendAssistantError(conversationId, safeMessage).catch(() => undefined);
      if (error instanceof AppError) throw error;
      throw new UpstreamError(undefined, { cause: error });
    }
  }

  async history(conversationId: string): Promise<HistoryResponse> {
    const messages = await this.conversations.getMessages(conversationId);
    return {
      conversationId,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        calculation: message.calculation
      }))
    };
  }

  async listConversations(limit: number): Promise<ConversationListResponse> {
    return { conversations: await this.conversations.listConversations(limit) };
  }
}
