"use strict";
/**
 * Custom Error Classes
 * Standardized error handling for the adapter
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigurationError = exports.DatabaseError = exports.OpenHIMError = exports.TransformationError = exports.ValidationError = exports.AdapterError = void 0;
exports.handleError = handleError;
class AdapterError extends Error {
    constructor(message, code, statusCode = 500, context) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.context = context;
        this.name = 'AdapterError';
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.AdapterError = AdapterError;
class ValidationError extends AdapterError {
    constructor(message, context) {
        super(message, 'VALIDATION_ERROR', 400, context);
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
class TransformationError extends AdapterError {
    constructor(message, context) {
        super(message, 'TRANSFORMATION_ERROR', 422, context);
        this.name = 'TransformationError';
    }
}
exports.TransformationError = TransformationError;
class OpenHIMError extends AdapterError {
    constructor(message, statusCode = 500, context) {
        super(message, 'OPENHIM_ERROR', statusCode, context);
        this.name = 'OpenHIMError';
    }
}
exports.OpenHIMError = OpenHIMError;
class DatabaseError extends AdapterError {
    constructor(message, context) {
        super(message, 'DATABASE_ERROR', 500, context);
        this.name = 'DatabaseError';
    }
}
exports.DatabaseError = DatabaseError;
class ConfigurationError extends AdapterError {
    constructor(message, context) {
        super(message, 'CONFIGURATION_ERROR', 500, context);
        this.name = 'ConfigurationError';
    }
}
exports.ConfigurationError = ConfigurationError;
/**
 * Error handler utility
 */
function handleError(error, logger, context) {
    if (error instanceof AdapterError) {
        logger.error({
            error: {
                name: error.name,
                message: error.message,
                code: error.code,
                statusCode: error.statusCode,
                context: { ...error.context, ...context },
            },
        }, 'Adapter error occurred');
        return error;
    }
    if (error instanceof Error) {
        logger.error({
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
                context,
            },
        }, 'Unexpected error occurred');
        return new AdapterError(error.message, 'UNKNOWN_ERROR', 500, context);
    }
    logger.error({
        error: String(error),
        context,
    }, 'Unknown error occurred');
    return new AdapterError('An unknown error occurred', 'UNKNOWN_ERROR', 500, context);
}
//# sourceMappingURL=errors.js.map