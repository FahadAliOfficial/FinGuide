import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { resolve } from 'node:path';
import type { ChatService } from './application/chat-service.js';
import { createChatRouter } from './routes/chat.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';
import { createLogger } from './infrastructure/logger.js';

export interface AppOptions {
  chatService: ChatService;
  corsOrigin: string;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  logLevel?: string;
  logger?: Logger;
  staticDir?: string;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  const logger = options.logger ?? createLogger(options.logLevel ?? 'info');
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestContext);
  app.use(pinoHttp({
    logger,
    serializers: { req: (request: { id?: string; method?: string; url?: string }) => ({ id: request.id, method: request.method, url: request.url }) }
  }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: options.corsOrigin, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'X-Request-Id'] }));
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use('/api', rateLimit({
    windowMs: options.rateLimitWindowMs,
    limit: options.rateLimitMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (request, response) => {
      request.log.warn({
        event: 'http.rate_limited',
        requestId: response.locals.requestId as string
      }, 'request rate limited');
      response.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.', requestId: response.locals.requestId as string }
      });
    }
  }));

  app.get('/health', (_request, response) => response.json({ status: 'ok' }));
  app.use('/api/v1', createChatRouter(options.chatService));
  if (options.staticDir) {
    const indexPath = resolve(options.staticDir, 'index.html');
    app.use(express.static(options.staticDir, { index: false, maxAge: '1h' }));
    app.use((request, response, next) => {
      if (request.method === 'GET' && request.accepts('html')) {
        response.sendFile(indexPath);
        return;
      }
      next();
    });
  }
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
