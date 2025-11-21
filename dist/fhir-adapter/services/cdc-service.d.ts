/**
 * CDC (Change Data Capture) Service
 * Polls database for new sessions using watermark tracking
 * Processes records in batches and handles failures separately
 * Uses node-cron for reliable scheduling
 */
import { AdapterService } from './adapter-service';
export declare class CDCService {
    private adapterService;
    private isPolling;
    private pollCronSchedule;
    private retryCronSchedule;
    private pollTask;
    private retryTask;
    private batchSize;
    private config;
    constructor(adapterService: AdapterService);
    start(): Promise<void>;
    /**
     * Stop CDC polling
     */
    stop(): Promise<void>;
    private pollForNewSessions;
    private processBatch;
    /**
     * Update watermark after processing batch
     */
    private updateWatermark;
    /**
     * Record failed session for retry
     * Uses original 'time' timestamp from session, not ingested_at
     */
    private recordFailure;
    private retryFailedSessions;
    private retryBatch;
    /**
     * Convert database record to NeotreeEntry
     */
    private convertToNeotreeEntry;
    /**
     * Get CDC statistics
     */
    getStats(): Promise<{
        watermark: {
            table_name: string;
            last_ingested_at: Date;
            records_processed: number;
            updated_at: Date;
        } | null;
        failedCount: number;
    }>;
}
//# sourceMappingURL=cdc-service.d.ts.map