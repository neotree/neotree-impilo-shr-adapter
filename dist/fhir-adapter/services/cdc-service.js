"use strict";
/**
 * CDC (Change Data Capture) Service
 * Polls database for new sessions using watermark tracking
 * Processes records in batches and handles failures separately
 * Uses node-cron for reliable scheduling
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CDCService = void 0;
const cron = __importStar(require("node-cron"));
const pool_1 = require("../../shared/database/pool");
const logger_1 = require("../../shared/utils/logger");
const config_1 = require("../../shared/config");
const logger = (0, logger_1.getLogger)('cdc-service');
class CDCService {
    constructor(adapterService) {
        this.isPolling = false;
        this.pollCronSchedule = '*/30 * * * * *'; // Every 30 seconds
        this.retryCronSchedule = '*/5 * * * *'; // Every 5 minutes
        this.pollTask = null;
        this.retryTask = null;
        this.batchSize = 100;
        this.config = (0, config_1.getConfig)();
        this.adapterService = adapterService;
    }
    async start() {
        if (this.isPolling)
            return;
        this.isPolling = true;
        const pool = (0, pool_1.getPool)();
        try {
            await pool.query('SELECT 1');
        }
        catch (error) {
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
    async stop() {
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
    async pollForNewSessions() {
        if (!this.isPolling)
            return;
        try {
            const pool = (0, pool_1.getPool)();
            const result = await pool.query('SELECT * FROM get_new_sessions($1)', [this.batchSize]);
            if (result.rows.length > 0) {
                await this.processBatch(result.rows);
            }
        }
        catch (error) {
            logger.error({ error }, 'Polling error');
        }
    }
    async processBatch(records) {
        let successCount = 0;
        let failureCount = 0;
        for (const record of records) {
            try {
                const entry = this.convertToNeotreeEntry(record.data, record.impilo_uid);
                await this.adapterService.processEntry(entry);
                successCount++;
            }
            catch (error) {
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
    async updateWatermark(ingestedAt, sessionId, count) {
        try {
            const pool = (0, pool_1.getPool)();
            await pool.query('SELECT update_watermark($1, $2, $3, $4)', [this.config.database.sourceTable, ingestedAt, sessionId, count]);
        }
        catch (error) {
            logger.error({ error }, 'Failed to update watermark');
        }
    }
    /**
     * Record failed session for retry
     * Uses original 'time' timestamp from session, not ingested_at
     */
    async recordFailure(record, error) {
        try {
            const pool = (0, pool_1.getPool)();
            const errorMessage = error instanceof Error ? error.message : String(error);
            // Store impilo_uid in the failed record if available
            // Use record.time (original session timestamp) instead of record.ingested_at
            await pool.query('INSERT INTO cdc_failed_records (session_id, ingested_at, last_error, data, impilo_uid, impilo_id, created_at, last_attempt_at, attempt_count) ' +
                'VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), 1) ' +
                'ON CONFLICT (session_id) DO UPDATE SET ' +
                'last_error = EXCLUDED.last_error, last_attempt_at = NOW(), attempt_count = cdc_failed_records.attempt_count + 1', [
                record.id,
                record.time, // Use original session timestamp
                errorMessage,
                JSON.stringify(record.data),
                record.impilo_uid || null,
                record.impilo_id || null,
            ]);
        }
        catch (err) {
            logger.error({ error: err }, 'Failed to record failure');
        }
    }
    async retryFailedSessions() {
        if (!this.isPolling)
            return;
        try {
            const pool = (0, pool_1.getPool)();
            const result = await pool.query('SELECT * FROM get_failed_sessions_for_retry($1)', [50]);
            if (result.rows.length > 0) {
                await this.retryBatch(result.rows);
            }
        }
        catch (error) {
            logger.error({ error }, 'Retry error');
        }
    }
    async retryBatch(records) {
        const pool = (0, pool_1.getPool)();
        for (const record of records) {
            try {
                const entry = this.convertToNeotreeEntry(record.data, record.impilo_uid);
                await this.adapterService.processEntry(entry);
                await pool.query('SELECT remove_failed_session($1)', [record.id]);
                logger.info({ sessionId: record.session_id }, 'Retry successful');
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                await pool.query('SELECT update_failed_session_retry($1, $2)', [record.id, errorMessage]);
                logger.warn({ sessionId: record.session_id }, 'Retry failed');
            }
        }
    }
    /**
     * Convert database record to NeotreeEntry
     */
    convertToNeotreeEntry(data, impilo_uid) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid session data');
        }
        const payload = data.data ?? data;
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid session payload');
        }
        const entry = payload;
        if (impilo_uid) {
            entry.impilo_uid = impilo_uid;
        }
        return entry;
    }
    /**
     * Get CDC statistics
     */
    async getStats() {
        const pool = (0, pool_1.getPool)();
        // Get watermark info
        const watermarkResult = await pool.query('SELECT * FROM cdc_watermark WHERE table_name = $1', [this.config.database.sourceTable]);
        // Get failed count
        const failedResult = await pool.query('SELECT COUNT(*) as count FROM cdc_failed_records');
        return {
            watermark: watermarkResult.rows[0] || null,
            failedCount: parseInt(failedResult.rows[0]?.count || '0'),
        };
    }
}
exports.CDCService = CDCService;
//# sourceMappingURL=cdc-service.js.map