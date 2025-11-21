"use strict";
/**
 * PostgreSQL Connection Pool
 * Manages database connections with support for .pgpass authentication
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPool = getPool;
exports.testConnection = testConnection;
exports.closePool = closePool;
const pg_1 = require("pg");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const logger = (0, logger_1.getLogger)('database-pool');
let pool = null;
/**
 * Get or create the database connection pool
 */
function getPool() {
    if (!pool) {
        const config = (0, config_1.getConfig)();
        const poolConfig = {
            host: config.database.host,
            port: config.database.port,
            database: config.database.name,
            user: config.database.user,
            // Password is optional - will use .pgpass if not provided
            ...(config.database.password && { password: config.database.password }),
            ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
            max: 20, // Maximum pool size
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        };
        pool = new pg_1.Pool(poolConfig);
        // Handle pool errors
        pool.on('error', (err) => {
            logger.error({ error: err }, 'Unexpected database pool error');
        });
        // Log successful connection
        pool.on('connect', () => {
            logger.debug('New database client connected to pool');
        });
        // Log client removal
        pool.on('remove', () => {
            logger.debug('Database client removed from pool');
        });
        logger.info({
            host: config.database.host,
            port: config.database.port,
            database: config.database.name,
            user: config.database.user,
            usingPgpass: !config.database.password,
        }, 'Database connection pool initialized');
    }
    return pool;
}
/**
 * Test database connectivity
 */
async function testConnection() {
    try {
        const pool = getPool();
        const result = await pool.query('SELECT NOW() as now, version() as version');
        logger.info({
            timestamp: result.rows[0].now,
            version: result.rows[0].version.split(',')[0],
        }, 'Database connection test successful');
        return true;
    }
    catch (error) {
        logger.error({ error }, 'Database connection test failed');
        return false;
    }
}
/**
 * Close the database connection pool
 */
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
        logger.info('Database connection pool closed');
    }
}
//# sourceMappingURL=pool.js.map