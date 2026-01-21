/**
 * Mapping Configuration Service
 * Loads, manages, and applies FHIR field mappings from configuration files
 * Supports facility-specific overrides and dynamic mapping resolution
 */

import { getLogger } from '../../shared/utils/logger';
import {
  MappingConfiguration,
  FieldMapping,
  FacilityMappingOverride,
  MappingResolution,
  MappingResult,
  MappedFieldData,
  MappingAudit,
} from '../types/mappings.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';

const logger = getLogger('mapping-configuration-service');

export class MappingConfigurationService {
  private defaultConfig: MappingConfiguration | null = null;
  private facilityConfigs: Map<string, MappingConfiguration> = new Map();
  private fieldMappingIndex: Map<string, FieldMapping> = new Map();
  private audits: MappingAudit[] = [];

  /**
   * Initialize the service with default mapping configuration
   */
  async loadDefaultConfiguration(config: MappingConfiguration): Promise<void> {
    logger.info(
      { version: config.version, fieldCount: config.fieldMappings.length },
      'Loading default mapping configuration'
    );

    this.defaultConfig = config;
    this.buildFieldIndex(config);

    logger.info(
      { indexedFields: this.fieldMappingIndex.size },
      'Default mapping configuration loaded'
    );
  }

  /**
   * Load facility-specific configuration overrides
   */
  async loadFacilityConfiguration(
    facilityId: string,
    config: MappingConfiguration
  ): Promise<void> {
    if (!this.defaultConfig) {
      throw new Error('Default configuration must be loaded first');
    }

    logger.info(
      { facilityId, version: config.version },
      'Loading facility-specific mapping configuration'
    );

    this.facilityConfigs.set(facilityId, config);
    logger.info({ facilityId }, 'Facility configuration loaded');
  }

  /**
   * Apply facility-specific overrides to default configuration
   */
  async applyFacilityOverrides(
    facilityId: string,
    overrides: FacilityMappingOverride
  ): Promise<void> {
    if (!this.defaultConfig) {
      throw new Error('Default configuration must be loaded first');
    }

    logger.info(
      { facilityId, overrideCount: overrides.mappingOverrides.length },
      'Applying facility-specific mapping overrides'
    );

    // Create a copy of default config with overrides applied
    const facilityConfig = JSON.parse(JSON.stringify(this.defaultConfig)) as MappingConfiguration;
    facilityConfig.facilityId = facilityId;

    // Apply overrides to existing mappings
    for (const override of overrides.mappingOverrides) {
      const fieldIndex = facilityConfig.fieldMappings.findIndex(
        (m) => m.neotreeKey === override.neotreeKey
      );

      if (fieldIndex >= 0) {
        facilityConfig.fieldMappings[fieldIndex] = {
          ...facilityConfig.fieldMappings[fieldIndex],
          ...override.override,
        };
        logger.debug(
          { neotreeKey: override.neotreeKey },
          'Applied mapping override'
        );
      }
    }

    // Add new mappings
    if (overrides.additionalMappings) {
      facilityConfig.fieldMappings.push(...overrides.additionalMappings);
      logger.debug(
        { count: overrides.additionalMappings.length },
        'Added new mappings for facility'
      );
    }

    // Remove disabled mappings
    if (overrides.disabledMappings) {
      facilityConfig.fieldMappings = facilityConfig.fieldMappings.filter(
        (m) => !overrides.disabledMappings!.includes(m.neotreeKey)
      );
      logger.debug(
        { count: overrides.disabledMappings.length },
        'Disabled mappings for facility'
      );
    }

    this.facilityConfigs.set(facilityId, facilityConfig);
  }

  /**
   * Get mapping for a specific Neotree field
   */
  getMapping(
    neotreeKey: string,
    facilityId?: string
  ): MappingResolution {
    // Get facility-specific or default config
    const config = facilityId && this.facilityConfigs.has(facilityId)
      ? this.facilityConfigs.get(facilityId)!
      : this.defaultConfig;

    if (!config) {
      return {
        found: false,
        reason: 'No mapping configuration loaded',
      };
    }

    // Search for mapping in facility config
    const mapping = config.fieldMappings.find((m) => m.neotreeKey === neotreeKey);

    if (mapping) {
      return {
        found: true,
        mapping,
      };
    }

    // Not found - provide alternatives
    const alternatives = config.fieldMappings.filter(
      (m) =>
        m.neotreeDescription?.toLowerCase().includes(neotreeKey.toLowerCase()) ||
        m.neotreeDisplayName?.toLowerCase().includes(neotreeKey.toLowerCase())
    );

    return {
      found: false,
      reason: `No mapping found for field: ${neotreeKey}`,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
    };
  }

  /**
   * Check if a field is mapped
   */
  isMapped(neotreeKey: string, facilityId?: string): boolean {
    return this.getMapping(neotreeKey, facilityId).found;
  }

  /**
   * Get all mappings for a specific FHIR resource type
   */
  getMappingsByResourceType(
    resourceType: string,
    facilityId?: string
  ): FieldMapping[] {
    const config = facilityId && this.facilityConfigs.has(facilityId)
      ? this.facilityConfigs.get(facilityId)!
      : this.defaultConfig;

    if (!config) {
      return [];
    }

    return config.fieldMappings.filter((m) => m.fhirResourceType === resourceType);
  }

  /**
   * Get all mappings
   */
  getAllMappings(facilityId?: string): FieldMapping[] {
    const config = facilityId && this.facilityConfigs.has(facilityId)
      ? this.facilityConfigs.get(facilityId)!
      : this.defaultConfig;

    return config?.fieldMappings || [];
  }

  /**
   * Get questionnaire configuration for unmapped fields
   */
  getQuestionnaireConfig(facilityId?: string): any {
    const config = facilityId && this.facilityConfigs.has(facilityId)
      ? this.facilityConfigs.get(facilityId)!
      : this.defaultConfig;

    return config?.questionnaire || null;
  }

  /**
   * Validate a mapping configuration
   */
  validateConfiguration(config: MappingConfiguration): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (!config.version) {
      errors.push('Configuration missing required field: version');
    }

    if (!config.fieldMappings || config.fieldMappings.length === 0) {
      errors.push('Configuration must have at least one field mapping');
    }

    // Validate each mapping
    config.fieldMappings.forEach((mapping, index) => {
      if (!mapping.neotreeKey) {
        errors.push(`Mapping[${index}]: Missing neotreeKey`);
      }
      if (!mapping.fhirResourceType) {
        errors.push(`Mapping[${index}]: Missing fhirResourceType`);
      }
      if (!mapping.fhirDataType) {
        errors.push(`Mapping[${index}]: Missing fhirDataType`);
      }

      // Check for duplicate neotreeKeys
      const duplicates = config.fieldMappings.filter(
        (m, i) => m.neotreeKey === mapping.neotreeKey && i !== index
      );
      if (duplicates.length > 0) {
        errors.push(`Duplicate mapping for neotreeKey: ${mapping.neotreeKey}`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Apply mappings to patient data
   * Returns mapped fields + unmapped fields
   */
  applyMappings(
    patientData: NeotreePatientData,
    facilityId?: string
  ): MappingResult {
    const config = facilityId && this.facilityConfigs.has(facilityId)
      ? this.facilityConfigs.get(facilityId)!
      : this.defaultConfig;

    if (!config) {
      return {
        success: false,
        mappedFields: [],
        unmappedFields: [],
        errors: [{
          field: 'root',
          error: 'No mapping configuration loaded',
        }],
      };
    }

    const mappedFields: MappedFieldData[] = [];
    const unmappedFields: { key: string; value: unknown; reason: string }[] = [];
    const errors: { field: string; error: string }[] = [];
    const questionnaireFallbacks: { questionId: string; neotreeKey: string; value: unknown }[] = [];

    // Iterate through all fields in patientData
    const dataKeys = Object.keys(patientData) as (keyof NeotreePatientData)[];

    dataKeys.forEach((key) => {
      const value = patientData[key];

      // Skip empty values
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
        return;
      }

      // Find mapping
      const mapping = config.fieldMappings.find((m) => m.neotreeKey === (key as string));

      if (mapping) {
        try {
          const mapped: MappedFieldData = {
            neotreeKey: mapping.neotreeKey,
            neotreeValue: value,
            mapping,
            fhirResource: {
              resourceType: mapping.fhirResourceType,
              elementPath: mapping.fhirElementPath,
              value, // In production, would transform value based on dataType
              metadata: {
                code: mapping.code,
                codeSystem: mapping.codeSystem,
                unit: mapping.unit,
              },
            },
          };
          mappedFields.push(mapped);
        } catch (error) {
          errors.push({
            field: key as string,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        // Check if questionnaire fallback is enabled
        if (config.options?.enableQuestionnaireFallback !== false) {
          const questionnaire = config.questionnaire;
          if (questionnaire) {
            // Find matching question
            const question = this.findQuestionForField(key as string, questionnaire);
            if (question) {
              questionnaireFallbacks.push({
                questionId: question.linkId,
                neotreeKey: key as string,
                value,
              });
              return; // Don't add to unmapped
            }
          }
        }

        unmappedFields.push({
          key: key as string,
          value,
          reason: 'No mapping found',
        });
      }
    });

    // Create audit entry
    const audit: MappingAudit = {
      timestamp: new Date().toISOString(),
      facilityId: facilityId || 'default',
      neotreeUid: patientData.uid,
      mappingVersion: config.version,
      statistics: {
        totalFields: dataKeys.filter(
          (k) =>
            patientData[k] !== undefined &&
            patientData[k] !== null &&
            !(Array.isArray(patientData[k]) && patientData[k].length === 0)
        ).length,
        mappedFields: mappedFields.length,
        unmappedFields: unmappedFields.length,
        questionnaireFallbacks: questionnaireFallbacks.length,
        errors: errors.length,
        successRate: (mappedFields.length / (mappedFields.length + unmappedFields.length)) * 100 || 0,
      },
    };

    this.audits.push(audit);

    return {
      success: errors.length === 0,
      mappedFields,
      unmappedFields,
      errors,
      questionnaireFallbacks: questionnaireFallbacks.length > 0 ? questionnaireFallbacks : undefined,
    };
  }

  /**
   * Get mapping statistics
   */
  getStatistics(facilityId?: string): {
    totalMappings: number;
    mappingsByResourceType: Record<string, number>;
    questionnaireFallbacksEnabled: boolean;
    auditsCount: number;
  } {
    const config = facilityId && this.facilityConfigs.has(facilityId)
      ? this.facilityConfigs.get(facilityId)!
      : this.defaultConfig;

    if (!config) {
      return {
        totalMappings: 0,
        mappingsByResourceType: {},
        questionnaireFallbacksEnabled: false,
        auditsCount: 0,
      };
    }

    const mappingsByResourceType: Record<string, number> = {};
    config.fieldMappings.forEach((m) => {
      mappingsByResourceType[m.fhirResourceType] =
        (mappingsByResourceType[m.fhirResourceType] || 0) + 1;
    });

    return {
      totalMappings: config.fieldMappings.length,
      mappingsByResourceType,
      questionnaireFallbacksEnabled: config.options?.enableQuestionnaireFallback !== false,
      auditsCount: this.audits.length,
    };
  }

  /**
   * Get audit trail
   */
  getAudits(facilityId?: string, limit?: number): MappingAudit[] {
    let filtered = this.audits;

    if (facilityId) {
      filtered = filtered.filter((a) => a.facilityId === facilityId);
    }

    if (limit) {
      filtered = filtered.slice(-limit);
    }

    return filtered;
  }

  /**
   * Clear audit trail
   */
  clearAudits(): void {
    this.audits = [];
    logger.info('Audit trail cleared');
  }

  // ===== PRIVATE HELPERS =====

  /**
   * Build searchable index of field mappings
   */
  private buildFieldIndex(config: MappingConfiguration): void {
    this.fieldMappingIndex.clear();

    config.fieldMappings.forEach((mapping) => {
      this.fieldMappingIndex.set(mapping.neotreeKey, mapping);
    });
  }

  /**
   * Find questionnaire question matching a field
   */
  private findQuestionForField(neotreeKey: string, questionnaire: any): any {
    if (!questionnaire || !questionnaire.questions) {
      return null;
    }

    // Search for matching question
    for (const question of questionnaire.questions) {
      if (question.linkId === neotreeKey || question.text?.includes(neotreeKey)) {
        return question;
      }

      // Search in nested groups
      if (question.questions) {
        const nested = this.findQuestionForField(neotreeKey, { questions: question.questions });
        if (nested) {
          return nested;
        }
      }
    }

    const generic = questionnaire.genericQuestion;
    if (generic && generic.linkIdPrefix) {
      const text = generic.textTemplate
        ? String(generic.textTemplate).replace('{key}', neotreeKey)
        : neotreeKey;
      return {
        linkId: `${generic.linkIdPrefix}${neotreeKey}`,
        text,
        type: generic.type || 'string',
        group: generic.group,
      };
    }

    return null;
  }
}

// Singleton instance
let instance: MappingConfigurationService | null = null;

/**
 * Get or create MappingConfigurationService singleton
 */
export function getMappingConfigurationService(): MappingConfigurationService {
  if (!instance) {
    instance = new MappingConfigurationService();
  }
  return instance;
}
