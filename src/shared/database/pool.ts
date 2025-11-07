/**
 * PostgreSQL Connection Pool
 * Manages database connections with support for .pgpass authentication
 */

import { Pool, PoolConfig } from 'pg';
import { getConfig } from '../config';
import { getLogger } from '../utils/logger';

const logger = getLogger('database-pool');

let pool: Pool | null = null;

/**
 * Get or create the database connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    const config = getConfig();

    const poolConfig: PoolConfig = {
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

    pool = new Pool(poolConfig);

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

    logger.info(
      {
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
        usingPgpass: !config.database.password,
      },
      'Database connection pool initialized'
    );
  }

  return pool;
}

/**
 * Test database connectivity
 */
export async function testConnection(): Promise<boolean> {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT NOW() as now, version() as version');
    logger.info(
      {
        timestamp: result.rows[0].now,
        version: result.rows[0].version.split(',')[0],
      },
      'Database connection test successful'
    );
    return true;
  } catch (error) {
    logger.error({ error }, 'Database connection test failed');
    return false;
  }
}

/**
 * Close the database connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database connection pool closed');
  }
}
