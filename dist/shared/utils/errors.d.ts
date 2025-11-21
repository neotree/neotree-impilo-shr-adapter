/**
 * Custom Error Classes
 * Standardized error handling for the adapter
 */
export declare class AdapterError extends Error {
    code: string;
    statusCode: number;
    context?: Record<string, any> | undefined;
    constructor(message: string, code: string, statusCode?: number, context?: Record<string, any> | undefined);
}
export declare class ValidationError extends AdapterError {
    constructor(message: string, context?: Record<string, any>);
}
export declare class TransformationError extends AdapterError {
    constructor(message: string, context?: Record<string, any>);
}
export declare class OpenHIMError extends AdapterError {
    constructor(message: string, statusCode?: number, context?: Record<string, any>);
}
export declare class DatabaseError extends AdapterError {
    constructor(message: string, context?: Record<string, any>);
}
export declare class ConfigurationError extends AdapterError {
    constructor(message: string, context?: Record<string, any>);
}
/**
 * Error handler utility
 */
export declare function handleError(error: unknown, logger: any, context?: Record<string, any>): AdapterError;
//# sourceMappingURL=errors.d.ts.map