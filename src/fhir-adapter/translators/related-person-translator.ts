/**
 * FHIR RelatedPerson Resource Translator
 * Transforms mother data to FHIR RelatedPerson resource
 */

import type {
  FHIRRelatedPerson,
  HumanName,
  Identifier,
  CodeableConcept,
} from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
import { getConfig } from '../../shared/config';
import { getLogger } from '../../shared/utils/logger';
import { TransformationError } from '../../shared/utils/errors';

const logger = getLogger('related-person-translator');

export class RelatedPersonTranslator {
  private config = getConfig();

  /**
   * Translate Neotree mother data to FHIR RelatedPerson resource
   */
  translate(data: NeotreePatientData, patientReference: string): FHIRRelatedPerson | null {
    if (!data.motherFirstName && !data.motherSurname) {
      logger.debug({ uid: data.uid }, 'No mother information available, skipping RelatedPerson');
      return null;
    }

    try {
      logger.debug({ uid: data.uid }, 'Translating mother data to FHIR RelatedPerson');

      const relatedPerson: FHIRRelatedPerson = {
        resourceType: 'RelatedPerson',
        meta: {
          source: `${this.config.source.id}/${this.config.source.facilityId}`,
        },
        identifier: this.buildIdentifiers(data),
        active: true,
        patient: {
          reference: patientReference,
          display: this.buildBabyDisplay(data),
        },
        relationship: [this.buildMotherRelationship()],
        name: this.buildNames(data),
        gender: 'female',
      };

      logger.debug({ uid: data.uid }, 'RelatedPerson resource translated successfully');
      return relatedPerson;
    } catch (error) {
      logger.error({ error, uid: data.uid }, 'Failed to translate mother data');
      throw new TransformationError('Failed to translate mother data to FHIR', {
        uid: data.uid,
        error: String(error),
      });
    }
  }

  /**
   * Build mother identifiers
   */
  private buildIdentifiers(data: NeotreePatientData): Identifier[] {
    const identifiers: Identifier[] = [];

    // Mother identifier based on baby's UID
    identifiers.push({
      use: 'official',
      type: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
            code: 'U',
            display: 'Unspecified identifier',
          },
        ],
        text: 'Mother Identifier',
      },
      system: `http://health.gov.zw/fhir/identifiers/${this.config.source.facilityId}/mother`,
      value: `mother-of-${data.uid}`,
    });

    return identifiers;
  }

  /**
   * Build mother relationship
   */
  private buildMotherRelationship(): CodeableConcept {
    return {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
          code: 'MTH',
          display: 'mother',
        },
      ],
      text: 'Mother',
    };
  }

  /**
   * Build mother names
   */
  private buildNames(data: NeotreePatientData): HumanName[] {
    const names: HumanName[] = [];

    const name: HumanName = {
      use: 'official',
    };

    if (data.motherSurname) {
      name.family = data.motherSurname;
    }

    if (data.motherFirstName) {
      name.given = [data.motherFirstName];
    }

    // Build text representation
    const nameParts: string[] = [];
    if (data.motherFirstName) nameParts.push(data.motherFirstName);
    if (data.motherSurname) nameParts.push(data.motherSurname);
    if (nameParts.length > 0) {
      name.text = nameParts.join(' ');
    }

    names.push(name);
    return names;
  }

  /**
   * Build baby display name for reference
   */
  private buildBabyDisplay(data: NeotreePatientData): string {
    const nameParts: string[] = [];
    if (data.babyFirstName) nameParts.push(data.babyFirstName);
    if (data.babyLastName) nameParts.push(data.babyLastName);

    if (nameParts.length > 0) {
      return nameParts.join(' ');
    }

    return `Patient ${data.uid}`;
  }
}
