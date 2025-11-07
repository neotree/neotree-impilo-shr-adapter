/**
 * FHIR Observation Resource Translator
 * Transforms vital signs and measurements to FHIR Observation resources
 */

import type {
  FHIRObservation,
} from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
import { extractVitalSigns, extractBodyMeasurements } from '../mappers/neotree-mapper';
import { getConfig } from '../../shared/config';
import { getLogger } from '../../shared/utils/logger';
import { TransformationError } from '../../shared/utils/errors';

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

  /**
   * Translate Neotree data to FHIR Observation resources
   */
  translate(
    data: NeotreePatientData,
    patientReference: string,
    encounterReference?: string
  ): FHIRObservation[] {
    try {
      logger.debug({ uid: data.uid }, 'Translating observations to FHIR');

      const observations: FHIRObservation[] = [];

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
              data.admissionDateTime || data.dateOfBirth
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
              data.dateOfBirth
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
            data.apgar1
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
            data.apgar5
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
            data.apgar10
          )
        );
      }

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
    effectiveDateTime?: string
  ): FHIRObservation {
    const observation: FHIRObservation = {
      resourceType: 'Observation',
      meta: {
        // source: `${this.config.source.id}/${this.config.source.facilityId}`,
      },
      identifier: [
        {
          system: `urn:oid:${this.config.source.facilityId}:neotree:observation`,
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
    score: number
  ): FHIRObservation {
    const observation: FHIRObservation = {
      resourceType: 'Observation',
      meta: {
        source: `${this.config.source.id}/${this.config.source.facilityId}`,
      },
      identifier: [
        {
          system: `urn:oid:${this.config.source.facilityId}:neotree:observation`,
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
      effectiveDateTime: data.dateOfBirth
        ? this.calculateApgarTime(data.dateOfBirth, minutes)
        : undefined,
      valueQuantity: {
        value: score,
        unit: APGAR_SCORE_CODE.unit,
        system: 'http://unitsofmeasure.org',
        code: APGAR_SCORE_CODE.ucumCode,
      },
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
}
