import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../domain/errors.js';

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found.', requestId: response.locals.requestId as string }
  });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  const requestId = response.locals.requestId as string;
  request.log.error({ err: error, requestId }, 'request failed');

  if (error instanceof AppError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.expose ? error.message : 'An unexpected error occurred.',
        requestId
      }
    });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({
      error: { code: 'INVALID_REQUEST', message: error.issues[0]?.message ?? 'Invalid request.', requestId }
    });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.', requestId } });
    return;
  }
  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
    response.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.', requestId }
    });
    return;
  }
  response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId }
  });
};
