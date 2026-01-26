/**
 * Facility Mapper Service
 * Maps script IDs from the database to facility names
 * Provides organization information for SHR and CR resources
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../shared/utils/logger';

const logger = getLogger('facility-mapper-service');

interface FacilityMapping {
  [scriptId: string]: string; // scriptId -> facilityName
}

class FacilityMapperService {
  private facilityMap: FacilityMapping = {};
  private mapFilePath: string;

  constructor() {
    // Load facility mappings from data/mappings/facility-mapper.json
    this.mapFilePath = path.join(process.cwd(), 'config', 'facility-mapper.json');
    this.loadFacilityMappings();
  }

  /**
   * Load facility mappings from JSON file
   */
  private loadFacilityMappings(): void {
    try {
      if (fs.existsSync(this.mapFilePath)) {
        const fileContent = fs.readFileSync(this.mapFilePath, 'utf-8');
        this.facilityMap = JSON.parse(fileContent);
        logger.info(
          { facilityCount: Object.keys(this.facilityMap).length, filePath: this.mapFilePath },
          'Facility mappings loaded successfully'
        );
      } else {
        logger.warn(
          { filePath: this.mapFilePath },
          'Facility mapper file not found, using empty mappings'
        );
        this.facilityMap = {};
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), filePath: this.mapFilePath },
        'Failed to load facility mappings'
      );
      this.facilityMap = {};
    }
  }

  /**
   * Get facility name by script ID
   * Returns facility name if found, otherwise returns the script ID itself
   */
  getFacilityName(scriptId: string): string {
    if (!scriptId) {
      return 'Unknown Facility';
    }

    const facilityName = this.facilityMap[scriptId];
    if (facilityName) {
      logger.debug({ scriptId, facilityName }, 'Found facility mapping');
      return facilityName;
    }

    logger.debug({ scriptId }, 'Facility mapping not found, using script ID');
    return scriptId;
  }

  /**
   * Check if facility mapping exists for script ID
   */
  hasFacility(scriptId: string): boolean {
    return !!this.facilityMap[scriptId];
  }

  /**
   * Get all facility mappings
   */
  getAllFacilities(): FacilityMapping {
    return { ...this.facilityMap };
  }

  /**
   * Reload facility mappings (useful for hot reloading)
   */
  reloadMappings(): void {
    logger.info('Reloading facility mappings');
    this.loadFacilityMappings();
  }
}

// Singleton instance
let mapperInstance: FacilityMapperService | null = null;

export function getFacilityMapperService(): FacilityMapperService {
  if (!mapperInstance) {
    mapperInstance = new FacilityMapperService();
  }
  return mapperInstance;
}
