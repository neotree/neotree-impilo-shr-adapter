/**
 * Database Decryption Service
 * Handles decryption of encrypted columns from DB_SOURCE_TABLE
 * Uses IMPILO_ENCRYPTION_SECRET for AES-256-CBC decryption
 */

import crypto from 'crypto';
import { getLogger } from '../../shared/utils/logger';
import { getConfig } from '../../shared/config';

const logger = getLogger('db-decryption-service');

export interface DecryptedDBRecord {
  impiloId: string;
  data: Record<string, unknown>;
}

export class DBDecryptionService {
  private static config = getConfig();
  private static impiloEncryptionKey: Buffer;

  static {
    // Initialize IMPILO encryption key (must be exactly 32 characters for AES-256)
    const keyString = this.config.security.impiloEncryptionSecret;
    if (keyString.length !== 32) {
      throw new Error('IMPILO_ENCRYPTION_SECRET must be exactly 32 characters for AES-256');
    }
    this.impiloEncryptionKey = Buffer.from(keyString, 'utf8');
  }

  /**
   * Decrypt a single encrypted field using AES-256-CBC
   * Format: base64(iv):base64(encrypted_data)
   *
   * @param encryptedText - The encrypted text in format iv:encrypted
   * @returns Decrypted string
   */
  private static decryptField(encryptedText: string): string {
    try {
      const [ivB64, encryptedB64] = encryptedText.split(':');

      if (!ivB64 || !encryptedB64) {
        throw new Error('Invalid encrypted data format. Expected: base64(iv):base64(encrypted_data)');
      }

      const iv = Buffer.from(ivB64, 'base64');
      const encrypted = Buffer.from(encryptedB64, 'base64');

      const decipher = crypto.createDecipheriv('aes-256-cbc', this.impiloEncryptionKey, iv);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return decrypted.toString('utf8');
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Field decryption failed'
      );
      throw new Error(
        `Failed to decrypt field: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Decrypt impilo_id and data columns from DB_SOURCE_TABLE record
   * These are encrypted with IMPILO_ENCRYPTION_SECRET using AES-256-CBC
   *
   * @param encryptedImpiloId - Encrypted impilo_id column value
   * @param encryptedData - Encrypted data column value (JSONB)
   * @returns Object with decrypted impiloId and parsed data
   */
  static decryptDBRecord(encryptedImpiloId: string, encryptedData: string): DecryptedDBRecord {
    try {
      logger.debug('Decrypting DB_SOURCE_TABLE record');

      // Decrypt impilo_id field
      const decryptedImpiloId = this.decryptField(encryptedImpiloId);
      logger.debug('Successfully decrypted impilo_id');

      // Decrypt data field
      const decryptedDataStr = this.decryptField(encryptedData);
      const data = JSON.parse(decryptedDataStr);
      logger.debug('Successfully decrypted and parsed data');

      return {
        impiloId: decryptedImpiloId,
        data,
      };
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to decrypt DB record'
      );
      throw error;
    }
  }

  /**
   * Decrypt only the impilo_id field
   *
   * @param encryptedImpiloId - Encrypted impilo_id column value
   * @returns Decrypted impilo_id string
   */
  static decryptImpiloId(encryptedImpiloId: string): string {
    return this.decryptField(encryptedImpiloId);
  }

  /**
   * Decrypt only the data field
   *
   * @param encryptedData - Encrypted data column value
   * @returns Parsed data object
   */
  static decryptData(encryptedData: string): Record<string, unknown> {
    const decryptedDataStr = this.decryptField(encryptedData);
    return JSON.parse(decryptedDataStr);
  }

  /**
   * Check if a string appears to be encrypted (contains iv:encrypted format)
   *
   * @param value - String to check
   * @returns True if string appears to be encrypted
   */
  static isEncrypted(value: string | null | undefined): boolean {
    if (!value || typeof value !== 'string') return false;
    const parts = value.split(':');
    return parts.length === 2 && this.isBase64(parts[0]) && this.isBase64(parts[1]);
  }

  /**
   * Check if a string is valid base64
   */
  private static isBase64(str: string): boolean {
    try {
      return Buffer.from(str, 'base64').toString('base64') === str;
    } catch {
      return false;
    }
  }
}
