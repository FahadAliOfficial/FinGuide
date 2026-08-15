import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { CalculationResponse, ConversationSummary } from '@finguide/contracts';
import { ApiError, getHistory, listConversations, sendChat } from './api.js';
import { calculationLabel, formatCurrency } from './format.js';
import { MessageContent } from './MessageContent.js';

interface UiMessage {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  calculation: CalculationResponse | null;
}

const examples = [
  'What will $10,000 become after 5 years at 8% annual interest?',
  'What is the monthly payment for a $300,000 loan at 6.5% for 30 years?',
  'Calculate the monthly payment for a $300,000 Home Loan over 30 years using the stored rate.'
];
const storageKey = 'finguide.conversationId';

function sessionTime(value: string): string {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(date)
    : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
}

function Logo(): React.JSX.Element {
  return <div className="logo" aria-hidden="true"><span>F</span></div>;
}

function CalculationCard({ calculation }: { calculation: CalculationResponse }): React.JSX.Element {
  return (
    <div className="calculation-card" aria-label="Backend verified result">
      <div className="verified"><span>✓</span> Backend verified</div>
      <div className="calculation-label">{calculationLabel(calculation.type)}</div>
      <strong>{formatCurrency(calculation.result)}</strong>
      {calculation.product && (
        <div className="product-rate">{calculation.product.name} · {calculation.product.annualInterestRate}% stored APR</div>
      )}
    </div>
  );
}

export function App(): React.JSX.Element {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async (): Promise<void> => {
    try {
      const result = await listConversations();
      setConversations(result.conversations);
    } catch {
      setConversations([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
    const savedId = localStorage.getItem(storageKey);
    if (!savedId) { setRestoring(false); return; }
    getHistory(savedId)
      .then((history) => {
        setConversationId(history.conversationId);
        setMessages(history.messages.map((message) => ({
          id: message.id, role: message.role, content: message.content, calculation: message.calculation
        })));
      })
      .catch(() => localStorage.removeItem(storageKey))
      .finally(() => setRestoring(false));
  }, [refreshConversations]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const newConversation = (): void => {
    if (loading) return;
    setMessages([]);
    setConversationId(undefined);
    setInput('');
    setError(null);
    localStorage.removeItem(storageKey);
  };

  const openConversation = async (id: string): Promise<void> => {
    if (loading || id === conversationId) return;
    setRestoring(true);
    setError(null);
    try {
      const history = await getHistory(id);
      setConversationId(history.conversationId);
      setMessages(history.messages.map((message) => ({
        id: message.id, role: message.role, content: message.content, calculation: message.calculation
      })));
      localStorage.setItem(storageKey, history.conversationId);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load that conversation.');
      await refreshConversations();
    } finally {
      setRestoring(false);
    }
  };

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    const content = input.trim();
    if (!content || loading) return;

    const optimistic: UiMessage = { id: `local-${crypto.randomUUID()}`, role: 'USER', content, calculation: null };
    setMessages((current) => [...current, optimistic]);
    setInput('');
    setError(null);
    setLoading(true);
    try {
      const response = await sendChat({ message: content, ...(conversationId ? { conversationId } : {}) });
      setConversationId(response.conversationId);
      localStorage.setItem(storageKey, response.conversationId);
      setMessages((current) => [...current, {
        id: response.message.id,
        role: response.message.role,
        content: response.message.content,
        calculation: response.calculation
      }]);
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
      void refreshConversations();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const empty = !restoring && messages.length === 0;
  return (
    <div className="app-shell">
      <header>
        <div className="brand"><Logo /><div><b>FinGuide</b><span>AI financial calculator</span></div></div>
        <button className="new-chat" type="button" onClick={newConversation} disabled={loading}>＋ New calculation</button>
      </header>

      <aside className="history-panel" aria-label="Conversation history">
        <div className="history-heading">
          <span>Recent sessions</span>
          <span>{conversations.length}</span>
        </div>
        <div className="history-list">
          {historyLoading && <div className="history-state">Loading history…</div>}
          {!historyLoading && conversations.length === 0 && (
            <div className="history-state">Your previous calculations will appear here.</div>
          )}
          {conversations.map((conversation) => (
            <button
              type="button"
              className={`history-item ${conversation.id === conversationId ? 'active' : ''}`}
              key={conversation.id}
              onClick={() => void openConversation(conversation.id)}
              disabled={loading || restoring}
              aria-current={conversation.id === conversationId ? 'page' : undefined}
            >
              <span className="history-title">{conversation.title}</span>
              <span className="history-preview">{conversation.preview}</span>
              <span className="history-meta">
                <span>{conversation.messageCount} messages</span>
                <time dateTime={conversation.updatedAt}>{sessionTime(conversation.updatedAt)}</time>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main aria-busy={loading || restoring}>
        {restoring && <div className="center-state"><span className="spinner" /> Restoring conversation…</div>}
        {empty && (
          <section className="welcome">
            <div className="hero-mark"><Logo /></div>
            <p className="eyebrow">Trusted calculations, natural conversation</p>
            <h1>Make the numbers<br /><em>make sense.</em></h1>
            <p className="intro">Ask about compound growth or monthly loan payments. AI understands your request; verified backend formulas do the math.</p>
            <div className="examples">
              {examples.map((example, index) => (
                <button type="button" key={example} onClick={() => setInput(example)}>
                  <span>0{index + 1}</span>{example}<i>↗</i>
                </button>
              ))}
            </div>
          </section>
        )}

        {!empty && !restoring && (
          <section className="thread" aria-live="polite">
            <div className="thread-title"><span>Current analysis</span><i /></div>
            {messages.map((message) => (
              <article className={`message ${message.role.toLowerCase()}`} key={message.id}>
                <div className="avatar">{message.role === 'USER' ? 'You' : <Logo />}</div>
                <div className="message-body">
                  <div className="speaker">{message.role === 'USER' ? 'You' : 'FinGuide'}</div>
                  <MessageContent content={message.content} role={message.role} />
                  {message.calculation && <CalculationCard calculation={message.calculation} />}
                </div>
              </article>
            ))}
            {loading && (
              <article className="message assistant">
                <div className="avatar"><Logo /></div>
                <div className="message-body"><div className="speaker">FinGuide</div><div className="thinking"><i /><i /><i /> Validating and calculating</div></div>
              </article>
            )}
            <div ref={endRef} />
          </section>
        )}
      </main>

      <footer>
        {error && <div className="error" role="alert"><span>!</span>{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
        <form onSubmit={(event) => void submit(event)}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            maxLength={2000}
            rows={1}
            placeholder="Ask a financial question…"
            aria-label="Financial question"
            disabled={loading || restoring}
          />
          <button type="submit" disabled={!input.trim() || loading || restoring} aria-label="Send message">↑</button>
        </form>
        <div className="footnote"><span>● Backend-verified formulas</span><span>Enter to send · Shift + Enter for new line</span><span>Estimates only</span></div>
      </footer>
    </div>
  );
}
