/**
 * Mapping Loader Service
 * Responsible for loading FHIR mapping configurations from JSON files
 * Initializes the MappingConfigurationService with default and facility-specific configurations
 */

import * as fs from 'fs';
import * as path from 'path';
import { MappingConfiguration } from '../types/mappings.types';
import { getMappingConfigurationService } from './mapping-configuration-service';
import { getLogger } from '../../shared/utils/logger';

const logger = getLogger('mapping-loader');

/**
 * Load mapping configurations from data directory
 * Expected structure:
 *   /data/mappings/
 *     - default-mappings.json (required)
 *     - neotree-questionnaire.json (required)
 *     - facility-{facilityId}-mappings.json (optional, facility-specific overrides)
 */
export class MappingLoader {
  private static instance: MappingLoader | null = null;
  private mappingsLoaded = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): MappingLoader {
    if (!this.instance) {
      this.instance = new MappingLoader();
    }
    return this.instance;
  }

  /**
   * Initialize and load all mapping configurations
   * Call this once during application startup
   */
  async initialize(): Promise<void> {
    if (this.mappingsLoaded) {
      logger.info('Mappings already loaded, skipping re-initialization');
      return;
    }

    try {
      logger.info('Starting mapping configuration initialization');

      const mappingService = getMappingConfigurationService();

      // Step 1: Load default mappings
      const defaultMappings = this.loadDefaultMappings();
      await mappingService.loadDefaultConfiguration(defaultMappings);

      logger.info(
        { fieldCount: defaultMappings.fieldMappings.length, version: defaultMappings.version },
        'Default mappings loaded successfully'
      );

      // Step 2: Load facility-specific mappings if they exist
      const facilitiesPath = this.getMappingsDirectory();
      if (fs.existsSync(facilitiesPath)) {
        const files = fs.readdirSync(facilitiesPath);
        const facilityMappingFiles = files.filter((f) =>
          f.startsWith('facility-') && f.endsWith('-mappings.json')
        );

        for (const file of facilityMappingFiles) {
          try {
            const facilityId = file.match(/facility-(.+?)-mappings\.json/)?.[1];
            if (facilityId) {
              const facilityMappings = this.loadFacilityMappings(facilityId);
              await mappingService.loadFacilityConfiguration(facilityId, facilityMappings);
              logger.info(
                { facilityId, fieldCount: facilityMappings.fieldMappings.length },
                'Facility-specific mappings loaded'
              );
            }
          } catch (error) {
            logger.warn(
              { file, error: error instanceof Error ? error.message : String(error) },
              'Failed to load facility mappings, continuing with defaults'
            );
          }
        }
      }

      this.mappingsLoaded = true;
      logger.info('Mapping configuration initialization completed successfully');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, 'Failed to initialize mapping configurations');
      throw error;
    }
  }

  /**
   * Check if mappings are loaded
   */
  isInitialized(): boolean {
    return this.mappingsLoaded;
  }

  /**
   * Load default mappings from JSON file
   */
  private loadDefaultMappings(): MappingConfiguration {
    try {
      const filePath = path.join(this.getMappingsDirectory(), 'default-mappings.json');

      if (!fs.existsSync(filePath)) {
        throw new Error(`Default mappings file not found at: ${filePath}`);
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const config = JSON.parse(fileContent) as MappingConfiguration;
      config.questionnaire = this.loadQuestionnaireConfig();

      // Validate the configuration
      const validation = getMappingConfigurationService().validateConfiguration(config);
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      return config;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, 'Failed to load default mappings');
      throw error;
    }
  }

  /**
   * Load questionnaire configuration for unmapped fields
   */
  private loadQuestionnaireConfig(): MappingConfiguration['questionnaire'] {
    const filePath = path.join(this.getMappingsDirectory(), 'neotree-questionnaire.json');
    if (!fs.existsSync(filePath)) {
      logger.warn({ filePath }, 'Questionnaire configuration not found, skipping');
      return undefined;
    }

    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(fileContent) as MappingConfiguration['questionnaire'];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: errorMsg }, 'Failed to load questionnaire configuration, skipping');
      return undefined;
    }
  }

  /**
   * Load facility-specific mappings from JSON file
   */
  private loadFacilityMappings(facilityId: string): MappingConfiguration {
    try {
      const filePath = path.join(
        this.getMappingsDirectory(),
        `facility-${facilityId}-mappings.json`
      );

      if (!fs.existsSync(filePath)) {
        throw new Error(`Facility mappings file not found at: ${filePath}`);
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const config = JSON.parse(fileContent) as MappingConfiguration;

      // Validate the configuration
      const validation = getMappingConfigurationService().validateConfiguration(config);
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      return config;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ facilityId, error: errorMsg }, 'Failed to load facility-specific mappings');
      throw error;
    }
  }

  /**
   * Get the mappings directory path
   */
  private getMappingsDirectory(): string {
    // Resolve relative to project root
    const projectRoot = path.resolve(__dirname, '../../..');
    return path.join(projectRoot, 'data', 'mappings');
  }

  /**
   * Reload mappings (useful for development or configuration updates)
   */
  async reload(): Promise<void> {
    logger.info('Reloading mapping configurations');
    this.mappingsLoaded = false;
    await this.initialize();
  }
}

/**
 * Get singleton mapping loader instance
 */
export function getMappingLoader(): MappingLoader {
  return MappingLoader.getInstance();
}
