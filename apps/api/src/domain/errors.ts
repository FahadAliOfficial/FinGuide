export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly expose = true,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('VALIDATION_ERROR', message, 422, true, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super('NOT_FOUND', message, 404);
  }
}

export class UnsupportedRequestError extends AppError {
  constructor(message = 'Please ask for a compound interest or monthly loan payment calculation.') {
    super('UNSUPPORTED_REQUEST', message, 422);
  }
}

export class UpstreamError extends AppError {
  constructor(message = 'The AI service is temporarily unavailable. Please try again.', options?: ErrorOptions) {
    super('AI_SERVICE_ERROR', message, 503, true, options);
  }
}

