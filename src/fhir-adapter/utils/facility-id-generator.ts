/**
 * Facility ID Generator
 * Generates FACILITY_ID from decrypted impilo_id
 * Format: impilo_id "00-0D-0D-2026-NN-00001" → FACILITY_ID "ZW000D0D"
 */

import { getLogger } from '../../shared/utils/logger';

const logger = getLogger('facility-id-generator');

export class FacilityIdGenerator {
  /**
   * Generate FACILITY_ID from impilo_id
   * Takes first 3 segments (separated by dashes), removes dashes, and prefixes with "ZW"
   *
   * @param impiloId - The decrypted impilo_id in format "00-0D-0D-2026-NN-00001"
   * @returns FACILITY_ID in format "ZW000D0D"
   * @throws Error if impilo_id is invalid or missing required segments
   */
  static generateFromImpiloId(impiloId: string | null | undefined): string {
    console.log("#######################FID######",impiloId)
    if (!impiloId || typeof impiloId !== 'string') {
      throw new Error('impilo_id is required and must be a non-empty string');
    }

    const segments = impiloId.split('-');

    if (segments.length < 3) {
      throw new Error(
        `Invalid impilo_id format: expected at least 3 segments separated by dashes, got ${segments.length}. ` +
          `impilo_id: ${impiloId}`
      );
    }

    // Take first 3 segments, remove dashes, and prefix with ZW
    const facilityCode = segments.slice(0, 3).join('');
    const facilityId = `ZW${facilityCode}`;

    logger.debug(
      { impiloId, segments: segments.slice(0, 3), facilityId },
      'Generated FACILITY_ID from impilo_id'
    );

    return facilityId;
  }

  /**
   * Validate that a FACILITY_ID matches expected format (ZW + 6 hex characters)
   *
   * @param facilityId - The FACILITY_ID to validate
   * @returns True if valid format
   */
  static isValidFormat(facilityId: string): boolean {
    // Should be "ZW" followed by 6 characters (2 segments of 2 chars each + 1 segment of 2 chars = 6 chars)
    return /^ZW[0-9A-F]{6}$/i.test(facilityId);
  }
}
