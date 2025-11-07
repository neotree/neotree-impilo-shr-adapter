/**
 * FHIR Encounter Resource Translator
 * Transforms Neotree admission/discharge data to FHIR Encounter resource
 */

import type {
  FHIREncounter,
  Reference,
  CodeableConcept,
  Coding,
  Period,
  Identifier,
} from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
import { getConfig } from '../../shared/config';
import { getLogger } from '../../shared/utils/logger';
import { TransformationError } from '../../shared/utils/errors';

const logger = getLogger('encounter-translator');

export class EncounterTranslator {
  private config = getConfig();

  /**
   * Translate Neotree data to FHIR Encounter resource
   */
  translate(data: NeotreePatientData, patientReference: string): FHIREncounter {
    try {
      logger.debug({ uid: data.uid }, 'Translating encounter data to FHIR');

      const encounter: FHIREncounter = {
        resourceType: 'Encounter',
        meta: {
          source: `${this.config.source.id}/${this.config.source.facilityId}`,
        },
        identifier: this.buildIdentifiers(data),
        status: this.determineStatus(data),
        class: this.buildEncounterClass(),
        type: this.buildEncounterType(data),
        subject: {
          reference: patientReference,
          display: this.buildPatientDisplay(data),
        },
        period: this.buildPeriod(data),
        reasonCode: this.buildReasonCodes(data),
        serviceProvider: this.buildServiceProvider(),
      };

      logger.debug({ uid: data.uid }, 'Encounter resource translated successfully');
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
   */
  private buildIdentifiers(data: NeotreePatientData): Identifier[] {
    return [
      {
        use: 'official',
        system: `urn:oid:${this.config.source.facilityId}:neotree:encounter`,
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
   */
  private buildEncounterType(_data: NeotreePatientData): CodeableConcept[] {
    const types: CodeableConcept[] = [];

    // Neonatal encounter
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

    return types;
  }

  /**
   * Build encounter period
   */
  private buildPeriod(data: NeotreePatientData): Period | undefined {
    if (!data.admissionDateTime && !data.dischargeDateTime) {
      return undefined;
    }

    const period: Period = {};

    if (data.admissionDateTime) {
      period.start = new Date(data.admissionDateTime).toISOString();
    }

    if (data.dischargeDateTime) {
      period.end = new Date(data.dischargeDateTime).toISOString();
    }

    return period;
  }

  /**
   * Build reason codes (admission reason)
   */
  private buildReasonCodes(data: NeotreePatientData): CodeableConcept[] | undefined {
    if (!data.admissionReason && data.diagnoses.length === 0) {
      return undefined;
    }

    const reasons: CodeableConcept[] = [];

    if (data.admissionReason) {
      reasons.push({
        text: data.admissionReason,
      });
    }

    return reasons.length > 0 ? reasons : undefined;
  }

  /**
   * Build service provider reference
   */
  private buildServiceProvider(): Reference {
    return {
      reference: `Organization/${this.config.source.facilityId}`,
      display: this.config.source.facilityName,
    };
  }

  /**
   * Build patient display name
   */
  private buildPatientDisplay(data: NeotreePatientData): string {
    const nameParts: string[] = [];
    if (data.babyFirstName) nameParts.push(data.babyFirstName);
    if (data.babyLastName) nameParts.push(data.babyLastName);

    if (nameParts.length > 0) {
      return nameParts.join(' ');
    }

    return `Patient ${data.uid}`;
  }
}
