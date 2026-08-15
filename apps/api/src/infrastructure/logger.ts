import pino, { type DestinationStream, type Logger } from 'pino';

const redactedPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'cookie',
  'apiKey',
  'OPENAI_API_KEY',
  '*.apiKey',
  '*.OPENAI_API_KEY'
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: 'finguide-api' },
    redact: { paths: redactedPaths, censor: '[REDACTED]' }
  };
  return destination ? pino(options, destination) : pino(options);
}
