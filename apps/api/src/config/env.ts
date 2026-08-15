import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

dotenv.config({ path: resolve(import.meta.dirname, '../../../../.env'), quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(30),
  MAX_HISTORY_MESSAGES: z.coerce.number().int().min(2).max(50).default(12),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
}

export const env = parsed.data;
