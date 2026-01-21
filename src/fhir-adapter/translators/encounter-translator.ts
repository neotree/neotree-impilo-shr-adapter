/**
 * FHIR Encounter Resource Translator
 * Transforms Neotree admission/discharge data to FHIR Encounter resource
 * Supports dynamic encounter type, class, and reason code mappings from configuration
 */

import type {
  FHIREncounter,
  Reference,
  CodeableConcept,
  Coding,
  Period,
  Identifier,
  Extension,
} from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
import { getConfig } from '../../shared/config';
import { getLogger } from '../../shared/utils/logger';
import { TransformationError } from '../../shared/utils/errors';
import { getMappingConfigurationService } from '../services/mapping-configuration-service';
import { getFacilityMapperService } from '../services/facility-mapper-service';
import { FieldMapping } from '../types/mappings.types';

const logger = getLogger('encounter-translator');

export class EncounterTranslator {
  private config = getConfig();
  private mappingService = getMappingConfigurationService();
  private facilityMapper = getFacilityMapperService();

  /**
   * Translate Neotree data to FHIR Encounter resource for SHR (Shared Health Record)
   * Only includes subject reference to patient and clinical context
   * Demographic data should not be repeated in SHR
   *
   * Supports both static mappings and dynamic encounter-specific configurations
   * Includes maternal and clinical context extensions for neonatal care
   */
  translate(
    data: NeotreePatientData,
    patientReference: string,
    encounterId: string,
    scriptId?: string
  ): FHIREncounter {
    try {
      logger.debug({ uid: data.uid, scriptId }, 'Translating encounter data to FHIR for SHR');

      // Get facility name from mapper if scriptId provided
      let facilityName = 'Facility';
      let facilityCode = 'facility';
      if (scriptId) {
        facilityName = this.facilityMapper.getFacilityName(scriptId);
        facilityCode = scriptId;
      }

      const encounter: FHIREncounter = {
        resourceType: 'Encounter',
        id: encounterId,
        meta: {
          source: `${this.config.source.id}/${facilityCode}`,
        },
        identifier: this.buildIdentifiers(data, facilityCode),
        status: this.determineStatus(data),
        class: this.buildEncounterClass(),
        type: this.buildEncounterType(data, scriptId),
        subject: {
          reference: patientReference,
          // SHR should NOT include display name - only reference to CR patient
          // Patient identifying information stays in CR only
        },
        period: this.buildPeriod(data),
        reasonCode: this.buildReasonCodes(data, scriptId),
        extension: this.buildEncounterExtensions(data),
      };

      logger.debug({ uid: data.uid, scriptId }, 'Encounter resource translated successfully for SHR');
      return encounter;
    } catch (error) {
      logger.error({ error, uid: data.uid }, 'Failed to translate encounter data');
      throw new TransformationError('Failed to translate encounter data to FHIR', {
        uid: data.uid,
        error: String(error),
      });
    }
  }

  /**
   * Build encounter identifiers
   * Uses facility code from script ID mapping instead of configuration facility ID
   */
  private buildIdentifiers(data: NeotreePatientData, facilityCode: string): Identifier[] {
    return [
      {
        use: 'official',
        system: `urn:oid:${facilityCode}:neotree:encounter`,
        value: `encounter-${data.uniqueKey}`,
      },
    ];
  }

  /**
   * Determine encounter status
   */
  private determineStatus(
    data: NeotreePatientData
  ): 'planned' | 'arrived' | 'triaged' | 'in-progress' | 'onleave' | 'finished' | 'cancelled' {
    if (data.dischargeDateTime) {
      return 'finished';
    }
    if (data.admissionDateTime) {
      return 'in-progress';
    }
    return 'planned';
  }

  /**
   * Build encounter class (inpatient for neonatal admissions)
   */
  private buildEncounterClass(): Coding {
    return {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code: 'IMP',
      display: 'inpatient encounter',
    };
  }

  /**
   * Build encounter type
   * Includes standard neonatal encounter type plus any dynamically mapped types
   */
  private buildEncounterType(data: NeotreePatientData, facilityId?: string): CodeableConcept[] {
    const types: CodeableConcept[] = [];

    // Standard neonatal encounter type
    types.push({
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '424441002',
          display: 'Neonatal encounter',
        },
      ],
      text: 'Neonatal Admission',
    });

    // Add dynamically mapped encounter types
    const dynamicTypes = this.buildDynamicEncounterTypes(data, facilityId);
    types.push(...dynamicTypes);

    return types;
  }

  /**
   * Build dynamically mapped encounter types from configuration
   */
  private buildDynamicEncounterTypes(data: NeotreePatientData, facilityId?: string): CodeableConcept[] {
    const types: CodeableConcept[] = [];

    try {
      // Get all encounter type mappings from configuration
      const typeMappings = this.mappingService
        .getMappingsByResourceType('Encounter', facilityId)
        .filter((m) => m.fhirElementPath === 'type');

      logger.debug(
        { uid: data.uid, facilityId, mappingCount: typeMappings.length },
        'Processing dynamically mapped encounter types'
      );

      for (const mapping of typeMappings) {
        try {
          const fieldValue = this.getFieldValue(data, mapping.neotreeKey);

          if (fieldValue === null || fieldValue === undefined) {
            continue;
          }

          // Skip empty arrays
          if (Array.isArray(fieldValue) && fieldValue.length === 0) {
            continue;
          }

          types.push({
            coding: [
              {
                system: mapping.codeSystem || 'http://snomed.info/sct',
                code: mapping.code || String(fieldValue),
                display: mapping.codeDisplay || String(fieldValue),
              },
            ],
            text: mapping.neotreeDisplayName || mapping.neotreeKey,
          });

          logger.debug(
            { neotreeKey: mapping.neotreeKey, code: mapping.code },
            'Dynamically mapped encounter type created'
          );
        } catch (error) {
          logger.warn(
            {
              neotreeKey: mapping.neotreeKey,
              error: error instanceof Error ? error.message : String(error),
            },
            'Failed to create dynamic encounter type'
          );
        }
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error processing dynamic encounter types'
      );
    }

    return types;
  }

  /**
   * Build encounter period
   * Uses completedAt (form submission time) as period.end if available,
   * otherwise falls back to dischargeDateTime
   */
  private buildPeriod(data: NeotreePatientData): Period | undefined {
    if (!data.admissionDateTime && !data.dischargeDateTime && !data.completedAt) {
      return undefined;
    }

    const period: Period = {};

    if (data.admissionDateTime) {
      period.start = new Date(data.admissionDateTime).toISOString();
    }

    // Use completedAt as period.end (when encounter data was finalized)
    // Fall back to dischargeDateTime if completedAt is not available
    if (data.completedAt) {
      period.end = new Date(data.completedAt).toISOString();
    } else if (data.dischargeDateTime) {
      period.end = new Date(data.dischargeDateTime).toISOString();
    }

    return period;
  }

  /**
   * Build reason codes (admission reason)
   * Includes static admission reason plus dynamically mapped reason codes
   */
  private buildReasonCodes(data: NeotreePatientData, facilityId?: string): CodeableConcept[] | undefined {
    if (!data.admissionReason && data.diagnoses.length === 0) {
      // Check if there are dynamic reason mappings
      const dynamicReasons = this.buildDynamicReasonCodes(data, facilityId);
      return dynamicReasons.length > 0 ? dynamicReasons : undefined;
    }

    const reasons: CodeableConcept[] = [];

    if (data.admissionReason) {
      reasons.push({
        text: data.admissionReason,
      });
    }

    // Add dynamically mapped reason codes
    const dynamicReasons = this.buildDynamicReasonCodes(data, facilityId);
    reasons.push(...dynamicReasons);

    return reasons.length > 0 ? reasons : undefined;
  }

  /**
   * Build dynamically mapped reason codes from configuration
   */
  private buildDynamicReasonCodes(data: NeotreePatientData, facilityId?: string): CodeableConcept[] {
    const reasons: CodeableConcept[] = [];

    try {
      // Get all encounter reason code mappings from configuration
      const reasonMappings = this.mappingService
        .getMappingsByResourceType('Encounter', facilityId)
        .filter((m) => m.fhirElementPath === 'reasonCode');

      logger.debug(
        { uid: data.uid, facilityId, mappingCount: reasonMappings.length },
        'Processing dynamically mapped encounter reason codes'
      );

      for (const mapping of reasonMappings) {
        try {
          const fieldValue = this.getFieldValue(data, mapping.neotreeKey);

          if (fieldValue === null || fieldValue === undefined) {
            continue;
          }

          // Skip empty arrays
          if (Array.isArray(fieldValue) && fieldValue.length === 0) {
            continue;
          }

          // Handle multi-value fields
          if (mapping.multiValue && Array.isArray(fieldValue)) {
            for (const value of fieldValue) {
              reasons.push(
                this.buildReasonCodeFromMapping(mapping, value)
              );
            }
          } else {
            reasons.push(
              this.buildReasonCodeFromMapping(mapping, fieldValue)
            );
          }

          logger.debug(
            { neotreeKey: mapping.neotreeKey, code: mapping.code },
            'Dynamically mapped encounter reason code created'
          );
        } catch (error) {
          logger.warn(
            {
              neotreeKey: mapping.neotreeKey,
              error: error instanceof Error ? error.message : String(error),
            },
            'Failed to create dynamic reason code'
          );
        }
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error processing dynamic encounter reason codes'
      );
    }

    return reasons;
  }

  /**
   * Build a single reason code from mapping
   */
  private buildReasonCodeFromMapping(mapping: FieldMapping, value: unknown): CodeableConcept {
    return {
      coding: [
        {
          system: mapping.codeSystem || 'http://snomed.info/sct',
          code: mapping.code || String(value),
          display: mapping.codeDisplay || String(value),
        },
      ],
      text: mapping.neotreeDisplayName || mapping.neotreeKey,
    };
  }

  /**
   * Build service provider reference
   * Uses facility name from mapper if available
   */
  private buildServiceProvider(facilityName: string): Reference {
    return {
      reference: `Organization/${facilityName}`,
      display: facilityName,
    };
  }

  /**
   * Build encounter diagnosis from admission diagnoses
   */
  private buildDiagnosis(data: NeotreePatientData): Array<{
    condition: { reference: string };
    use?: CodeableConcept;
    rank?: number;
  }> | undefined {
    if (!data.diagnoses || data.diagnoses.length === 0) {
      return undefined;
    }

    return data.diagnoses.map((diagnosis, index) => ({
      condition: {
        reference: `Condition/${this.generateConditionId(data.uid, diagnosis, index)}`,
      },
      rank: index + 1,
    }));
  }

  /**
   * Generate a stable condition ID for reference
   */
  private generateConditionId(uid: string, diagnosis: string, index: number): string {
    const normalized = this.normalizeFhirId(diagnosis);
    return `${uid}-diagnosis-${index}-${normalized}`;
  }

  private normalizeFhirId(value: string): string {
    const base = value
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-');
    return base ? base.slice(0, 32) : 'unknown';
  }

  /**
   * Build encounter extensions for maternal and clinical context
   * Includes:
   * - Maternal HIV status (critical for PMTCT)
   * - Mode of delivery
   * - Labour duration
   * - Antenatal steroids
   * - ROM (Rupture of membranes) duration
   * - Maternal syphilis status
   * - Resuscitation methods
   */
  private buildEncounterExtensions(data: NeotreePatientData): Extension[] | undefined {
    const extensions: Extension[] = [];

    // Maternal HIV Status Extension (critical for PMTCT - Prevention of Mother to Child Transmission)
    if (data.motherHIVStatus) {
      extensions.push({
        url: 'http://neotree-shr.example.com/fhir/StructureDefinition/maternal-hiv-status',
        valueCodeableConcept: {
          coding: [
            {
              system: 'http://snomed.info/sct',
              code: this.mapHIVStatusToCode(data.motherHIVStatus),
              display: data.motherHIVStatus,
            },
          ],
          text: data.motherHIVStatus,
        },
      });

      logger.debug({ uid: data.uid, hivStatus: data.motherHIVStatus }, 'Added maternal HIV status extension');
    }

    // Maternal HAART Status (Antiretroviral Therapy)
    if (data.haart !== undefined) {
      extensions.push({
        url: 'http://neotree-shr.example.com/fhir/StructureDefinition/maternal-haart-status',
        valueBoolean: data.haart,
      });

      logger.debug({ uid: data.uid, haart: data.haart }, 'Added maternal HAART status extension');
    }

    // Maternal Viral Load
    if (data.maternalViralLoad !== undefined) {
      extensions.push({
        url: 'http://neotree-shr.example.com/fhir/StructureDefinition/maternal-viral-load',
        valueQuantity: {
          value: data.maternalViralLoad,
          unit: 'copies/mL',
          system: 'http://unitsofmeasure.org',
          code: '{copies}/mL',
        },
      });

      logger.debug({ uid: data.uid, viralLoad: data.maternalViralLoad }, 'Added maternal viral load extension');
    }

    // Mode of Delivery Extension
    if (data.modeOfDelivery) {
      extensions.push({
        url: 'http://neotree-shr.example.com/fhir/StructureDefinition/mode-of-delivery',
        valueCodeableConcept: {
          coding: [
            {
              system: 'http://snomed.info/sct',
              code: this.mapModeOfDeliveryToCode(data.modeOfDelivery),
              display: data.modeOfDelivery,
            },
          ],
          text: data.modeOfDelivery,
        },
      });

      logger.debug({ uid: data.uid, modeOfDelivery: data.modeOfDelivery }, 'Added mode of delivery extension');
    }

    // Labour Duration Extension
    if (data.labourDuration !== undefined) {
      extensions.push({
        url: 'http://neotree-shr.example.com/fhir/StructureDefinition/labour-duration',
        valueQuantity: {
          value: data.labourDuration,
          unit: 'hours',
          system: 'http://unitsofmeasure.org',
          code: 'h',
        },
      });

      logger.debug({ uid: data.uid, labourDuration: data.labourDuration }, 'Added labour duration extension');
    }

    // ROM (Rupture of Membranes) Duration Extension
    if (data.romLength) {
      extensions.push({
        url: 'http://neotree-shr.example.com/fhir/StructureDefinition/rom-duration',
        valueString: data.romLength,
      });

      logger.debug({ uid: data.uid, romLength: data.romLength }, 'Added ROM duration extension');
    }

    // Antenatal Steroids Extension
    if (data.antenatalSteroids !== undefined) {
      extensions.push({
        url: 'http://neotree-shr.example.com/fhir/StructureDefinition/antenatal-steroids-given',
        valueBoolean: data.antenatalSteroids,
      });

      logger.debug({ uid: data.uid, antenatalSteroids: data.antenatalSteroids }, 'Added antenatal steroids extension');
    }

    // Maternal Syphilis Status Extension
    if (data.syphilisResult) {
      extensions.push({
        url: 'http://neotree-shr.example.com/fhir/StructureDefinition/maternal-syphilis-status',
        valueCodeableConcept: {
          coding: [
            {
              system: 'http://snomed.info/sct',
              code: this.mapSyphilisStatusToCode(data.syphilisResult),
              display: data.syphilisResult,
            },
          ],
          text: data.syphilisResult,
        },
      });

      logger.debug({ uid: data.uid, syphilisResult: data.syphilisResult }, 'Added maternal syphilis status extension');
    }

    // Resuscitation Methods Extension
    if (data.resuscitation && data.resuscitation.length > 0) {
      extensions.push({
        url: 'http://neotree-shr.example.com/fhir/StructureDefinition/resuscitation-methods',
        valueString: data.resuscitation.join('; '),
      });

      logger.debug({ uid: data.uid, resuscitation: data.resuscitation }, 'Added resuscitation methods extension');
    }

    // NVP (Nevirapine) Given to Baby Extension
    if (data.nvpGiven !== undefined) {
      extensions.push({
        url: 'http://neotree-shr.example.com/fhir/StructureDefinition/nvp-prophylaxis-given',
        valueBoolean: data.nvpGiven,
      });

      logger.debug({ uid: data.uid, nvpGiven: data.nvpGiven }, 'Added NVP prophylaxis extension');
    }

    // Labour Problems Extension
    if (data.labourProblems && data.labourProblems.length > 0) {
      extensions.push({
        url: 'http://neotree-shr.example.com/fhir/StructureDefinition/labour-complications',
        valueString: data.labourProblems.join('; '),
      });

      logger.debug({ uid: data.uid, labourProblems: data.labourProblems }, 'Added labour complications extension');
    }

    // Maternal Sepsis Risk Factors Extension
    if (data.maternalSepsisRiskFactors && data.maternalSepsisRiskFactors.length > 0) {
      extensions.push({
        url: 'http://neotree-shr.example.com/fhir/StructureDefinition/maternal-sepsis-risk-factors',
        valueString: data.maternalSepsisRiskFactors.join('; '),
      });

      logger.debug({ uid: data.uid, riskFactors: data.maternalSepsisRiskFactors }, 'Added maternal sepsis risk factors extension');
    }

    logger.debug({ uid: data.uid, extensionCount: extensions.length }, 'Built encounter extensions');
    return extensions.length > 0 ? extensions : undefined;
  }

  /**
   * Map HIV status to SNOMED code
   */
  private mapHIVStatusToCode(status: string): string {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('positive')) return '165815009'; // HIV positive
    if (statusLower.includes('negative')) return '165816005'; // HIV negative
    if (statusLower.includes('unknown')) return '261665006'; // Unknown status
    return '261665006'; // Default to unknown
  }

  /**
   * Map mode of delivery to SNOMED code
   */
  private mapModeOfDeliveryToCode(mode: string): string {
    const modeLower = mode.toLowerCase();
    if (modeLower.includes('vaginal') || modeLower.includes('spontaneous')) return '11466000'; // Vaginal delivery
    if (modeLower.includes('cesarean') || modeLower.includes('section') || modeLower.includes('cs')) return '17561000'; // Cesarean section
    if (modeLower.includes('assisted') || modeLower.includes('forceps')) return '63612008'; // Assisted vaginal delivery
    if (modeLower.includes('vacuum')) return '62961002'; // Vacuum extraction
    return '260372008'; // Unknown mode
  }

  /**
   * Map syphilis status to SNOMED code
   */
  private mapSyphilisStatusToCode(status: string): string {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('positive')) return '1148183003'; // Syphilis positive
    if (statusLower.includes('negative')) return '365861007'; // Syphilis negative
    if (statusLower.includes('reactive')) return '1148183003'; // Reactive (positive)
    return '261665006'; // Unknown
  }

  /**
   * Get field value from patient data by key
   */
  private getFieldValue(data: NeotreePatientData, key: string): unknown {
    const value = (data as unknown as Record<string, unknown>)[key];
    return value;
  }
}
