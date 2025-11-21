/**
 * CDC (Change Data Capture) Service
 * Polls database for new sessions using watermark tracking
 * Processes records in batches and handles failures separately
 * Uses node-cron for reliable scheduling
 */

import * as cron from 'node-cron';
import { getPool } from '../../shared/database/pool';
import { AdapterService } from './adapter-service';
import { getLogger } from '../../shared/utils/logger';
import { getConfig } from '../../shared/config';
import { NeotreeEntry } from '../../shared/types/neotree.types';

const logger = getLogger('cdc-service');

interface CDCRecord {
  id: string;
  ingested_at: Date;
  time: Date;  // Original timestamp from sessions table
  impilo_uid?: string;
  impilo_id?: string;
  data: Record<string, unknown>;
}

interface FailedRecord {
  id: number;
  session_id: string;
  ingested_at: Date;
  attempt_count: number;
  last_error: string | null;
  impilo_uid?: string;
  impilo_id?: string;
  data: Record<string, unknown>;
}

export class CDCService {
  private adapterService: AdapterService;
  private isPolling = false;
  private pollCronSchedule = '*/30 * * * * *'; // Every 30 seconds
  private retryCronSchedule = '*/5 * * * *'; // Every 5 minutes
  private pollTask: cron.ScheduledTask | null = null;
  private retryTask: cron.ScheduledTask | null = null;
  private batchSize = 100;
  private config = getConfig();

  constructor(adapterService: AdapterService) {
    this.adapterService = adapterService;
  }

  async start(): Promise<void> {
    if (this.isPolling) return;

    this.isPolling = true;

    const pool = getPool();
    try {
      await pool.query('SELECT 1');
    } catch (error) {
      logger.error('DB connection failed');
      throw error;
    }

    // Schedule polling task (every 30 seconds)
    this.pollTask = cron.schedule(this.pollCronSchedule, () => {
      void this.pollForNewSessions();
    });

    // Schedule retry task (every 5 minutes)
    this.retryTask = cron.schedule(this.retryCronSchedule, () => {
      void this.retryFailedSessions();
    });

    logger.info('CDC service started with cron scheduler - poll: 30s, retry: 5m');
  }

  /**
   * Stop CDC polling
   */
  async stop(): Promise<void> {
    this.isPolling = false;

    if (this.pollTask) {
      this.pollTask.stop();
      this.pollTask = null;
    }

    if (this.retryTask) {
      this.retryTask.stop();
      this.retryTask = null;
    }

    logger.info('CDC service stopped');
  }

  private async pollForNewSessions(): Promise<void> {
    if (!this.isPolling) return;

    try {
      const pool = getPool();
      const result = await pool.query<CDCRecord>(
        'SELECT * FROM get_new_sessions($1)',
        [this.batchSize]
      );

      if (result.rows.length > 0) {
        await this.processBatch(result.rows);
      }
    } catch (error) {
      logger.error({ error }, 'Polling error');
    }
  }

  private async processBatch(records: CDCRecord[]): Promise<void> {
    let successCount = 0;
    let failureCount = 0;

    for (const record of records) {
      try {
        const entry = this.convertToNeotreeEntry(record.data, record.impilo_uid);
        await this.adapterService.processEntry(entry);
        successCount++;
      } catch (error) {
        failureCount++;
        await this.recordFailure(record, error);
        logger.error({ sessionId: record.id }, 'Failed to process session');
      }
    }

    const lastRecord = records[records.length - 1];
    if (lastRecord) {
      await this.updateWatermark(lastRecord.ingested_at, lastRecord.id, records.length);
    }

    logger.info({ total: records.length, success: successCount, failed: failureCount }, 'Batch completed');
  }

  /**
   * Update watermark after processing batch
   */
  private async updateWatermark(
    ingestedAt: Date,
    sessionId: string,
    count: number
  ): Promise<void> {
    try {
      const pool = getPool();
      await pool.query(
        'SELECT update_watermark($1, $2, $3, $4)',
        [this.config.database.sourceTable, ingestedAt, sessionId, count]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to update watermark');
    }
  }

  /**
   * Record failed session for retry
   * Uses original 'time' timestamp from session, not ingested_at
   */
  private async recordFailure(record: CDCRecord, error: unknown): Promise<void> {
    try {
      const pool = getPool();
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Store impilo_uid in the failed record if available
      // Use record.time (original session timestamp) instead of record.ingested_at
      await pool.query(
        'INSERT INTO cdc_failed_records (session_id, ingested_at, last_error, data, impilo_uid, impilo_id, created_at, last_attempt_at, attempt_count) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), 1) ' +
          'ON CONFLICT (session_id) DO UPDATE SET ' +
          'last_error = EXCLUDED.last_error, last_attempt_at = NOW(), attempt_count = cdc_failed_records.attempt_count + 1',
        [
          record.id,
          record.time,  // Use original session timestamp
          errorMessage,
          JSON.stringify(record.data),
          record.impilo_uid || null,
          record.impilo_id || null,
        ]
      );
    } catch (err) {
      logger.error({ error: err }, 'Failed to record failure');
    }
  }

  private async retryFailedSessions(): Promise<void> {
    if (!this.isPolling) return;

    try {
      const pool = getPool();
      const result = await pool.query<FailedRecord>(
        'SELECT * FROM get_failed_sessions_for_retry($1)',
        [50]
      );

      if (result.rows.length > 0) {
        await this.retryBatch(result.rows);
      }
    } catch (error) {
      logger.error({ error }, 'Retry error');
    }
  }

  private async retryBatch(records: FailedRecord[]): Promise<void> {
    const pool = getPool();

    for (const record of records) {
      try {
        const entry = this.convertToNeotreeEntry(record.data, record.impilo_uid);
        await this.adapterService.processEntry(entry);
        await pool.query('SELECT remove_failed_session($1)', [record.id]);
        logger.info({ sessionId: record.session_id }, 'Retry successful');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await pool.query('SELECT update_failed_session_retry($1, $2)', [record.id, errorMessage]);
        logger.warn({ sessionId: record.session_id }, 'Retry failed');
      }
    }
  }

  /**
   * Convert database record to NeotreeEntry
   */
  private convertToNeotreeEntry(
    data: Record<string, unknown>,
    impilo_uid?: string
  ): NeotreeEntry {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid session data');
    }

    const payload = (data as Record<string, unknown>).data ?? data;

    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid session payload');
    }

    const entry = payload as NeotreeEntry;

    if (impilo_uid) {
      entry.impilo_uid = impilo_uid;
    }

    return entry;
  }

  /**
   * Get CDC statistics
   */
  async getStats(): Promise<{
    watermark: {
      table_name: string;
      last_ingested_at: Date;
      records_processed: number;
      updated_at: Date;
    } | null;
    failedCount: number;
  }> {
    const pool = getPool();

    // Get watermark info
    const watermarkResult = await pool.query(
      'SELECT * FROM cdc_watermark WHERE table_name = $1',
      [this.config.database.sourceTable]
    );

    // Get failed count
    const failedResult = await pool.query(
      'SELECT COUNT(*) as count FROM cdc_failed_records'
    );

    return {
      watermark: watermarkResult.rows[0] || null,
      failedCount: parseInt(failedResult.rows[0]?.count || '0'),
    };
  }
}
