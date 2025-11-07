/**
 * Configuration Management
 * Centralized configuration with validation using Zod
 */

import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenvConfig();

const ConfigSchema = z.object({
  // Environment
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // Database Configuration
  database: z.object({
    host: z.string(),
    port: z.number().int().positive(),
    name: z.string(),
    user: z.string(),
    password: z.string().optional(), // Optional - uses .pgpass if not provided
    ssl: z.boolean().default(false),
    sourceTable: z.string().default('sessions'),
    watermarkStart: z.string().default('1970-01-01 00:00:00'),
  }),

  // Source Identification
  source: z.object({
    id: z.string(),
    facilityId: z.string(),
    facilityName: z.string(),
  }),

  // OpenHIM Configuration
  openhim: z.object({
    baseUrl: z.string().url(),
    username: z.string(),
    password: z.string(),
    channelPath: z.string(),
    clientId: z.string().optional(),
  }),

  // Queue Configuration (for internal communication)
  queue: z.object({
    host: z.string().default('localhost'),
    port: z.number().int().positive().default(6379),
  }),

  // Logging
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  }),

  // Security
  security: z.object({
    encryptionKey: z.string().length(32),
  }),

  // Retry Configuration
  retry: z.object({
    maxAttempts: z.number().int().positive().default(3),
    backoffMs: z.number().int().positive().default(1000),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): Config {
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
  } catch (error) {
    if (error instanceof z.ZodError) {
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
let configInstance: Config | null = null;

/**
 * Get the configuration instance
 */
export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}
