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
 * Ensure CR patient link cache table exists
 */
export async function ensureCrPatientLinksTable(): Promise<void> {
  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cr_patient_links (
      id BIGSERIAL PRIMARY KEY,
      impilo_uid TEXT,
      uid TEXT,
      cr_bundle_id TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS cr_patient_links_impilo_uid_idx
     ON cr_patient_links (impilo_uid)
     WHERE impilo_uid IS NOT NULL;`
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS cr_patient_links_uid_idx
     ON cr_patient_links (uid)
     WHERE uid IS NOT NULL;`
  );
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
