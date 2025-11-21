/**
 * PostgreSQL Connection Pool
 * Manages database connections with support for .pgpass authentication
 */
import { Pool } from 'pg';
/**
 * Get or create the database connection pool
 */
export declare function getPool(): Pool;
/**
 * Test database connectivity
 */
export declare function testConnection(): Promise<boolean>;
/**
 * Close the database connection pool
 */
export declare function closePool(): Promise<void>;
//# sourceMappingURL=pool.d.ts.map