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
import { v4 as uuidv4 } from 'uuid';
import { TransformationError } from '../../shared/utils/errors';
import { getLogger } from '../../shared/utils/logger';

const logger = getLogger('patient-translator');

export class PatientTranslator {
  translate(data: NeotreePatientData, facilityId?: string): FHIRPatient {
    try {
      logger.debug({ uid: data.uid }, 'Translating patient to FHIR');
      const resolvedFacilityId = facilityId;
      const patient: FHIRPatient = {
        resourceType: 'Patient',
        identifier: this.buildIdentifiers(data),
        name: this.buildNames(data),
        gender: (data.gender as 'male' | 'female' | 'other' | 'unknown') || 'unknown',
        birthDate: this.extractDate(data.dateOfBirth),
      };

      if (resolvedFacilityId) {
        patient.meta = {
          tag: [
            {
              system: 'http://openclientregistry.org/fhir/clientid',
              code: resolvedFacilityId,
            },
          ],
        };
        patient.managingOrganization = {
          reference: `Organization/${resolvedFacilityId}`,
        };
      }

      if (!patient.birthDate) {
        delete patient.birthDate;
      }

      // Add maternal information as extensions (for CR persistence, will be reference in SHR)
      this.addMaternalExtensions(patient, data);

      logger.info(
        { uid: data.uid, facilityId, identifierCount: patient.identifier?.length },
        'Patient resource translated successfully'
      );

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
   * Priority order (per FHIR mapping documentation):
   * 1. Primary: impilo_id (decrypted) → urn:neotree:impilo-id
   * 2. Secondary: person_id → urn:impilo:person-id (UUID)
   * 3. Tertiary: impilo_uid → urn:impilo:uid (UUID)
   *    - If impilo_uid is missing or invalid, generate a UUID
   *    - If person_id is missing or invalid, generate a UUID (distinct from impilo_uid)
   */
  private buildIdentifiers(data: NeotreePatientData): Identifier[] {
    const identifiers: Identifier[] = [];

    // Primary identifier: Impilo ID (from DB), fallback to Neotree UID
    identifiers.push({
      system: 'urn:neotree:impilo-id',
      value: data.impilo_id || data.uid,
    });

    const impiloUid = this.ensureUuid(data.impilo_uid);
    data.impilo_uid = impiloUid;
    let personId = this.ensureUuid(data.person_id);
    if (personId === impiloUid) {
      personId = uuidv4();
    }
    data.person_id = personId;

    identifiers.push({
      system: 'urn:impilo:person-id',
      value: personId,
    });
    identifiers.push({
      system: 'urn:impilo:uid',
      value: impiloUid,
    });

    return identifiers;
  }

  private ensureUuid(value?: string): string {
    if (value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return value;
    }
    return uuidv4();
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

  /**
   * Add maternal information as extensions to Patient resource
   * Stores key maternal data that informs interpretation of baby's clinical data
   * Note: Mother's identifiable information (name, DOB) is stored in RelatedPerson
   */
  private addMaternalExtensions(patient: FHIRPatient, data: NeotreePatientData): void {
    const extensions: any[] = [];

    // Maternal age at delivery
    if (data.motherAgeYears !== undefined && data.motherAgeYears !== null) {
      extensions.push({
        url: 'http://hl7.org/fhir/StructureDefinition/patient-maternalAge',
        valueQuantity: {
          value: data.motherAgeYears,
          unit: 'years',
          system: 'http://unitsofmeasure.org',
          code: 'a',
        },
      });
    }

    // Maternal HIV status (critical for PMTCT interpretation)
    if (data.motherHIVStatus) {
      extensions.push({
        url: 'http://hl7.org/fhir/StructureDefinition/patient-motherHIVStatus',
        valueCodeableConcept: {
          coding: [
            {
              system: 'http://snomed.info/sct',
              code: data.motherHIVStatus === 'Positive' ? '165816005' : '165815004',
              display: data.motherHIVStatus,
            },
          ],
        },
      });
    }

    // Gestational age (critical for prematurity interpretation)
    if (data.gestation !== undefined && data.gestation !== null) {
      extensions.push({
        url: 'http://hl7.org/fhir/StructureDefinition/patient-maternalGestationalAge',
        valueQuantity: {
          value: data.gestation,
          unit: 'weeks',
          system: 'http://unitsofmeasure.org',
          code: 'wk',
        },
      });
    }

    // Mode of delivery (affects risk of complications)
    if (data.modeOfDelivery) {
      extensions.push({
        url: 'http://hl7.org/fhir/StructureDefinition/patient-modeOfDelivery',
        valueCodeableConcept: {
          coding: [
            {
              system: 'http://snomed.info/sct',
              code: data.modeOfDelivery,
              display: data.modeOfDelivery,
            },
          ],
        },
      });
    }

    // Apgar scores (important baseline status indicators)
    if (data.apgar1 !== undefined && data.apgar1 !== null) {
      extensions.push({
        url: 'http://hl7.org/fhir/StructureDefinition/patient-apgarScore1Minute',
        valueInteger: data.apgar1,
      });
    }
    if (data.apgar5 !== undefined && data.apgar5 !== null) {
      extensions.push({
        url: 'http://hl7.org/fhir/StructureDefinition/patient-apgarScore5Minute',
        valueInteger: data.apgar5,
      });
    }

    // Add extensions to patient if any were created
    if (extensions.length > 0) {
      (patient as any).extension = extensions;
      logger.debug(
        { uid: data.uid, extensionCount: extensions.length },
        'Added maternal information extensions to Patient'
      );
    }
  }
}
