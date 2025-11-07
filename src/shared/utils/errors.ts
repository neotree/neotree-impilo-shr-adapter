/**
 * Custom Error Classes
 * Standardized error handling for the adapter
 */

export class AdapterError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'AdapterError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AdapterError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'VALIDATION_ERROR', 400, context);
    this.name = 'ValidationError';
  }
}

export class TransformationError extends AdapterError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'TRANSFORMATION_ERROR', 422, context);
    this.name = 'TransformationError';
  }
}

export class OpenHIMError extends AdapterError {
  constructor(message: string, statusCode: number = 500, context?: Record<string, any>) {
    super(message, 'OPENHIM_ERROR', statusCode, context);
    this.name = 'OpenHIMError';
  }
}

export class DatabaseError extends AdapterError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'DATABASE_ERROR', 500, context);
    this.name = 'DatabaseError';
  }
}

export class ConfigurationError extends AdapterError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'CONFIGURATION_ERROR', 500, context);
    this.name = 'ConfigurationError';
  }
}

/**
 * Error handler utility
 */
export function handleError(error: unknown, logger: any, context?: Record<string, any>): AdapterError {
  if (error instanceof AdapterError) {
    logger.error(
      {
        error: {
          name: error.name,
          message: error.message,
          code: error.code,
          statusCode: error.statusCode,
          context: { ...error.context, ...context },
        },
      },
      'Adapter error occurred'
    );
    return error;
  }

  if (error instanceof Error) {
    logger.error(
      {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
          context,
        },
      },
      'Unexpected error occurred'
    );
    return new AdapterError(error.message, 'UNKNOWN_ERROR', 500, context);
  }

  logger.error(
    {
      error: String(error),
      context,
    },
    'Unknown error occurred'
  );
  return new AdapterError('An unknown error occurred', 'UNKNOWN_ERROR', 500, context);
}
