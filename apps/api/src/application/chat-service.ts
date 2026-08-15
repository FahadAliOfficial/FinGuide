import type { ChatResponse, ConversationListResponse, HistoryResponse } from '@finguide/contracts';
import { z } from 'zod';
import { AppError, UpstreamError, ValidationError } from '../domain/errors.js';
import type { ConversationRepository, DiagnosticLogger, LlmGateway, ModelToolCall, VerifiedToolResult } from './ports.js';
import { toolNames, type FinancialToolExecutor } from './tool-executor.js';

const calculationSummaryInputSchema = z.object({
  scope: z.enum(['CURRENT_CONVERSATION', 'ALL_CONVERSATIONS'])
}).strict();

const noopLogger: DiagnosticLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

export class ChatService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly llm: LlmGateway,
    private readonly tools: FinancialToolExecutor,
    private readonly historyLimit: number,
    private readonly logger: DiagnosticLogger = noopLogger
  ) {}

  async send(message: string, requestedConversationId?: string, requestId?: string): Promise<ChatResponse> {
    const startedAt = Date.now();
    let conversationId: string | undefined;
    let userMessagePersisted = false;
    try {
      const activeConversationId = await this.conversations.resolveConversation(requestedConversationId);
      conversationId = activeConversationId;
      await this.conversations.appendUserMessage(activeConversationId, message);
      userMessagePersisted = true;
      this.logger.info({
        event: 'chat.accepted',
        requestId,
        conversationId: activeConversationId,
        continuingConversation: requestedConversationId !== undefined
      }, 'chat request accepted');

      const history = await this.conversations.recentMessages(activeConversationId, this.historyLimit);
      const completed = await this.llm.completeCalculation(
        history,
        (call) => this.executeTool(activeConversationId, call),
        (toolName) => {
          this.logger.info({
            event: 'llm.tool_selected',
            requestId,
            conversationId: activeConversationId,
            toolName
          }, 'LLM selected tool');
        }
      );
      const saved = completed.kind === 'calculation'
        ? await this.conversations.appendAssistantResult(activeConversationId, completed.explanation, completed.calculation)
        : await this.conversations.appendAssistantMessage(activeConversationId, completed.explanation);

      const calculation = completed.kind === 'calculation' ? {
        type: completed.calculation.type,
        result: completed.calculation.result,
        unit: completed.calculation.unit,
        inputs: completed.calculation.inputs,
        product: completed.calculation.product,
        formulaVersion: completed.calculation.formulaVersion
      } : null;
      this.logger.info({
        event: 'chat.completed',
        requestId,
        conversationId: activeConversationId,
        outcome: completed.kind,
        calculationType: completed.kind === 'calculation' ? completed.calculation.type : undefined,
        formulaVersion: completed.kind === 'calculation' ? completed.calculation.formulaVersion : undefined,
        durationMs: Date.now() - startedAt
      }, 'chat request completed');
      return {
        conversationId: activeConversationId,
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
      const failureContext = {
        event: 'chat.failed',
        requestId,
        conversationId,
        errorCode: error instanceof AppError ? error.code : 'UNEXPECTED_ERROR',
        status: error instanceof AppError ? error.status : 500,
        durationMs: Date.now() - startedAt
      };
      if (error instanceof AppError && error.status < 500) {
        this.logger.warn(failureContext, 'chat request rejected');
      } else {
        this.logger.error({ ...failureContext, err: error }, 'chat request failed');
      }
      if (conversationId && userMessagePersisted) {
        try {
          await this.conversations.appendAssistantError(conversationId, safeMessage);
        } catch (persistenceError) {
          this.logger.error({
            event: 'chat.error_persistence_failed',
            requestId,
            conversationId,
            err: persistenceError
          }, 'failed to persist safe assistant error');
        }
      }
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

  private async executeTool(conversationId: string, call: ModelToolCall): Promise<VerifiedToolResult> {
    if (call.name !== toolNames.calculationSummary) {
      return this.tools.execute(call);
    }
    const parsed = calculationSummaryInputSchema.safeParse(call.arguments);
    if (!parsed.success) {
      throw new ValidationError('The calculation-summary request is invalid.', { cause: parsed.error });
    }
    return this.conversations.getCalculationSummary(conversationId, parsed.data.scope);
  }
}
