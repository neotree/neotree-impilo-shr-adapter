"use strict";
/**
 * Sync Service
 * Handles idempotency, status tracking, retry coordination, and encryption/decryption
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("../../shared/utils/logger");
const config_1 = require("../../shared/config");
const logger = (0, logger_1.getLogger)('sync-service');
class SyncService {
    /**
     * Generate idempotency hash for a FHIR bundle
     */
    static generateBundleHash(bundle) {
        // Create deterministic hash of bundle contents
        const bundleString = JSON.stringify(bundle, Object.keys(bundle).sort());
        return crypto_1.default.createHash('sha256').update(bundleString).digest('hex');
    }
    /**
     * Decrypt AES-256-CBC encrypted data
     * Format: base64(iv):base64(encrypted_data)
     */
    static decryptData(encryptedText) {
        try {
            const [ivB64, encryptedB64] = encryptedText.split(':');
            if (!ivB64 || !encryptedB64) {
                throw new Error('Invalid encrypted data format. Expected: base64(iv):base64(encrypted_data)');
            }
            const iv = Buffer.from(ivB64, 'base64');
            const encrypted = Buffer.from(encryptedB64, 'base64');
            const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
            let decrypted = decipher.update(encrypted);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return decrypted.toString('utf8');
        }
        catch (error) {
            logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Decryption failed');
            throw new Error(`Failed to decrypt data: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Encrypt data using AES-256-CBC
     * Returns: base64(iv):base64(encrypted_data)
     */
    static encryptData(plaintext) {
        try {
            const iv = crypto_1.default.randomBytes(16);
            const cipher = crypto_1.default.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
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
        }
        catch (error) {
            logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Encryption failed');
            throw new Error(`Failed to encrypt data: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Create a one-way SHA-256 hash of impilo_id
     */
    static hashImpiloId(impiloId) {
        return crypto_1.default.createHash('sha256').update(impiloId).digest('hex');
    }
    /**
     * Decrypt impilo_id and data from encrypted format
     */
    static decryptSyncData(encryptedImpiloId, encryptedDataStr) {
        try {
            const decryptedImpiloId = this.decryptData(encryptedImpiloId);
            const decryptedDataStr = this.decryptData(encryptedDataStr);
            const data = JSON.parse(decryptedDataStr);
            return {
                impiloId: decryptedImpiloId,
                data,
            };
        }
        catch (error) {
            logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to decrypt sync data');
            throw error;
        }
    }
    /**
     * Check if this bundle was already submitted (idempotency check)
     */
    static async checkIdempotency(_patientUid, _bundleHash) {
        // This would check the sync_idempotency table
        // For now, returning false (assume not duplicate)
        // In production, query the database
        return false;
    }
    /**
     * Record successful submission
     */
    static async recordSuccess(_patientUid, _bundleHash, _opencrResponse) {
        logger.info({
            patientUid: _patientUid,
            bundleHash: _bundleHash.substring(0, 8),
        }, 'Recording successful sync');
        // In production, insert into sync_idempotency table
        // This prevents duplicate submissions if the same data is sent again
    }
    /**
     * Update sync status in database
     */
    static async updateSyncStatus(syncId, status, error) {
        logger.info({ syncId, status, error }, 'Updating sync status');
        // In production, update sync_status table
        // This allows monitoring and manual retry
    }
    /**
     * Get sync statistics
     */
    static async getSyncStats() {
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
    static async getFailedSyncs(_limit = 50) {
        // In production, query sync_status table for failed records
        return [];
    }
}
exports.SyncService = SyncService;
_a = SyncService;
SyncService.config = (0, config_1.getConfig)();
(() => {
    // Initialize encryption key (must be exactly 32 characters for AES-256)
    const keyString = _a.config.security.encryptionKey;
    if (keyString.length !== 32) {
        throw new Error('Encryption key must be exactly 32 characters for AES-256');
    }
    _a.encryptionKey = Buffer.from(keyString, 'utf8');
})();
//# sourceMappingURL=sync-service.js.map