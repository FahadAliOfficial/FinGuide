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

  if (error instanceof AppError) {
    const context = {
      event: 'http.request_failed',
      requestId,
      errorCode: error.code,
      status: error.status
    };
    if (error.status >= 500) {
      request.log.error({ ...context, err: error }, 'request failed');
    } else {
      request.log.warn(context, 'request rejected');
    }
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
    request.log.warn({
      event: 'http.validation_failed',
      requestId,
      errorCode: 'INVALID_REQUEST',
      status: 400,
      issues: error.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.') }))
    }, 'request validation failed');
    response.status(400).json({
      error: { code: 'INVALID_REQUEST', message: error.issues[0]?.message ?? 'Invalid request.', requestId }
    });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    request.log.warn({ event: 'http.invalid_json', requestId, errorCode: 'INVALID_JSON', status: 400 }, 'invalid JSON body');
    response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.', requestId } });
    return;
  }
  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
    request.log.warn({
      event: 'http.payload_too_large',
      requestId,
      errorCode: 'PAYLOAD_TOO_LARGE',
      status: 413
    }, 'request payload too large');
    response.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.', requestId }
    });
    return;
  }
  request.log.error({
    event: 'http.unexpected_error',
    requestId,
    errorCode: 'INTERNAL_ERROR',
    status: 500,
    err: error
  }, 'unexpected request failure');
  response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId }
  });
};
