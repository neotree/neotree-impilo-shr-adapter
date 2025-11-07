/**
 * FHIR Condition Resource Translator
 * Transforms diagnoses to FHIR Condition resources
 */

import type {
  FHIRCondition,
  CodeableConcept,
} from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
import { getConfig } from '../../shared/config';
import { getLogger } from '../../shared/utils/logger';
import { TransformationError } from '../../shared/utils/errors';

const logger = getLogger('condition-translator');

export class ConditionTranslator {
  private config = getConfig();

  /**
   * Translate Neotree diagnoses to FHIR Condition resources
   */
  translate(
    data: NeotreePatientData,
    patientReference: string,
    encounterReference?: string
  ): FHIRCondition[] {
    try {
      logger.debug({ uid: data.uid }, 'Translating conditions to FHIR');

      const conditions: FHIRCondition[] = [];

      // Process each diagnosis
      data.diagnoses.forEach((diagnosis, index) => {
        if (diagnosis && diagnosis.trim() !== '') {
          conditions.push(
            this.buildCondition(
              data,
              patientReference,
              encounterReference,
              diagnosis,
              index
            )
          );
        }
      });

      logger.debug(
        { uid: data.uid, count: conditions.length },
        'Condition resources translated successfully'
      );
      return conditions;
    } catch (error) {
      logger.error({ error, uid: data.uid }, 'Failed to translate condition data');
      throw new TransformationError('Failed to translate condition data to FHIR', {
        uid: data.uid,
        error: String(error),
      });
    }
  }

  /**
   * Build a single condition resource
   */
  private buildCondition(
    data: NeotreePatientData,
    patientReference: string,
    encounterReference: string | undefined,
    diagnosis: string,
    index: number
  ): FHIRCondition {
    const condition: FHIRCondition = {
      resourceType: 'Condition',
      meta: {
        source: `${this.config.source.id}/${this.config.source.facilityId}`,
      },
      identifier: [
        {
          system: `urn:oid:${this.config.source.facilityId}:neotree:condition`,
          value: `condition-${data.uniqueKey}-${index}`,
        },
      ],
      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: data.dischargeDateTime ? 'resolved' : 'active',
            display: data.dischargeDateTime ? 'Resolved' : 'Active',
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: 'confirmed',
            display: 'Confirmed',
          },
        ],
      },
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-category',
              code: 'encounter-diagnosis',
              display: 'Encounter Diagnosis',
            },
          ],
        },
      ],
      code: this.buildConditionCode(diagnosis),
      subject: {
        reference: patientReference,
      },
      onsetDateTime: data.admissionDateTime
        ? new Date(data.admissionDateTime).toISOString()
        : data.dateOfBirth
        ? new Date(data.dateOfBirth).toISOString()
        : undefined,
      recordedDate: data.admissionDateTime
        ? new Date(data.admissionDateTime).toISOString()
        : undefined,
    };

    if (encounterReference) {
      condition.encounter = {
        reference: encounterReference,
      };
    }

    if (data.dischargeDateTime) {
      condition.abatementDateTime = new Date(data.dischargeDateTime).toISOString();
    }

    return condition;
  }

  /**
   * Build condition code
   * In a production system, you would map these to SNOMED CT or ICD-10 codes
   */
  private buildConditionCode(diagnosis: string): CodeableConcept {
    // Map common neonatal diagnoses to SNOMED CT codes
    const diagnosisMap: Record<string, { code: string; display: string }> = {
      'Macrosomia (>4000g)': {
        code: '237364002',
        display: 'Macrosomia',
      },
      'Respiratory Distress Syndrome': {
        code: '38368003',
        display: 'Respiratory distress syndrome in the newborn',
      },
      'Neonatal Jaundice': {
        code: '387712008',
        display: 'Neonatal jaundice',
      },
      'Hypoglycemia': {
        code: '302866003',
        display: 'Hypoglycemia',
      },
      'Prematurity': {
        code: '395507008',
        display: 'Premature infant',
      },
      'Low Birth Weight': {
        code: '276610007',
        display: 'Low birth weight',
      },
    };

    const mappedCode = diagnosisMap[diagnosis];

    if (mappedCode) {
      return {
        coding: [
          {
            system: 'http://snomed.info/sct',
            code: mappedCode.code,
            display: mappedCode.display,
          },
        ],
        text: diagnosis,
      };
    }

    // If no mapping found, use text only
    return {
      text: diagnosis,
    };
  }
}
