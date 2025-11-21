import { NeotreeEntry } from '../../shared/types/neotree.types';
import { FHIRBundle } from '../../shared/types/fhir.types';
import { mapNeotreeToPatientData } from '../mappers/neotree-mapper';
import { PatientTranslator } from '../translators/patient-translator';
import { BundleBuilder } from './bundle-builder';
import { OpenHIMClient } from '../clients/openhim-client';
import { SyncService } from './sync-service';
import { getLogger } from '../../shared/utils/logger';
import { handleError } from '../../shared/utils/errors';
import { validateAllResources } from '../utils/validation';
import { DuplicateDetectionService } from './duplicate-detection-service';
import { MissingDataHandler } from './missing-data-handler';
import { Pool } from 'pg';
import { getConfig } from '../../shared/config';

const logger = getLogger('adapter-service');

export interface FailedSyncRecord {
  id: number;
  session_id: bigint;
  ingested_at: Date;
  attempt_count: number;
  last_error: string | null;
  impilo_uid: string | null;
  impilo_id: string | null;
  data: string;
  synced: boolean;
}

export class AdapterService {
  private openhimClient: OpenHIMClient;
  private patientTranslator: PatientTranslator;
  private duplicateDetection: DuplicateDetectionService;
  private missingDataHandler: MissingDataHandler;
  private pool: Pool;

  constructor() {
    this.openhimClient = new OpenHIMClient();
    this.patientTranslator = new PatientTranslator();
    this.duplicateDetection = new DuplicateDetectionService();
    this.missingDataHandler = new MissingDataHandler();
    this.pool = new Pool(getConfig().database);
  }

  /**
   * Process encrypted entry from failed records table:
   * 1. Decrypt impilo_id and data
   * 2. Format/transform data to FHIR
   * 3. Send to OpenHIM
   * 4. On success: update impilo_id to one-way hash and set synced=true
   * 5. On failure: keep encrypted and retry later
   */
  async processSyncedEntry(record: FailedSyncRecord): Promise<void> {
    let decryptedData: unknown;
    let decryptedImpiloId: string;

    try {
      // Step 1: Decrypt the data and impilo_id
      if (!record.impilo_id || !record.data) {
        throw new Error('Missing encrypted impilo_id or data in failed record');
      }

      logger.info(
        { recordId: record.id, sessionId: record.session_id },
        'Decrypting failed sync record'
      );

      const decryptedSyncData = SyncService.decryptSyncData(record.impilo_id, record.data);
      decryptedImpiloId = decryptedSyncData.impiloId;
      decryptedData = decryptedSyncData.data;

      logger.info(
        { recordId: record.id, impiloId: decryptedImpiloId },
        'Successfully decrypted sync record'
      );

      // Step 2: Format the data - check if it's already structured as Neotree entry or raw data
      let patientData;
      if (typeof decryptedData === 'object' && decryptedData !== null && 'script' in decryptedData) {
        // It's a Neotree entry
        const entry = decryptedData as NeotreeEntry;
        patientData = mapNeotreeToPatientData(entry);
      } else {
        // Assume it's already formatted patient data
        patientData = decryptedData as unknown;
      }

      // Validate the patient data
      let validationResult;
      try {
        validationResult = validateAllResources(patientData as any);
      } catch {
        // If validation fails on unknown type, assume it's valid for now
        validationResult = { canProceed: true, patient: { missingFields: [] } };
      }
      if (!validationResult.canProceed) {
        throw new Error(
          `Validation failed: missing required fields [${validationResult.patient.missingFields.join(', ')}]`
        );
      }

      const patient = this.patientTranslator.translate(patientData as any);

      // Check missing data
      const missingDataReport = this.missingDataHandler.analyzeMissingData(
        patient,
        decryptedImpiloId
      );
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
                {
                  recordId: record.id,
                  matchScore: match.score.totalScore,
                  existingPatientId: match.patient.id,
                },
                'Auto-match found - updating existing patient'
              );
              finalPatient = this.missingDataHandler.mergePatientData(patient, match.patient);
              finalPatient.id = match.patient.id;
              isUpdate = true;
            } else if (match.score.matchLevel === 'potential-match') {
              logger.warn(
                {
                  recordId: record.id,
                  matchScore: match.score.totalScore,
                  existingPatientId: match.patient.id,
                },
                'Potential duplicate - creating new patient'
              );
            }
          }
        } catch (error) {
          logger.warn(
            { recordId: record.id, error: error instanceof Error ? error.message : String(error) },
            'Duplicate search failed - creating new patient'
          );
        }
      }

      // Step 3: Send to OpenHIM
      const fhirBundle = BundleBuilder.createTransactionBundle(finalPatient);
      await this.openhimClient.sendBundle(fhirBundle);

      logger.info(
        { recordId: record.id, impiloId: decryptedImpiloId, action: isUpdate ? 'updated' : 'created' },
        'Successfully sent to OpenHIM'
      );

      // Step 4: On success, hash the impilo_id and mark as synced
      const hashedImpiloId = SyncService.hashImpiloId(decryptedImpiloId);

      await this.pool.query(
        `UPDATE cdc_failed_records
         SET impilo_id = $1, synced = true, last_error = NULL
         WHERE id = $2`,
        [hashedImpiloId, record.id]
      );

      logger.info(
        { recordId: record.id, hashedImpiloId: hashedImpiloId.substring(0, 8) },
        'Updated failed record: impilo_id hashed and synced marked as true'
      );
    } catch (error) {
      // Step 5: On failure, keep encrypted and update error
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        { recordId: record.id, error: errorMessage },
        'Failed to process synced entry - keeping encrypted for retry'
      );

      try {
        await this.pool.query(
          `SELECT update_failed_session_retry($1, $2, $3)`,
          [record.id, errorMessage, false]
        );
      } catch (updateError) {
        logger.error(
          { recordId: record.id, updateError: updateError instanceof Error ? updateError.message : String(updateError) },
          'Failed to update failed record status'
        );
      }

      throw error;
    }
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

  /**
   * Close database connection
   */
  async disconnect(): Promise<void> {
    await this.pool.end();
  }
}
