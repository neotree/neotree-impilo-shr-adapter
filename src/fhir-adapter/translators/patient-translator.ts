/**
 * FHIR Patient Resource Translator
 * Transforms Neotree patient data to FHIR Patient resource
 */

import type {
  FHIRPatient,
  HumanName,
  Identifier,
} from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
import { getConfig } from '../../shared/config';
import { TransformationError } from '../../shared/utils/errors';

export class PatientTranslator {
  private config = getConfig();

  translate(data: NeotreePatientData): FHIRPatient {
    try {
      const patient: FHIRPatient = {
        resourceType: 'Patient',
        meta: {
          tag: [
            {
              system: 'http://openclientregistry.org/fhir/clientid',
              code: this.config.source.facilityId,
            },
          ],
        },
        identifier: this.buildIdentifiers(data),
        name: this.buildNames(data),
        gender: (data.gender as 'male' | 'female' | 'other' | 'unknown') || 'unknown',
        birthDate: this.extractDate(data.dateOfBirth),
        managingOrganization: {
          reference: `Organization/${this.config.source.facilityId}`,
        },
      };

      if (!patient.birthDate) {
        delete patient.birthDate;
      }

      return patient;
    } catch (error) {
      throw new TransformationError('Translation failed', {
        uid: data.uid,
        error: String(error),
      });
    }
  }

  /**
   * Build patient identifiers
   */
  private buildIdentifiers(data: NeotreePatientData): Identifier[] {
    const identifiers: Identifier[] = [];

    // Primary identifier: Neotree Patient ID
    identifiers.push({
      system: 'urn:neotree:impilo-id',
      value: data.uid,
    });

    // Secondary identifier: Impilo UID (UUID)
    if (data.impilo_uid) {
      identifiers.push({
        system: 'urn:impilo:uid',
        value: data.impilo_uid,
      });
    }

    return identifiers;
  }

  /**
   * Build patient names
   */
  private buildNames(data: NeotreePatientData): HumanName[] {
    const names: HumanName[] = [];

    if (data.babyFirstName || data.babyLastName) {
      const name: HumanName = {
        use: 'official',
      };

      if (data.babyLastName) {
        name.family = data.babyLastName;
      }

      if (data.babyFirstName) {
        name.given = [data.babyFirstName];
      }

      names.push(name);
    }

    // If no name is available, create a temporary name with baby of mother
    if (names.length === 0 && data.motherFirstName) {
      names.push({
        use: 'temp',
        family: data.motherFirstName,
      });
    }

    // If still no name, use UID as fallback (required by FHIR - cannot have empty array)
    if (names.length === 0) {
      names.push({
        use: 'temp',
        family: data.uid,
      });
    }

    return names;
  }

  private extractDate(isoString: string | undefined): string | undefined {
    if (!isoString) return undefined;

    try {
      const date = new Date(isoString);
      return date.toISOString().split('T')[0];
    } catch {
      return undefined;
    }
  }
}
