/**
 * CDC (Change Data Capture) Service
 * Polls database for new sessions using watermark tracking
 * Processes records in batches and handles failures separately
 * Uses node-cron for reliable scheduling
 */

import * as cron from 'node-cron';
import { getPool } from '../../shared/database/pool';
import { AdapterService } from './adapter-service';
import { DBDecryptionService } from './db-decryption-service';
import { getLogger } from '../../shared/utils/logger';
import { getJsonFileLogger } from '../../shared/utils/json-file-logger';
import { getConfig } from '../../shared/config';
import { NeotreeEntry } from '../../shared/types/neotree.types';
import { getFacilityMapperService } from './facility-mapper-service';

const logger = getLogger('cdc-service');
const jsonLogger = getJsonFileLogger();

interface CDCRecord {
  id: bigint;
  ingested_at: Date;
  session_time: Date;  // Event time/encounter time from source
  impilo_uid?: string;
  impilo_id?: string;  // Encrypted AES-256-CBC value or plain text UUID
  data: string;  // JSON string (can be encrypted AES-256-CBC or plain JSON)
}

interface FailedRecord {
  id: number;
  session_id: string;
  ingested_at: Date;
  attempt_count: number;
  last_error: string | null;
  impilo_uid?: string;
  impilo_id?: string;
  data: string; // Changed to string for FailedSyncRecord compatibility
  synced: boolean;
  cr_synced: boolean;
  shr_synced: boolean;
}

export class CDCService {
  private adapterService: AdapterService;
  private isPolling = false;
  private pollCronSchedule = '*/5 * * * * *'; // Every 5 seconds
  private retryCronSchedule = '*/2 * * * *'; // Default; overwritten by config in constructor
  private pollTask: cron.ScheduledTask | null = null;
  private retryTask: cron.ScheduledTask | null = null;
  private batchSize = 100;
  private config = getConfig();
  private facilityMapper = getFacilityMapperService();

  constructor(adapterService: AdapterService) {
    this.adapterService = adapterService;
    this.retryCronSchedule = this.config.retry.cron;
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

    // Schedule polling task (every 5 seconds)
    this.pollTask = cron.schedule(this.pollCronSchedule, () => {
      void this.pollForNewSessions();
    });

    // Schedule retry task (every 5 minutes)
    this.retryTask = cron.schedule(this.retryCronSchedule, () => {
      void this.retryFailedSessions();
    });

    logger.info('CDC service started with cron scheduler - poll: 5s, retry: 5m');
  }

  /**
   * Stop CDC polling
   */
  async stop(): Promise<void> {
    this.isPolling = false;

    if (this.pollTask) {
      void this.pollTask.stop();
      this.pollTask = null;
    }

    if (this.retryTask) {
      void this.retryTask.stop();
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
    const batchStartTime = Date.now();
    let successCount = 0;
    let crSuccessCount = 0;
    let shrSuccessCount = 0;
    let failureCount = 0;
    let partialFailures = 0;

    for (const record of records) {
      let crSynced = false;
      let shrSynced = false;
      let decryptedData: Record<string, unknown> | null = null;
      let decryptedImpiloId: string | null = null;
      let decryptedImpiloUid: string | null = null;
      let encryptedImpiloId: string | null = null;
      let encryptedDataStr: string | null = null;

      try {
        // Step 1: Decrypt encrypted columns from DB_SOURCE_TABLE if present
        if (
          record.impilo_id &&
          typeof record.impilo_id === 'string' &&
          DBDecryptionService.isEncrypted(record.impilo_id)
        ) {
          try {
            logger.debug({ sessionId: record.id }, 'Decrypting impilo_id and data from DB_SOURCE_TABLE');
            encryptedImpiloId = record.impilo_id;
            encryptedDataStr = record.data;  // Already a string from the database

            const decryptedRecord = DBDecryptionService.decryptDBRecord(
              encryptedImpiloId,
              encryptedDataStr
            );
            decryptedImpiloId = decryptedRecord.impiloId;
            decryptedImpiloUid = record.impilo_uid || null;
            decryptedData = decryptedRecord.data;
            logger.debug({ sessionId: record.id }, 'Successfully decrypted DB_SOURCE_TABLE record');
          } catch (decryptError) {
            logger.error(
              { sessionId: record.id, error: decryptError instanceof Error ? decryptError.message : String(decryptError) },
              'Failed to decrypt DB_SOURCE_TABLE record - storing encrypted in failed table'
            );
            // Record as failure with encrypted data preserved
            await this.recordFailureWithEncryptedData(record, decryptError, encryptedImpiloId, encryptedDataStr);
            failureCount++;
            continue;
          }
        } else {
          // Data is already decrypted or plain - parse JSON string
          decryptedData = JSON.parse(record.data);
          decryptedImpiloId = record.impilo_id || null;
          decryptedImpiloUid = record.impilo_uid || null;
        }

        // Step 2: Validate decrypted data before conversion
        if (!decryptedData || typeof decryptedData !== 'object') {
          throw new Error('Invalid decrypted data: missing or not an object');
        }

        // Step 3: Convert to NeotreeEntry
        const entry = this.convertToNeotreeEntry(
          decryptedData as Record<string, unknown>,
          decryptedImpiloId || undefined,
          decryptedImpiloUid || undefined
        );

        // Step 3b: Skip records whose scriptId is not whitelisted in facility-mapper.json
        const scriptId = entry.script?.id;
        if (!scriptId || !this.facilityMapper.hasFacility(scriptId)) {
          logger.info(
            { sessionId: record.id, scriptId },
            'Skipping record: scriptId not in facility-mapper'
          );
          continue;
        }

        // Phase 1: CR Push (with dual-flow that can fail partially)
        try {
          logger.info({ sessionId: record.id }, 'Phase 1: Pushing demographics to CR with dual-flow');

          try {
            await this.adapterService.processEntryWithDualFlow(entry);
            crSynced = true;
            shrSynced = true;
            crSuccessCount++;
            shrSuccessCount++;
            successCount++;
            logger.info({ sessionId: record.id }, 'Successfully processed session with dual-flow (CR + SHR)');
          } catch (dualFlowError) {
            // The error might have come from CR or SHR. Since processEntryWithDualFlow doesn't distinguish,
            // we attempt to determine which phase failed based on error context.
            const errorMsg = dualFlowError instanceof Error ? dualFlowError.message : String(dualFlowError);
            const errorContext = JSON.stringify(dualFlowError);
            const errorContextData = (dualFlowError as { context?: { crSynced?: boolean; shrSynced?: boolean } })?.context;

            if (errorContextData?.crSynced) {
              crSynced = true;
              shrSynced = errorContextData.shrSynced === true;
              crSuccessCount++;
              logger.warn(
                { sessionId: record.id, error: errorMsg },
                'Phase 1 Partial Success: CR succeeded, SHR failed (context provided)'
              );
            } else if (
              errorMsg.includes('Patient not found') ||
              errorMsg.includes('link clinical data') ||
              errorMsg.includes('Cannot link clinical data')
            ) {
              // This is likely an SHR error after CR succeeded
              crSynced = true;
              shrSynced = false;
              crSuccessCount++;
              logger.warn(
                { sessionId: record.id, error: errorMsg },
                'Phase 1 Partial Success: CR succeeded, SHR failed (will retry in Phase 2)'
              );
            } else {
              // CR push itself failed (or an earlier phase failed)
              crSynced = false;
              shrSynced = false;
              logger.error(
                { sessionId: record.id, error: errorMsg, errorContext: errorContext.substring(0, 500) },
                'Phase 1 Failed: CR push failed'
              );
            }

            failureCount++;
            if (crSynced && !shrSynced) {
              partialFailures++;
            }

            // Record failure with proper CR/SHR status tracking
            await this.recordFailureWithStatus(record, dualFlowError, crSynced, shrSynced, encryptedImpiloId, encryptedDataStr);
          }
        } catch (error) {
          failureCount++;
          logger.error({ sessionId: record.id, error: error instanceof Error ? error.message : String(error) }, 'Unexpected error during dual-flow processing');
          // Store encrypted data if it was encrypted, otherwise store decrypted
          await this.recordFailureWithStatus(record, error, crSynced, shrSynced, encryptedImpiloId, encryptedDataStr);
        }
      } catch (error) {
        failureCount++;
        // Store encrypted data if it was encrypted, otherwise store decrypted
        await this.recordFailureWithStatus(record, error, crSynced, shrSynced, encryptedImpiloId, encryptedDataStr);
        logger.error({ sessionId: record.id, error: error instanceof Error ? error.message : String(error) }, 'Failed to convert or process session');
      }
    }

    const lastRecord = records[records.length - 1];
    if (lastRecord) {
      await this.updateWatermark(lastRecord.ingested_at, lastRecord.id, records.length);
    }

    const batchDurationMs = Date.now() - batchStartTime;

    // Log batch processing statistics
    jsonLogger.logBatchProcess({
      timestamp: new Date().toISOString(),
      operation: 'batch_process',
      batchSize: records.length,
      successCount,
      crSuccessCount,
      shrSuccessCount,
      failureCount,
      partialFailures,
      durationMs: batchDurationMs,
      details: {
        averageTimePerRecord: batchDurationMs / records.length,
        successRate: `${((successCount / records.length) * 100).toFixed(2)}%`,
      },
    });

    logger.info({ total: records.length, success: successCount, failed: failureCount, durationMs: batchDurationMs }, 'Batch completed');
  }

  /**
   * Update watermark after processing batch
   */
  private async updateWatermark(
    ingestedAt: Date,
    sessionId: bigint,
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
   * Uses original 'session_time' timestamp from session
   * Stores encrypted data if it was encrypted, otherwise stores original data
   */
  private async recordFailureWithStatus(
    record: CDCRecord,
    error: unknown,
    crSynced = false,
    shrSynced = false,
    encryptedImpiloId: string | null = null,
    encryptedData: string | null = null
  ): Promise<void> {
    try {
      const pool = getPool();
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Store encrypted data if available, otherwise use original
      const impiloIdToStore = encryptedImpiloId || record.impilo_id || null;
      const dataToStore = encryptedData || JSON.stringify(record.data);

      await pool.query(
        'SELECT record_failed_session($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          record.id,
          record.session_time, // Event time/encounter time from source
          errorMessage,
          impiloIdToStore,
          dataToStore,
          crSynced && shrSynced, // overall synced
          crSynced,
          shrSynced,
          record.impilo_uid || null,
        ]
      );
    } catch (err) {
      logger.error({ error: err }, 'Failed to record failure');
    }
  }

  /**
   * Record failed session with encrypted data that failed to decrypt
   */
  private async recordFailureWithEncryptedData(
    record: CDCRecord,
    error: unknown,
    encryptedImpiloId: string | null,
    encryptedData: string | null
  ): Promise<void> {
    try {
      const pool = getPool();
      const errorMessage = error instanceof Error ? error.message : String(error);

      await pool.query(
        'SELECT record_failed_session($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          record.id,
          record.session_time,
          errorMessage,
          encryptedImpiloId,
          encryptedData,
          false, // synced=false
          false, // cr_synced=false
          false, // shr_synced=false
          record.impilo_uid || null,
        ]
      );
    } catch (err) {
      logger.error({ error: err }, 'Failed to record encrypted failure');
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
    const batchStartTime = Date.now();
    let successCount = 0;
    let failureCount = 0;

    for (const record of records) {
      try {
        // Map FailedRecord to FailedSyncRecord for the adapter service
        const syncRecord = {
          ...record,
          session_id: BigInt(record.session_id),
          impilo_uid: record.impilo_uid || null,
          impilo_id: record.impilo_id || null,
        };

        await this.adapterService.processSyncedEntry(syncRecord);
        successCount++;
        logger.info({ sessionId: record.session_id }, 'Retry successful');
      } catch (error) {
        failureCount++;
        logger.warn({ sessionId: record.session_id, error: error instanceof Error ? error.message : String(error) }, 'Retry failed');
      }
    }

    const batchDurationMs = Date.now() - batchStartTime;

    // Log retry batch statistics
    jsonLogger.logBatchProcess({
      timestamp: new Date().toISOString(),
      operation: 'batch_process',
      batchSize: records.length,
      successCount,
      crSuccessCount: successCount, // Assumption: retry is for both CR and SHR
      shrSuccessCount: successCount,
      failureCount,
      partialFailures: 0,
      durationMs: batchDurationMs,
      details: {
        type: 'retry_batch',
        averageTimePerRecord: records.length > 0 ? batchDurationMs / records.length : 0,
        successRate: records.length > 0 ? `${((successCount / records.length) * 100).toFixed(2)}%` : '0%',
      },
    });

    logger.info({ total: records.length, success: successCount, failed: failureCount, durationMs: batchDurationMs }, 'Retry batch completed');
  }

  /**
   * Convert database record to NeotreeEntry
   */
  private convertToNeotreeEntry(
    data: Record<string, unknown>,
    impilo_id?: string,
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

    if (impilo_id) {
      entry.impilo_id = impilo_id;
    }
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
