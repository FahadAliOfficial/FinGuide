import { chatResponseSchema, conversationListResponseSchema, errorResponseSchema, historyResponseSchema } from '@finguide/contracts';
import type { ChatRequest, ChatResponse, ConversationListResponse, HistoryResponse } from '@finguide/contracts';

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly requestId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit, parse: (value: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, init);
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(value);
    throw new ApiError(
      parsed.success ? parsed.data.error.code : 'REQUEST_FAILED',
      parsed.success ? parsed.data.error.message : 'The request failed. Please try again.',
      parsed.success ? parsed.data.error.requestId : undefined
    );
  }
  return parse(value);
}

export function sendChat(input: ChatRequest): Promise<ChatResponse> {
  return request('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  }, (value) => chatResponseSchema.parse(value));
}

export function getHistory(conversationId: string): Promise<HistoryResponse> {
  return request(`/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'GET' }, (value) => historyResponseSchema.parse(value));
}

export function listConversations(limit = 20): Promise<ConversationListResponse> {
  return request(`/conversations?limit=${limit}`, { method: 'GET' }, (value) => conversationListResponseSchema.parse(value));
}
