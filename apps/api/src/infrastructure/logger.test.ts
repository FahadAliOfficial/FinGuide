import type { DestinationStream } from 'pino';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('diagnostic logger', () => {
  it('emits structured JSON and redacts secrets', () => {
    const lines: string[] = [];
    const destination: DestinationStream = {
      write: (message) => { lines.push(message); }
    };
    const logger = createLogger('info', destination);

    logger.info({
      event: 'security.test',
      apiKey: 'secret-api-key',
      req: { headers: { authorization: 'Bearer secret-token', cookie: 'session=secret' } }
    }, 'redaction test');

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 30,
      service: 'finguide-api',
      event: 'security.test',
      apiKey: '[REDACTED]',
      msg: 'redaction test'
    });
    expect(JSON.stringify(entry)).not.toContain('secret-api-key');
    expect(JSON.stringify(entry)).not.toContain('secret-token');
    expect(JSON.stringify(entry)).not.toContain('session=secret');
  });
});
