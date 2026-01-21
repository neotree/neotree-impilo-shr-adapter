/**
 * FHIR Observation Resource Translator
 * Transforms vital signs and measurements to FHIR Observation resources
 */

import type {
  Extension,
  FHIRObservation,
} from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
import { extractVitalSigns, extractBodyMeasurements } from '../mappers/neotree-mapper';
import { getConfig } from '../../shared/config';
import { getLogger } from '../../shared/utils/logger';
import { TransformationError } from '../../shared/utils/errors';
import { getMappingConfigurationService } from '../services/mapping-configuration-service';
import { FieldMapping } from '../types/mappings.types';

const logger = getLogger('observation-translator');

interface ObservationCode {
  loinc: string;
  display: string;
  unit: string;
  ucumCode: string;
}

const VITAL_SIGNS_CODES: Record<string, ObservationCode> = {
  'heart-rate': {
    loinc: '8867-4',
    display: 'Heart rate',
    unit: 'beats/minute',
    ucumCode: '/min',
  },
  'respiratory-rate': {
    loinc: '9279-1',
    display: 'Respiratory rate',
    unit: 'breaths/minute',
    ucumCode: '/min',
  },
  'body-temperature': {
    loinc: '8310-5',
    display: 'Body temperature',
    unit: 'degrees Celsius',
    ucumCode: 'Cel',
  },
  'oxygen-saturation': {
    loinc: '2708-6',
    display: 'Oxygen saturation in Arterial blood',
    unit: 'percent',
    ucumCode: '%',
  },
};

const BODY_MEASUREMENT_CODES: Record<string, ObservationCode> = {
  'body-weight': {
    loinc: '29463-7',
    display: 'Body weight',
    unit: 'grams',
    ucumCode: 'g',
  },
  'body-length': {
    loinc: '8302-2',
    display: 'Body length',
    unit: 'centimeters',
    ucumCode: 'cm',
  },
  'head-occipital-frontal-circumference': {
    loinc: '9843-4',
    display: 'Head Occipital-frontal circumference',
    unit: 'centimeters',
    ucumCode: 'cm',
  },
};

const APGAR_SCORE_CODE: ObservationCode = {
  loinc: '9272-6',
  display: 'Apgar score',
  unit: 'score',
  ucumCode: '{score}',
};

export class ObservationTranslator {
  private config = getConfig();
  private mappingService = getMappingConfigurationService();

  /**
   * Translate Neotree data to FHIR Observation resources
   * Now includes both static mappings and dynamic mappings from configuration
   */
  translate(
    data: NeotreePatientData,
    patientReference: string,
    encounterReference?: string,
    facilityId?: string
  ): FHIRObservation[] {
    try {
      logger.debug({ uid: data.uid }, 'Translating observations to FHIR');

      const observations: FHIRObservation[] = [];
      const resolvedFacilityId = facilityId;

      // Add vital signs
      const vitalSigns = extractVitalSigns(data);
      vitalSigns.forEach((measurement, key) => {
        const code = VITAL_SIGNS_CODES[key];
        if (code) {
          observations.push(
            this.buildObservation(
              data,
              patientReference,
              encounterReference,
              code,
              measurement.value,
              'vital-signs',
              // Use completedAt (when observation was recorded/completed) if available, otherwise admissionDateTime, then dateOfBirth
              data.completedAt || data.admissionDateTime || data.dateOfBirth,
              resolvedFacilityId
            )
          );
        }
      });

      // Add body measurements
      const bodyMeasurements = extractBodyMeasurements(data);
      bodyMeasurements.forEach((measurement, key) => {
        const code = BODY_MEASUREMENT_CODES[key];
        if (code) {
          observations.push(
            this.buildObservation(
              data,
              patientReference,
              encounterReference,
              code,
              measurement.value,
              'vital-signs',
              // Use completedAt for body measurements as well
              data.completedAt || data.dateOfBirth,
              resolvedFacilityId
            )
          );
        }
      });

      // Add Apgar scores
      if (data.apgar1 !== undefined && data.apgar1 !== null) {
        observations.push(
          this.buildApgarObservation(
            data,
            patientReference,
            encounterReference,
            1,
            data.apgar1,
            resolvedFacilityId
          )
        );
      }

      if (data.apgar5 !== undefined && data.apgar5 !== null) {
        observations.push(
          this.buildApgarObservation(
            data,
            patientReference,
            encounterReference,
            5,
            data.apgar5,
            resolvedFacilityId
          )
        );
      }

      if (data.apgar10 !== undefined && data.apgar10 !== null) {
        observations.push(
          this.buildApgarObservation(
            data,
            patientReference,
            encounterReference,
            10,
            data.apgar10,
            resolvedFacilityId
          )
        );
      }

      // Add dynamically mapped observations from configuration
      const dynamicObservations = this.translateDynamicMappings(
        data,
        patientReference,
        encounterReference,
        resolvedFacilityId
      );
      observations.push(...dynamicObservations);

      logger.debug(
        { uid: data.uid, count: observations.length },
        'Observation resources translated successfully'
      );
      return observations;
    } catch (error) {
      logger.error({ error, uid: data.uid }, 'Failed to translate observation data');
      throw new TransformationError('Failed to translate observation data to FHIR', {
        uid: data.uid,
        error: String(error),
      });
    }
  }

  /**
   * Build a single observation resource
   */
  private buildObservation(
    data: NeotreePatientData,
    patientReference: string,
    encounterReference: string | undefined,
    code: ObservationCode,
    value: number,
    category: string,
    effectiveDateTime?: string,
    facilityId?: string
  ): FHIRObservation {
    const observation: FHIRObservation = {
      resourceType: 'Observation',
      meta: this.buildMeta(facilityId),
      identifier: [
        {
          system: this.buildObservationIdentifierSystem(facilityId),
          value: `obs-${data.uniqueKey}-${code.loinc}`,
        },
      ],
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: category,
              display: category === 'vital-signs' ? 'Vital Signs' : 'Body Measurement',
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: code.loinc,
            display: code.display,
          },
        ],
        text: code.display,
      },
      subject: {
        reference: patientReference,
      },
      effectiveDateTime: effectiveDateTime
        ? new Date(effectiveDateTime).toISOString()
        : undefined,
      valueQuantity: {
        value: value,
        unit: code.unit,
        system: 'http://unitsofmeasure.org',
        code: code.ucumCode,
      },
      extension: this.buildEncounterReferenceExtension(encounterReference),
    };

    if (encounterReference) {
      observation.encounter = {
        reference: encounterReference,
      };
    }

    return observation;
  }

  /**
   * Build Apgar score observation
   */
  private buildApgarObservation(
    data: NeotreePatientData,
    patientReference: string,
    encounterReference: string | undefined,
    minutes: number,
    score: number,
    facilityId?: string
  ): FHIRObservation {
    const observation: FHIRObservation = {
      resourceType: 'Observation',
      meta: this.buildMeta(facilityId),
      identifier: [
        {
          system: this.buildObservationIdentifierSystem(facilityId),
          value: `obs-${data.uniqueKey}-apgar-${minutes}`,
        },
      ],
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'survey',
              display: 'Survey',
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: APGAR_SCORE_CODE.loinc,
            display: `${APGAR_SCORE_CODE.display} ${minutes} minute`,
          },
        ],
        text: `Apgar score at ${minutes} minute${minutes !== 1 ? 's' : ''}`,
      },
      subject: {
        reference: patientReference,
      },
      // Use completedAt if available, otherwise calculate from dateOfBirth
      effectiveDateTime: data.completedAt
        ? this.calculateApgarTime(data.completedAt, minutes)
        : data.dateOfBirth
        ? this.calculateApgarTime(data.dateOfBirth, minutes)
        : undefined,
      valueQuantity: {
        value: score,
        unit: APGAR_SCORE_CODE.unit,
        system: 'http://unitsofmeasure.org',
        code: APGAR_SCORE_CODE.ucumCode,
      },
      extension: this.buildEncounterReferenceExtension(encounterReference),
    };

    if (encounterReference) {
      observation.encounter = {
        reference: encounterReference,
      };
    }

    return observation;
  }

  /**
   * Calculate the effective time for Apgar score
   */
  private calculateApgarTime(birthDateTime: string, minutes: number): string {
    const birthTime = new Date(birthDateTime);
    birthTime.setMinutes(birthTime.getMinutes() + minutes);
    return birthTime.toISOString();
  }

  /**
   * Translate dynamically mapped observations from configuration
   * Handles examination findings, additional vitals, laboratory results, etc.
   */
  private translateDynamicMappings(
    data: NeotreePatientData,
    patientReference: string,
    encounterReference: string | undefined,
    facilityId?: string
  ): FHIRObservation[] {
    const observations: FHIRObservation[] = [];

    try {
      // Get all observation mappings from configuration
      const observationMappings = this.mappingService.getMappingsByResourceType(
        'Observation',
        facilityId
      );

      logger.debug(
        { uid: data.uid, facilityId, mappingCount: observationMappings.length },
        'Processing dynamically mapped observations'
      );

      for (const mapping of observationMappings) {
        try {
          // Get the field value from patient data
          const fieldValue = this.getFieldValue(data, mapping.neotreeKey);

          if (fieldValue === null || fieldValue === undefined) {
            continue; // Skip empty fields
          }

          // Skip if it's an empty array
          if (Array.isArray(fieldValue) && fieldValue.length === 0) {
            continue;
          }

          // Handle multi-value fields
          if (mapping.multiValue && Array.isArray(fieldValue)) {
            for (const value of fieldValue) {
              observations.push(
                this.buildDynamicObservation(
                  data,
                  patientReference,
                  encounterReference,
                  mapping,
                  value,
                  facilityId
                )
              );
            }
          } else {
            observations.push(
              this.buildDynamicObservation(
                data,
                patientReference,
                encounterReference,
                mapping,
                fieldValue,
                facilityId
              )
            );
          }

          logger.debug(
            { neotreeKey: mapping.neotreeKey, code: mapping.code },
            'Dynamically mapped observation created'
          );
        } catch (error) {
          logger.warn(
            {
              neotreeKey: mapping.neotreeKey,
              error: error instanceof Error ? error.message : String(error),
            },
            'Failed to create dynamic observation'
          );
        }
      }

      return observations;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error processing dynamic mappings'
      );
      return [];
    }
  }

  /**
   * Build a dynamically mapped observation from configuration
   */
  private buildDynamicObservation(
    data: NeotreePatientData,
    patientReference: string,
    encounterReference: string | undefined,
    mapping: FieldMapping,
    value: unknown,
    facilityId?: string
  ): FHIRObservation {
    const categorySystem = mapping.categorySystem || 'http://terminology.hl7.org/CodeSystem/observation-category';
    const categoryCode = mapping.categoryCode || mapping.observationCategory || 'exam-finding';
    const categoryDisplay = mapping.categoryDisplay || this.getCategoryDisplay(mapping.observationCategory || 'exam-finding');

    const observation: FHIRObservation = {
      resourceType: 'Observation',
      meta: this.buildMeta(facilityId),
      identifier: [
        {
          system: this.buildObservationIdentifierSystem(facilityId),
          value: `obs-${data.uniqueKey}-${mapping.code || mapping.neotreeKey}`,
        },
      ],
      status: 'final',
      category: [
        {
          coding: [
            {
              system: categorySystem,
              code: categoryCode,
              display: categoryDisplay,
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: mapping.codeSystem || 'http://snomed.info/sct',
            code: mapping.code || mapping.neotreeKey,
            display: mapping.codeDisplay || mapping.neotreeDisplayName || mapping.neotreeKey,
          },
        ],
        text: mapping.neotreeDisplayName || mapping.neotreeKey,
      },
      subject: {
        reference: patientReference,
      },
      effectiveDateTime: data.completedAt
        ? new Date(data.completedAt).toISOString()
        : data.admissionDateTime
        ? new Date(data.admissionDateTime).toISOString()
        : data.dateOfBirth
        ? new Date(data.dateOfBirth).toISOString()
        : undefined,
      extension: this.buildEncounterReferenceExtension(encounterReference),
    };

    // Set value based on data type
    if (mapping.fhirDataType === 'quantity' && typeof value === 'number') {
      observation.valueQuantity = {
        value: value,
        unit: mapping.unit || '',
        system: 'http://unitsofmeasure.org',
        code: mapping.ucumCode || mapping.unit || '',
      };
    } else if (mapping.fhirDataType === 'boolean') {
      observation.valueBoolean = this.parseBoolean(value, mapping.valueMapping);
    } else if (mapping.fhirDataType === 'code' || mapping.fhirDataType === 'codeableconcept') {
      observation.valueCodeableConcept = {
        coding: [
          {
            system: mapping.codeSystem || 'http://snomed.info/sct',
            code: String(value),
            display: String(value),
          },
        ],
      };
    } else {
      observation.valueString = String(value);
    }

    if (encounterReference) {
      observation.encounter = {
        reference: encounterReference,
      };
    }

    return observation;
  }

  private buildMeta(facilityId?: string): { source?: string; tag?: { system?: string; code?: string }[] } | undefined {
    const sourceId = this.config.source.id;
    const meta: { source?: string; tag?: { system?: string; code?: string }[] } = {};

    if (sourceId) {
      meta.source = sourceId;
    }

    if (facilityId) {
      meta.tag = [
        {
          system: 'http://openclientregistry.org/fhir/clientid',
          code: facilityId,
        },
      ];
    }

    return meta.source || meta.tag ? meta : undefined;
  }

  private buildObservationIdentifierSystem(facilityId?: string): string | undefined {
    if (!facilityId) {
      return undefined;
    }
    return `urn:oid:${facilityId}:neotree:observation`;
  }

  private buildEncounterReferenceExtension(encounterReference?: string): Extension[] | undefined {
    if (!encounterReference) {
      return undefined;
    }

    return [
      {
        url: 'urn:neotree:neonatal-care-reference',
        valueReference: {
          reference: encounterReference,
        },
      },
    ];
  }

  /**
   * Get field value from patient data by key
   */
  private getFieldValue(data: NeotreePatientData, key: string): unknown {
    const value = (data as unknown as Record<string, unknown>)[key];
    return value;
  }

  /**
   * Parse boolean value with optional value mapping
   */
  private parseBoolean(value: unknown, valueMapping?: Record<string, string>): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (valueMapping) {
      const mapped = valueMapping[String(value)];
      if (mapped !== undefined) {
        return mapped === 'true' || mapped === '1' || mapped === 'True';
      }
    }

    const str = String(value).toLowerCase();
    return str === 'true' || str === 'y' || str === '1' || str === 'yes';
  }

  /**
   * Get display name for observation category
   */
  private getCategoryDisplay(category: string): string {
    const displayMap: Record<string, string> = {
      'vital-signs': 'Vital Signs',
      'exam-finding': 'Exam Finding',
      'imaging': 'Imaging',
      'laboratory': 'Laboratory',
      'procedure': 'Procedure',
      'survey': 'Survey',
      'therapy': 'Therapy',
      'activity': 'Activity',
    };
    return displayMap[category] || category;
  }
}
