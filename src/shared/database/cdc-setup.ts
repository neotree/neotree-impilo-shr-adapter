/**
 * Ensures CDC (Change Data Capture) database artifacts exist at runtime.
 * This eliminates the need to run scripts/setup-database.sh manually when
 * deploying to a fresh environment.
 */

import { getPool } from './pool';
import { getConfig } from '../config';
import { getLogger } from '../utils/logger';

const logger = getLogger('cdc-setup');

export async function ensureCdcSetup(): Promise<void> {
  const config = getConfig();
  const pool = getPool();
  const sourceTable = config.database.sourceTable;
  const watermarkStart = config.database.watermarkStart;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Watermark tracking table and seed row
    await client.query(`
      CREATE TABLE IF NOT EXISTS cdc_watermark (
        table_name TEXT PRIMARY KEY,
        last_ingested_at TIMESTAMP NOT NULL DEFAULT '1970-01-01 00:00:00',
        last_processed_id BIGINT,
        records_processed BIGINT DEFAULT 0,
        last_error TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(
      `
      INSERT INTO cdc_watermark (table_name, last_ingested_at)
      VALUES ($1, $2)
      ON CONFLICT (table_name) DO NOTHING;
      `,
      [sourceTable, watermarkStart]
    );

    // Failed records table for retry workflow
    await client.query(`
      CREATE TABLE IF NOT EXISTS cdc_failed_records (
        id SERIAL PRIMARY KEY,
        session_id BIGINT NOT NULL UNIQUE,
        ingested_at TIMESTAMP NOT NULL,
        attempt_count INTEGER DEFAULT 0,
        last_error TEXT,
        last_attempt_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        impilo_uid UUID,
        impilo_id TEXT,
        data TEXT NOT NULL,
        synced BOOLEAN DEFAULT FALSE,
        cr_synced BOOLEAN DEFAULT FALSE,
        shr_synced BOOLEAN DEFAULT FALSE
      );
    `);

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_cdc_failed_records_attempt ON cdc_failed_records(last_attempt_at);`
    );

    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_cdc_failed_records_session_id ON cdc_failed_records(session_id);`
    );

    // Functions used by the polling service
    const getNewSessionsFn = `
    CREATE OR REPLACE FUNCTION get_new_sessions(batch_size INTEGER DEFAULT 100)
    RETURNS TABLE(
      id BIGINT,
      ingested_at TIMESTAMP,
      session_time TIMESTAMP,
      impilo_uid UUID,
      impilo_id TEXT,
      data TEXT
    ) AS $$
    DECLARE
      last_watermark TIMESTAMP;
      table_name_var TEXT;
      time_col TEXT;
      uid_col TEXT;
    BEGIN
      SELECT w.last_ingested_at, w.table_name INTO last_watermark, table_name_var
      FROM cdc_watermark w
      LIMIT 1;

      IF table_name_var IS NULL THEN
        RAISE EXCEPTION 'No watermark found in cdc_watermark table';
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = table_name_var AND column_name = 'time'
      ) THEN
        time_col := 's.time';
      ELSE
        time_col := 's.ingested_at';
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = table_name_var AND column_name = 'impilo_uid'
      ) THEN
        uid_col := 's.impilo_uid';
      ELSE
        uid_col := 'NULL::UUID';
      END IF;

      RETURN QUERY EXECUTE format(
        'SELECT
          s.id::BIGINT,
          s.ingested_at,
          %s as session_time,
          %s as impilo_uid,
          s.impilo_id,
          s.data
        FROM %I s
        WHERE s.ingested_at > $1
        ORDER BY s.ingested_at ASC, s.id ASC
        LIMIT $2',
        time_col, uid_col, table_name_var
      ) USING last_watermark, batch_size;
    END;
    $$ LANGUAGE plpgsql;
    `;

    await client.query(getNewSessionsFn);

    const updateWatermarkFn = `
    CREATE OR REPLACE FUNCTION update_watermark(
      p_table_name TEXT,
      p_last_ingested_at TIMESTAMP,
      p_last_processed_id BIGINT,
      p_records_count INTEGER
    )
    RETURNS VOID AS $$
    BEGIN
      UPDATE cdc_watermark
      SET
        last_ingested_at = p_last_ingested_at,
        last_processed_id = p_last_processed_id,
        records_processed = records_processed + p_records_count,
        updated_at = NOW(),
        last_error = NULL
      WHERE table_name = p_table_name;
    END;
    $$ LANGUAGE plpgsql;
    `;
    await client.query(updateWatermarkFn);

    const recordFailedFn = `
    CREATE OR REPLACE FUNCTION record_failed_session(
      p_session_id BIGINT,
      p_ingested_at TIMESTAMP,
      p_error TEXT,
      p_impilo_id TEXT,
      p_data TEXT,
      p_synced BOOLEAN DEFAULT FALSE,
      p_cr_synced BOOLEAN DEFAULT FALSE,
      p_shr_synced BOOLEAN DEFAULT FALSE,
      p_impilo_uid UUID DEFAULT NULL
    )
    RETURNS VOID AS $$
    BEGIN
      INSERT INTO cdc_failed_records (
        session_id,
        ingested_at,
        last_error,
        impilo_id,
        data,
        synced,
        cr_synced,
        shr_synced,
        impilo_uid,
        created_at,
        last_attempt_at,
        attempt_count
      )
      VALUES (
        p_session_id,
        p_ingested_at,
        p_error,
        p_impilo_id,
        p_data,
        p_synced,
        p_cr_synced,
        p_shr_synced,
        p_impilo_uid,
        NOW(),
        NOW(),
        1
      )
      ON CONFLICT (session_id)
      DO UPDATE SET
        last_error = EXCLUDED.last_error,
        last_attempt_at = NOW(),
        attempt_count = cdc_failed_records.attempt_count + 1,
        synced = EXCLUDED.synced,
        cr_synced = EXCLUDED.cr_synced,
        shr_synced = EXCLUDED.shr_synced,
        impilo_uid = COALESCE(EXCLUDED.impilo_uid, cdc_failed_records.impilo_uid);
    END;
    $$ LANGUAGE plpgsql;
    `;
    await client.query(recordFailedFn);

    const getFailedFn = `
    CREATE OR REPLACE FUNCTION get_failed_sessions_for_retry(batch_size INTEGER DEFAULT 50)
    RETURNS TABLE(
      id INTEGER,
      session_id BIGINT,
      ingested_at TIMESTAMP,
      attempt_count INTEGER,
      last_error TEXT,
      impilo_uid UUID,
      impilo_id TEXT,
      data TEXT,
      synced BOOLEAN,
      cr_synced BOOLEAN,
      shr_synced BOOLEAN
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        f.id,
        f.session_id,
        f.ingested_at,
        f.attempt_count,
        f.last_error,
        f.impilo_uid,
        f.impilo_id,
        f.data,
        f.synced,
        f.cr_synced,
        f.shr_synced
      FROM cdc_failed_records f
      WHERE f.synced = FALSE
        AND (f.last_attempt_at IS NULL
         OR f.last_attempt_at < NOW() - INTERVAL '5 minutes')
      ORDER BY f.created_at ASC
      LIMIT batch_size;
    END;
    $$ LANGUAGE plpgsql;
    `;
    await client.query(getFailedFn);

    const removeFailedFn = `
    CREATE OR REPLACE FUNCTION remove_failed_session(p_id INTEGER)
    RETURNS VOID AS $$
    BEGIN
      DELETE FROM cdc_failed_records WHERE id = p_id;
    END;
    $$ LANGUAGE plpgsql;
    `;
    await client.query(removeFailedFn);

    const updateFailedFn = `
    CREATE OR REPLACE FUNCTION update_failed_session_retry(
      p_id INTEGER,
      p_error TEXT,
      p_synced BOOLEAN DEFAULT FALSE,
      p_cr_synced BOOLEAN DEFAULT FALSE,
      p_shr_synced BOOLEAN DEFAULT FALSE
    )
    RETURNS VOID AS $$
    BEGIN
      UPDATE cdc_failed_records
      SET
        last_error = p_error,
        last_attempt_at = NOW(),
        attempt_count = attempt_count + 1,
        synced = p_synced,
        cr_synced = p_cr_synced,
        shr_synced = p_shr_synced
      WHERE id = p_id;
    END;
    $$ LANGUAGE plpgsql;
    `;
    await client.query(updateFailedFn);

    await client.query('COMMIT');
    logger.info({ sourceTable, watermarkStart }, 'CDC database artifacts ensured');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Failed to ensure CDC database artifacts');
    throw error;
  } finally {
    client.release();
  }
}
