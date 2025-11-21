/**
 * Sync Service
 * Handles idempotency, status tracking, retry coordination, and encryption/decryption
 */

import crypto from 'crypto';
import { getLogger } from '../../shared/utils/logger';
import { getConfig } from '../../shared/config';
import { FHIRBundle } from '../../shared/types/fhir.types';

const logger = getLogger('sync-service');

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

export class SyncService {
  private static config = getConfig();
  private static encryptionKey: Buffer;

  static {
    // Initialize encryption key (must be exactly 32 characters for AES-256)
    const keyString = this.config.security.encryptionKey;
    if (keyString.length !== 32) {
      throw new Error('Encryption key must be exactly 32 characters for AES-256');
    }
    this.encryptionKey = Buffer.from(keyString, 'utf8');
  }

  /**
   * Generate idempotency hash for a FHIR bundle
   */
  static generateBundleHash(bundle: FHIRBundle): string {
    // Create deterministic hash of bundle contents
    const bundleString = JSON.stringify(bundle, Object.keys(bundle).sort());
    return crypto.createHash('sha256').update(bundleString).digest('hex');
  }

  /**
   * Decrypt AES-256-CBC encrypted data
   * Format: base64(iv):base64(encrypted_data)
   */
  static decryptData(encryptedText: string): string {
    try {
      const [ivB64, encryptedB64] = encryptedText.split(':');

      if (!ivB64 || !encryptedB64) {
        throw new Error('Invalid encrypted data format. Expected: base64(iv):base64(encrypted_data)');
      }

      const iv = Buffer.from(ivB64, 'base64');
      const encrypted = Buffer.from(encryptedB64, 'base64');

      const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString('utf8');
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Decryption failed');
      throw new Error(`Failed to decrypt data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Encrypt data using AES-256-CBC
   * Returns: base64(iv):base64(encrypted_data)
   */
  static encryptData(plaintext: string): EncryptedData {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);

      let encrypted = cipher.update(plaintext, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);

      const ivB64 = iv.toString('base64');
      const encryptedB64 = encrypted.toString('base64');
      const encryptedValue = `${ivB64}:${encryptedB64}`;

      return {
        encryptedValue,
        iv: ivB64,
        format: 'iv:encrypted',
      };
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Encryption failed');
      throw new Error(`Failed to encrypt data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a one-way SHA-256 hash of impilo_id
   */
  static hashImpiloId(impiloId: string): string {
    return crypto.createHash('sha256').update(impiloId).digest('hex');
  }

  /**
   * Decrypt impilo_id and data from encrypted format
   */
  static decryptSyncData(encryptedImpiloId: string, encryptedDataStr: string): DecryptedSyncData {
    try {
      const decryptedImpiloId = this.decryptData(encryptedImpiloId);
      const decryptedDataStr = this.decryptData(encryptedDataStr);
      const data = JSON.parse(decryptedDataStr);

      return {
        impiloId: decryptedImpiloId,
        data,
      };
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to decrypt sync data');
      throw error;
    }
  }

  /**
   * Check if this bundle was already submitted (idempotency check)
   */
  static async checkIdempotency(_patientUid: string, _bundleHash: string): Promise<boolean> {
    // This would check the sync_idempotency table
    // For now, returning false (assume not duplicate)
    // In production, query the database
    return false;
  }

  /**
   * Record successful submission
   */
  static async recordSuccess(
    _patientUid: string,
    _bundleHash: string,
    _opencrResponse: unknown
  ): Promise<void> {
    logger.info(
      {
        patientUid: _patientUid,
        bundleHash: _bundleHash.substring(0, 8),
      },
      'Recording successful sync'
    );

    // In production, insert into sync_idempotency table
    // This prevents duplicate submissions if the same data is sent again
  }

  /**
   * Update sync status in database
   */
  static async updateSyncStatus(
    syncId: string,
    status: 'success' | 'failed',
    error?: string
  ): Promise<void> {
    logger.info({ syncId, status, error }, 'Updating sync status');

    // In production, update sync_status table
    // This allows monitoring and manual retry
  }

  /**
   * Get sync statistics
   */
  static async getSyncStats(): Promise<{
    pending: number;
    processing: number;
    success: number;
    failed: number;
  }> {
    // In production, query sync_status table for counts
    return {
      pending: 0,
      processing: 0,
      success: 0,
      failed: 0,
    };
  }

  /**
   * Get failed syncs for manual review
   */
  static async getFailedSyncs(_limit: number = 50): Promise<SyncStatus[]> {
    // In production, query sync_status table for failed records
    return [];
  }
}
