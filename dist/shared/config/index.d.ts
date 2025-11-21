/**
 * Configuration Management
 * Centralized configuration with validation using Zod
 */
import { z } from 'zod';
declare const ConfigSchema: z.ZodObject<{
    nodeEnv: z.ZodDefault<z.ZodEnum<["development", "production", "test"]>>;
    database: z.ZodObject<{
        host: z.ZodString;
        port: z.ZodNumber;
        name: z.ZodString;
        user: z.ZodString;
        password: z.ZodOptional<z.ZodString>;
        ssl: z.ZodDefault<z.ZodBoolean>;
        sourceTable: z.ZodDefault<z.ZodString>;
        watermarkStart: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        host: string;
        port: number;
        name: string;
        user: string;
        ssl: boolean;
        sourceTable: string;
        watermarkStart: string;
        password?: string | undefined;
    }, {
        host: string;
        port: number;
        name: string;
        user: string;
        password?: string | undefined;
        ssl?: boolean | undefined;
        sourceTable?: string | undefined;
        watermarkStart?: string | undefined;
    }>;
    source: z.ZodObject<{
        id: z.ZodString;
        facilityId: z.ZodString;
        facilityName: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        facilityId: string;
        facilityName: string;
    }, {
        id: string;
        facilityId: string;
        facilityName: string;
    }>;
    openhim: z.ZodObject<{
        baseUrl: z.ZodString;
        username: z.ZodString;
        password: z.ZodString;
        channelPath: z.ZodString;
        clientId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        password: string;
        baseUrl: string;
        username: string;
        channelPath: string;
        clientId?: string | undefined;
    }, {
        password: string;
        baseUrl: string;
        username: string;
        channelPath: string;
        clientId?: string | undefined;
    }>;
    queue: z.ZodObject<{
        host: z.ZodDefault<z.ZodString>;
        port: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        host: string;
        port: number;
    }, {
        host?: string | undefined;
        port?: number | undefined;
    }>;
    logging: z.ZodObject<{
        level: z.ZodDefault<z.ZodEnum<["trace", "debug", "info", "warn", "error", "fatal"]>>;
    }, "strip", z.ZodTypeAny, {
        level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
    }, {
        level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | undefined;
    }>;
    security: z.ZodObject<{
        encryptionKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        encryptionKey: string;
    }, {
        encryptionKey: string;
    }>;
    retry: z.ZodObject<{
        maxAttempts: z.ZodDefault<z.ZodNumber>;
        backoffMs: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        maxAttempts: number;
        backoffMs: number;
    }, {
        maxAttempts?: number | undefined;
        backoffMs?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    nodeEnv: "development" | "production" | "test";
    database: {
        host: string;
        port: number;
        name: string;
        user: string;
        ssl: boolean;
        sourceTable: string;
        watermarkStart: string;
        password?: string | undefined;
    };
    source: {
        id: string;
        facilityId: string;
        facilityName: string;
    };
    openhim: {
        password: string;
        baseUrl: string;
        username: string;
        channelPath: string;
        clientId?: string | undefined;
    };
    queue: {
        host: string;
        port: number;
    };
    logging: {
        level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
    };
    security: {
        encryptionKey: string;
    };
    retry: {
        maxAttempts: number;
        backoffMs: number;
    };
}, {
    database: {
        host: string;
        port: number;
        name: string;
        user: string;
        password?: string | undefined;
        ssl?: boolean | undefined;
        sourceTable?: string | undefined;
        watermarkStart?: string | undefined;
    };
    source: {
        id: string;
        facilityId: string;
        facilityName: string;
    };
    openhim: {
        password: string;
        baseUrl: string;
        username: string;
        channelPath: string;
        clientId?: string | undefined;
    };
    queue: {
        host?: string | undefined;
        port?: number | undefined;
    };
    logging: {
        level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | undefined;
    };
    security: {
        encryptionKey: string;
    };
    retry: {
        maxAttempts?: number | undefined;
        backoffMs?: number | undefined;
    };
    nodeEnv?: "development" | "production" | "test" | undefined;
}>;
export type Config = z.infer<typeof ConfigSchema>;
/**
 * Load and validate configuration from environment variables
 */
export declare function loadConfig(): Config;
/**
 * Get the configuration instance
 */
export declare function getConfig(): Config;
export {};
//# sourceMappingURL=index.d.ts.map