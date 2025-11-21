"use strict";
/**
 * Configuration Management
 * Centralized configuration with validation using Zod
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.getConfig = getConfig;
const dotenv_1 = require("dotenv");
const zod_1 = require("zod");
// Load environment variables
(0, dotenv_1.config)();
const ConfigSchema = zod_1.z.object({
    // Environment
    nodeEnv: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    // Database Configuration
    database: zod_1.z.object({
        host: zod_1.z.string(),
        port: zod_1.z.number().int().positive(),
        name: zod_1.z.string(),
        user: zod_1.z.string(),
        password: zod_1.z.string().optional(), // Optional - uses .pgpass if not provided
        ssl: zod_1.z.boolean().default(false),
        sourceTable: zod_1.z.string().default('sessions'),
        watermarkStart: zod_1.z.string().default('1970-01-01 00:00:00'),
    }),
    // Source Identification
    source: zod_1.z.object({
        id: zod_1.z.string(),
        facilityId: zod_1.z.string(),
        facilityName: zod_1.z.string(),
    }),
    // OpenHIM Configuration
    openhim: zod_1.z.object({
        baseUrl: zod_1.z.string().url(),
        username: zod_1.z.string(),
        password: zod_1.z.string(),
        channelPath: zod_1.z.string(),
        clientId: zod_1.z.string().optional(),
    }),
    // Queue Configuration (for internal communication)
    queue: zod_1.z.object({
        host: zod_1.z.string().default('localhost'),
        port: zod_1.z.number().int().positive().default(6379),
    }),
    // Logging
    logging: zod_1.z.object({
        level: zod_1.z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    }),
    // Security
    security: zod_1.z.object({
        encryptionKey: zod_1.z.string().length(32),
    }),
    // Retry Configuration
    retry: zod_1.z.object({
        maxAttempts: zod_1.z.number().int().positive().default(3),
        backoffMs: zod_1.z.number().int().positive().default(1000),
    }),
});
/**
 * Load and validate configuration from environment variables
 */
function loadConfig() {
    const rawConfig = {
        nodeEnv: process.env.NODE_ENV || 'production',
        database: {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432', 10),
            name: process.env.DB_NAME || 'neotree',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD, // Optional - uses .pgpass if not set
            ssl: process.env.DB_SSL === 'true',
            sourceTable: process.env.DB_SOURCE_TABLE || 'sessions',
            watermarkStart: process.env.DB_WATERMARK_START || '1970-01-01 00:00:00',
        },
        source: {
            id: process.env.SOURCE_ID,
            facilityId: process.env.FACILITY_ID,
            facilityName: process.env.FACILITY_NAME,
        },
        openhim: {
            baseUrl: process.env.OPENHIM_BASE_URL,
            username: process.env.OPENHIM_USERNAME,
            password: process.env.OPENHIM_PASSWORD,
            channelPath: process.env.OPENHIM_CHANNEL_PATH || '/fhir',
            clientId: process.env.OPENHIM_CLIENT_ID || process.env.FACILITY_ID || process.env.SOURCE_ID,
        },
        queue: {
            host: process.env.QUEUE_HOST || 'localhost',
            port: parseInt(process.env.QUEUE_PORT || '6379', 10),
        },
        logging: {
            level: process.env.LOG_LEVEL || 'info',
        },
        security: {
            encryptionKey: process.env.ENCRYPTION_KEY || 'CHANGE_THIS_TO_32_CHAR_STRING!',
        },
        retry: {
            maxAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3', 10),
            backoffMs: parseInt(process.env.RETRY_BACKOFF_MS || '1000', 10),
        },
    };
    try {
        return ConfigSchema.parse(rawConfig);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            // eslint-disable-next-line no-console
            console.error('Configuration validation failed:');
            error.errors.forEach((err) => {
                // eslint-disable-next-line no-console
                console.error(`  - ${err.path.join('.')}: ${err.message}`);
            });
            throw new Error('Invalid configuration. Please check your environment variables.');
        }
        throw error;
    }
}
// Singleton instance
let configInstance = null;
/**
 * Get the configuration instance
 */
function getConfig() {
    if (!configInstance) {
        configInstance = loadConfig();
    }
    return configInstance;
}
//# sourceMappingURL=index.js.map