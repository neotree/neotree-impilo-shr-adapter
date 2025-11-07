import { NeotreeEntry } from '../../shared/types/neotree.types';
import { FHIRBundle } from '../../shared/types/fhir.types';
import { mapNeotreeToPatientData } from '../mappers/neotree-mapper';
import { PatientTranslator } from '../translators/patient-translator';
import { BundleBuilder } from './bundle-builder';
import { OpenHIMClient } from '../clients/openhim-client';
import { getLogger } from '../../shared/utils/logger';
import { handleError } from '../../shared/utils/errors';
import { validateAllResources } from '../utils/validation';
import { DuplicateDetectionService } from './duplicate-detection-service';
import { MissingDataHandler } from './missing-data-handler';

const logger = getLogger('adapter-service');

export class AdapterService {
  private openhimClient: OpenHIMClient;
  private patientTranslator: PatientTranslator;
  private duplicateDetection: DuplicateDetectionService;
  private missingDataHandler: MissingDataHandler;

  constructor() {
    this.openhimClient = new OpenHIMClient();
    this.patientTranslator = new PatientTranslator();
    this.duplicateDetection = new DuplicateDetectionService();
    this.missingDataHandler = new MissingDataHandler();
  }

  async processEntry(entry: NeotreeEntry, syncId?: string): Promise<FHIRBundle> {
    try {
      if (!entry.script) {
        throw new Error(`Missing script data for entry ${entry.uid}`);
      }

      const patientData = mapNeotreeToPatientData(entry);
      const validation = validateAllResources(patientData);

      if (!validation.canProceed) {
        throw new Error(
          `Validation failed: missing required fields [${validation.patient.missingFields.join(', ')}]`
        );
      }

      const patient = this.patientTranslator.translate(patientData);

      // Check missing data
      const missingDataReport = this.missingDataHandler.analyzeMissingData(patient, entry.uid);
      if (!missingDataReport.canProceed) {
        throw new Error(
          `Critical fields missing: [${missingDataReport.criticalFieldsMissing.join(', ')}]`
        );
      }

      // Check for duplicates
      const searchParams: Record<string, string> = {};
      if (patient.identifier?.[0]?.value) {
        searchParams.identifier = `${patient.identifier[0].system}|${patient.identifier[0].value}`;
      }
      if (patient.birthDate) {
        searchParams.birthdate = patient.birthDate;
      }

      let finalPatient = patient;
      let isUpdate = false;

      if (Object.keys(searchParams).length > 0) {
        try {
          const searchResults = await this.openhimClient.searchPatients(searchParams);
          const duplicates = await this.duplicateDetection.findPotentialDuplicates(
            patient,
            searchResults
          );

          if (duplicates.length > 0) {
            const match = duplicates[0];
            if (match.score.matchLevel === 'auto-match') {
              logger.info(
                { uid: entry.uid, matchScore: match.score.totalScore, existingPatientId: match.patient.id },
                'Auto-match found - updating existing patient'
              );
              finalPatient = this.missingDataHandler.mergePatientData(patient, match.patient);
              finalPatient.id = match.patient.id;
              isUpdate = true;
            } else if (match.score.matchLevel === 'potential-match') {
              logger.warn(
                { uid: entry.uid, matchScore: match.score.totalScore, existingPatientId: match.patient.id },
                'Potential duplicate - creating new patient'
              );
            }
          }
        } catch (error) {
          logger.warn({ uid: entry.uid, error: error instanceof Error ? error.message : String(error) },
            'Duplicate search failed - creating new patient');
        }
      }

      const fhirBundle = BundleBuilder.createTransactionBundle(finalPatient);
      const response = await this.openhimClient.sendBundle(fhirBundle);

      logger.info({ uid: entry.uid, action: isUpdate ? 'updated' : 'created' }, 'Processed entry');

      return response;
    } catch (error) {
      throw handleError(error, logger, { uid: entry.uid, syncId });
    }
  }

  async testConnections(): Promise<{ openhim: boolean }> {
    try {
      const openhim = await this.openhimClient.testConnection();
      return { openhim };
    } catch {
      return { openhim: false };
    }
  }
}
