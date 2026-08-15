import { PrismaClient } from '@prisma/client';
import { env } from './config/env.js';
import { ChatService } from './application/chat-service.js';
import { FinancialToolExecutor } from './application/tool-executor.js';
import { OpenAiGateway } from './infrastructure/openai-gateway.js';
import { PrismaConversationRepository, PrismaProductRepository } from './infrastructure/prisma-repositories.js';
import { createApp } from './app.js';
import { resolve } from 'node:path';
import { createLogger } from './infrastructure/logger.js';

if (!env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required to start the API. Copy .env.example to .env and add a server-side key.');
}

const prisma = new PrismaClient();
const logger = createLogger(env.LOG_LEVEL);
const conversations = new PrismaConversationRepository(prisma);
const products = new PrismaProductRepository(prisma);
const tools = new FinancialToolExecutor(products);
const llm = new OpenAiGateway(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.OPENAI_TIMEOUT_MS, env.OPENAI_MAX_RETRIES);
const chat = new ChatService(conversations, llm, tools, env.MAX_HISTORY_MESSAGES, logger);
const app = createApp({
  chatService: chat,
  corsOrigin: env.CORS_ORIGIN,
  rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
  rateLimitMax: env.RATE_LIMIT_MAX,
  logLevel: env.LOG_LEVEL,
  logger,
  ...(env.NODE_ENV === 'production' ? { staticDir: resolve(process.cwd(), 'apps/web/dist') } : {})
});

const server = app.listen(env.PORT, () => {
  logger.info({ event: 'server.started', port: env.PORT, environment: env.NODE_ENV }, 'FinGuide API started');
});

function shutdown(signal: string): void {
  logger.info({ event: 'server.shutdown_started', signal }, 'server shutdown started');
  server.close(async () => {
    await prisma.$disconnect();
    logger.info({ event: 'server.shutdown_completed', signal }, 'server shutdown completed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
