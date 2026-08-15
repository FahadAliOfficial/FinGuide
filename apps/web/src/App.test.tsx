import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { getHistory, listConversations } from './api.js';

vi.mock('./api.js', () => ({
  ApiError: class ApiError extends Error {},
  getHistory: vi.fn(),
  listConversations: vi.fn(),
  sendChat: vi.fn()
}));

const mockedListConversations = vi.mocked(listConversations);
const mockedGetHistory = vi.mocked(getHistory);

describe('conversation history', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    mockedListConversations.mockResolvedValue({
      conversations: [{
        id: 'session-1',
        title: 'Home loan payment',
        preview: 'Your verified monthly payment is $1,896.20.',
        messageCount: 2,
        updatedAt: '2026-08-15T10:00:00.000Z'
      }]
    });
    mockedGetHistory.mockResolvedValue({
      conversationId: 'session-1',
      messages: [
        {
          id: 'message-1',
          role: 'USER',
          content: 'Calculate my Home Loan payment.',
          createdAt: '2026-08-15T09:59:00.000Z',
          calculation: null
        },
        {
          id: 'message-2',
          role: 'ASSISTANT',
          content: 'Your verified monthly payment is **$1,896.20**.',
          createdAt: '2026-08-15T10:00:00.000Z',
          calculation: null
        }
      ]
    });
  });

  it('lists and reopens a previous session', async () => {
    render(<App />);

    const sessionTitle = await screen.findByText('Home loan payment');
    expect(screen.getByText('2 messages')).toBeInTheDocument();

    fireEvent.click(sessionTitle.closest('button')!);

    expect(await screen.findByText('Calculate my Home Loan payment.')).toBeInTheDocument();
    expect(screen.getByText('$1,896.20')).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('finguide.conversationId')).toBe('session-1'));
    expect(mockedGetHistory).toHaveBeenCalledWith('session-1');
  });
});
