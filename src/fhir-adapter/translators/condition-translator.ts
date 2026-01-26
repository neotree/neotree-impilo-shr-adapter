/**
 * FHIR Condition Resource Translator
 * Transforms diagnoses to FHIR Condition resources
 */

import type {
  FHIRCondition,
  CodeableConcept,
} from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
import { getLogger } from '../../shared/utils/logger';
import { TransformationError } from '../../shared/utils/errors';

const logger = getLogger('condition-translator');

export class ConditionTranslator {

  /**
   * Translate Neotree diagnoses to FHIR Condition resources
   */
  translate(
    data: NeotreePatientData,
    patientReference: string,
    encounterReference?: string,
    facilityId?: string,
    sourceId?: string
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
              index,
              facilityId,
              sourceId
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(
        { error: errorMessage, stack: errorStack, uid: data.uid },
        'Failed to translate condition data'
      );
      throw new TransformationError('Failed to translate condition data to FHIR', {
        uid: data.uid,
        error: errorMessage,
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
    index: number,
    facilityId?: string,
    sourceId?: string
  ): FHIRCondition {
    const conditionId = this.generateConditionId(data.uid, diagnosis, index);
    const condition: FHIRCondition = {
      resourceType: 'Condition',
      id: conditionId,
      meta: sourceId
        ? {
            source: facilityId ? `${sourceId}/${facilityId}` : sourceId,
          }
        : undefined,
      identifier: [
        {
          system: facilityId ? `urn:oid:${facilityId}:neotree:condition` : undefined,
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
