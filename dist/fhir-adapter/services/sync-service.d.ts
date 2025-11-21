/**
 * Sync Service
 * Handles idempotency, status tracking, retry coordination, and encryption/decryption
 */
import { FHIRBundle } from '../../shared/types/fhir.types';
export interface SyncStatus {
    id: number;
    patient_uid: string;
    unique_key: string;
    attempt_count: number;
    status: 'pending' | 'processing' | 'success' | 'failed';
    last_attempt_at: Date | null;
    last_error: string | null;
    created_at: Date;
    completed_at: Date | null;
}
export interface EncryptedData {
    encryptedValue: string;
    iv: string;
    format: 'iv:encrypted';
}
export interface DecryptedSyncData {
    impiloId: string;
    data: unknown;
}
export declare class SyncService {
    private static config;
    private static encryptionKey;
    /**
     * Generate idempotency hash for a FHIR bundle
     */
    static generateBundleHash(bundle: FHIRBundle): string;
    /**
     * Decrypt AES-256-CBC encrypted data
     * Format: base64(iv):base64(encrypted_data)
     */
    static decryptData(encryptedText: string): string;
    /**
     * Encrypt data using AES-256-CBC
     * Returns: base64(iv):base64(encrypted_data)
     */
    static encryptData(plaintext: string): EncryptedData;
    /**
     * Create a one-way SHA-256 hash of impilo_id
     */
    static hashImpiloId(impiloId: string): string;
    /**
     * Decrypt impilo_id and data from encrypted format
     */
    static decryptSyncData(encryptedImpiloId: string, encryptedDataStr: string): DecryptedSyncData;
    /**
     * Check if this bundle was already submitted (idempotency check)
     */
    static checkIdempotency(_patientUid: string, _bundleHash: string): Promise<boolean>;
    /**
     * Record successful submission
     */
    static recordSuccess(_patientUid: string, _bundleHash: string, _opencrResponse: unknown): Promise<void>;
    /**
     * Update sync status in database
     */
    static updateSyncStatus(syncId: string, status: 'success' | 'failed', error?: string): Promise<void>;
    /**
     * Get sync statistics
     */
    static getSyncStats(): Promise<{
        pending: number;
        processing: number;
        success: number;
        failed: number;
    }>;
    /**
     * Get failed syncs for manual review
     */
    static getFailedSyncs(_limit?: number): Promise<SyncStatus[]>;
}
//# sourceMappingURL=sync-service.d.ts.map