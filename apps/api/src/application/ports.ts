import type { CalculationResponse, ConversationSummary } from '@finguide/contracts';

export type ChatRole = 'USER' | 'ASSISTANT';

export interface ChatHistoryItem {
  role: ChatRole;
  content: string;
}

export interface ModelToolCall {
  name: string;
  arguments: unknown;
}

export interface VerifiedCalculation extends CalculationResponse {
  productId: string | null;
}

export type CalculationSummaryScope = 'CURRENT_CONVERSATION' | 'ALL_CONVERSATIONS';

export interface VerifiedCalculationSummary {
  kind: 'CALCULATION_SUMMARY';
  scope: CalculationSummaryScope;
  total: number;
  compoundInterest: number;
  loanPayments: number;
}

export type VerifiedToolResult = VerifiedCalculation | VerifiedCalculationSummary;

export type LlmCompletion =
  | { kind: 'calculation'; explanation: string; calculation: VerifiedCalculation }
  | { kind: 'conversation'; explanation: string; calculation: null };

export interface LlmGateway {
  completeCalculation(
    history: ChatHistoryItem[],
    execute: (call: ModelToolCall) => Promise<VerifiedToolResult>,
    onToolSelected?: (toolName: string) => void
  ): Promise<LlmCompletion>;
}

export interface DiagnosticLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface FinancialProductRecord {
  id: string;
  name: string;
  type: string;
  annualInterestRate: string;
}

export interface ProductRepository {
  findActiveByName(name: string): Promise<FinancialProductRecord | null>;
}

export interface StoredMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: Date;
  calculation: CalculationResponse | null;
}

export interface ConversationRepository {
  resolveConversation(requestedId?: string): Promise<string>;
  appendUserMessage(conversationId: string, content: string): Promise<void>;
  recentMessages(conversationId: string, limit: number): Promise<ChatHistoryItem[]>;
  appendAssistantResult(
    conversationId: string,
    content: string,
    calculation: VerifiedCalculation
  ): Promise<{ id: string; createdAt: Date }>;
  appendAssistantMessage(conversationId: string, content: string): Promise<{ id: string; createdAt: Date }>;
  appendAssistantError(conversationId: string, content: string): Promise<void>;
  getMessages(conversationId: string): Promise<StoredMessage[]>;
  listConversations(limit: number): Promise<ConversationSummary[]>;
  getCalculationSummary(conversationId: string, scope: CalculationSummaryScope): Promise<VerifiedCalculationSummary>;
}
