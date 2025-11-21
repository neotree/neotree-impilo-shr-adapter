import { NeotreeEntry } from '../../shared/types/neotree.types';
import { FHIRBundle } from '../../shared/types/fhir.types';
export interface FailedSyncRecord {
    id: number;
    session_id: bigint;
    ingested_at: Date;
    attempt_count: number;
    last_error: string | null;
    impilo_uid: string | null;
    impilo_id: string | null;
    data: string;
    synced: boolean;
}
export declare class AdapterService {
    private openhimClient;
    private patientTranslator;
    private duplicateDetection;
    private missingDataHandler;
    private pool;
    constructor();
    /**
     * Process encrypted entry from failed records table:
     * 1. Decrypt impilo_id and data
     * 2. Format/transform data to FHIR
     * 3. Send to OpenHIM
     * 4. On success: update impilo_id to one-way hash and set synced=true
     * 5. On failure: keep encrypted and retry later
     */
    processSyncedEntry(record: FailedSyncRecord): Promise<void>;
    processEntry(entry: NeotreeEntry, syncId?: string): Promise<FHIRBundle>;
    testConnections(): Promise<{
        openhim: boolean;
    }>;
    /**
     * Close database connection
     */
    disconnect(): Promise<void>;
}
//# sourceMappingURL=adapter-service.d.ts.map