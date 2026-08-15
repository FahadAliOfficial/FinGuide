import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { ChatService } from './application/chat-service.js';
import { FinancialToolExecutor, toolNames } from './application/tool-executor.js';
import { FakeConversationalLlm, FakeLlm, InMemoryConversations, fakeProducts } from './test/fakes.js';
import { chatResponseSchema, conversationListResponseSchema, errorResponseSchema } from '@finguide/contracts';
import type { DestinationStream, Logger } from 'pino';
import { createLogger } from './infrastructure/logger.js';

function testApp(logger?: Logger) {
  const service = new ChatService(
    new InMemoryConversations(),
    new FakeLlm({ name: toolNames.loanPayment, arguments: { principal: 300_000, annualRate: null, termYears: 30, productName: 'Home Loan' } }),
    new FinancialToolExecutor(fakeProducts),
    12
  );
  return createApp({
    chatService: service,
    corsOrigin: 'http://localhost:5173',
    rateLimitMax: 100,
    rateLimitWindowMs: 60_000,
    logLevel: 'silent',
    ...(logger ? { logger } : {})
  });
}

describe('HTTP API', () => {
  it('returns a backend-verified calculation and security headers', async () => {
    const response = await request(testApp()).post('/api/v1/chat').set('X-Request-Id', 'request-123').send({
      message: 'Calculate a $300,000 Home Loan over 30 years using the stored rate.'
    }).expect(200);
    expect(response.headers['x-request-id']).toBe('request-123');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    const body = chatResponseSchema.parse(response.body);
    expect(body.calculation).toMatchObject({ result: '1896.20', product: { name: 'Home Loan' } });
  });

  it('rejects unknown fields and empty messages', async () => {
    const response = await request(testApp()).post('/api/v1/chat').send({ message: '', admin: true }).expect(400);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('INVALID_REQUEST');
  });

  it('rejects oversized JSON bodies', async () => {
    const response = await request(testApp()).post('/api/v1/chat').send({ message: 'a'.repeat(20_000) }).expect(413);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('does not expose stack traces for malformed JSON', async () => {
    const response = await request(testApp()).post('/api/v1/chat').set('Content-Type', 'application/json').send('{').expect(400);
    expect(errorResponseSchema.parse(response.body).error).toMatchObject({ code: 'INVALID_JSON', message: 'Request body must be valid JSON.' });
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });

  it('returns a successful conversational response when no calculation is requested', async () => {
    const service = new ChatService(
      new InMemoryConversations(),
      new FakeConversationalLlm('Hello! I can help with compound interest and loan payments.'),
      new FinancialToolExecutor(fakeProducts),
      12
    );
    const app = createApp({ chatService: service, corsOrigin: 'http://localhost:5173', rateLimitMax: 100, rateLimitWindowMs: 60_000, logLevel: 'silent' });

    const response = await request(app).post('/api/v1/chat').send({ message: 'Hello, how are you?' }).expect(200);
    const body = chatResponseSchema.parse(response.body);
    expect(body.calculation).toBeNull();
    expect(body.message.content).toContain('Hello!');
  });

  it('lists stored conversations for the history panel', async () => {
    const app = testApp();
    await request(app).post('/api/v1/chat').send({ message: 'Calculate a Home Loan payment.' }).expect(200);

    const response = await request(app).get('/api/v1/conversations?limit=10').expect(200);
    const body = conversationListResponseSchema.parse(response.body);
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0]).toMatchObject({
      title: 'Calculate a Home Loan payment.',
      messageCount: 2
    });
  });

  it('uses the response correlation ID in structured HTTP logs', async () => {
    const lines: string[] = [];
    const destination: DestinationStream = { write: (message) => { lines.push(message); } };
    const logger = createLogger('info', destination);

    await request(testApp(logger)).get('/health').set('X-Request-Id', 'diagnostic-request-1').expect(200);

    const entries = lines.map((line) => JSON.parse(line) as { req?: { id?: string }; msg?: string });
    const completed = entries.find((entry) => entry.msg === 'request completed');
    expect(completed?.req?.id).toBe('diagnostic-request-1');
  });
});
