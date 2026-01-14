-- CDC (Change Data Capture) Setup for Neotree FHIR Adapter
-- Uses watermark-based polling instead of triggers
-- More reliable and doesn't block database operations
--
-- USAGE:
-- Set the source table name before running this script:
--   psql -v source_table=sessions -v watermark_start="'1970-01-01 00:00:00'" -f setup-cdc.sql
--
-- Or from the setup script:
--   ./scripts/setup-database.sh
--
-- Default values if not specified:
\set source_table :source_table
\set watermark_start :watermark_start

-- Watermark tracking table
CREATE TABLE IF NOT EXISTS cdc_watermark (
  table_name TEXT PRIMARY KEY,
  last_ingested_at TIMESTAMP NOT NULL DEFAULT '1970-01-01 00:00:00',
  last_processed_id BIGINT,
  records_processed BIGINT DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Initialize watermark for source table
INSERT INTO cdc_watermark (table_name, last_ingested_at)
VALUES (:'source_table', :'watermark_start')
ON CONFLICT (table_name) DO NOTHING;

-- Failed records tracking (separate from CDC flow)
-- Failed records don't block new data processing
-- Both impilo_id and data are stored as AES-256 encrypted text (iv:encrypted_value format)
DROP TABLE IF EXISTS cdc_failed_records CASCADE;
CREATE TABLE cdc_failed_records (
  id SERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL UNIQUE,
  ingested_at TIMESTAMP NOT NULL,
  attempt_count INTEGER DEFAULT 0,
  last_error TEXT,
  last_attempt_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  impilo_uid UUID,
  impilo_id TEXT,  -- AES-256 encrypted (iv:encrypted_value format)
  data TEXT NOT NULL,  -- AES-256 encrypted JSON string
  synced BOOLEAN DEFAULT FALSE,  -- Set to true after BOTH CR and SHR successful
  cr_synced BOOLEAN DEFAULT FALSE, -- Phase 1: Client Registry
  shr_synced BOOLEAN DEFAULT FALSE -- Phase 2: Shared Health Record
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cdc_failed_records_attempt
  ON cdc_failed_records(last_attempt_at);

-- Create index on source table using psql meta-command
-- Note: This requires the table to already exist
\set index_sql 'CREATE INDEX IF NOT EXISTS idx_' :source_table '_ingested_at ON ' :source_table '(ingested_at);'
:index_sql

-- Function to get new sessions since last watermark
-- This function is generic and uses the table name from watermark tracking
-- It reads the first (and should be only) entry from cdc_watermark
-- Uses the original 'time' column from sessions table as timestamp
CREATE OR REPLACE FUNCTION get_new_sessions(batch_size INTEGER DEFAULT 100)
RETURNS TABLE(
  id BIGINT,
  ingested_at TIMESTAMP,
  session_time TIMESTAMP,
  impilo_uid UUID,
  data JSONB
) AS $$
DECLARE
  last_watermark TIMESTAMP;
  table_name_var TEXT;
  time_col TEXT;
  uid_col TEXT;
BEGIN
  -- Get current watermark and table name (use the first entry in watermark table)
  SELECT w.last_ingested_at, w.table_name INTO last_watermark, table_name_var
  FROM cdc_watermark w
  LIMIT 1;

  IF table_name_var IS NULL THEN
    RAISE EXCEPTION 'No watermark found in cdc_watermark table';
  END IF;

  -- Check for column existence once
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

  -- Return new sessions since watermark using dynamic SQL construction
  RETURN QUERY EXECUTE format(
    'SELECT
      s.id::BIGINT,
      s.ingested_at,
      %s as session_time,
      %s as impilo_uid,
      s.data
    FROM %I s
    WHERE s.ingested_at > $1
    ORDER BY s.ingested_at ASC, s.id ASC
    LIMIT $2',
    time_col, uid_col, table_name_var
  ) USING last_watermark, batch_size;
END;
$$ LANGUAGE plpgsql;

-- Function to update watermark after successful batch processing
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

-- Function to record failed record with encrypted data and impilo_id
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

  -- Add unique constraint if it doesn't exist
  -- This is handled by adding a unique index
END;
$$ LANGUAGE plpgsql;

-- Add unique constraint to failed records
CREATE UNIQUE INDEX IF NOT EXISTS idx_cdc_failed_records_session_id
  ON cdc_failed_records(session_id);

-- Function to get failed records ready for retry
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
  -- Get failed records that haven't been tried in last 5 minutes and not yet fully synced
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

-- Function to remove successfully retried record
CREATE OR REPLACE FUNCTION remove_failed_session(p_id INTEGER)
RETURNS VOID AS $$
BEGIN
  DELETE FROM cdc_failed_records WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update failed record after retry or successful sync
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

-- Function to reset watermark (for backfilling or reprocessing)
CREATE OR REPLACE FUNCTION reset_watermark(
  p_table_name TEXT,
  p_timestamp TIMESTAMP DEFAULT '1970-01-01 00:00:00'
)
RETURNS VOID AS $$
BEGIN
  UPDATE cdc_watermark
  SET
    last_ingested_at = p_timestamp,
    last_processed_id = NULL,
    updated_at = NOW()
  WHERE table_name = p_table_name;

  RAISE NOTICE 'Watermark reset for % to %', p_table_name, p_timestamp;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON cdc_watermark TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON cdc_failed_records TO PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE cdc_failed_records_id_seq TO PUBLIC;

-- Success message with table and watermark info
DO $$
DECLARE
    v_table_name TEXT;
    v_last_ingested_at TIMESTAMP;
BEGIN
    SELECT table_name, last_ingested_at INTO v_table_name, v_last_ingested_at FROM cdc_watermark LIMIT 1;
    
    RAISE NOTICE '✓ CDC watermark tracking created';
    RAISE NOTICE '✓ Failed records table created';
    RAISE NOTICE '✓ CDC functions installed';
    RAISE NOTICE '';
    RAISE NOTICE 'CDC System Ready:';
    RAISE NOTICE '  • Watermark initialized for % table', v_table_name;
    RAISE NOTICE '  • Starting from: %', to_char(v_last_ingested_at, 'YYYY-MM-DD HH24:MI:SS');
    RAISE NOTICE '  • Failed records are tracked separately';
    RAISE NOTICE '  • Adapter will poll for new sessions every 30 seconds';
    RAISE NOTICE '  • Failed retries every 5 minutes automatically';
    RAISE NOTICE '';
    RAISE NOTICE 'Monitoring:';
    RAISE NOTICE '  • Check watermark: SELECT * FROM cdc_watermark;';
    RAISE NOTICE '  • Check failed: SELECT * FROM cdc_failed_records;';
    RAISE NOTICE '  • Reset watermark: SELECT reset_watermark(''%'', ''2024-01-01'');', v_table_name;
END $$;
