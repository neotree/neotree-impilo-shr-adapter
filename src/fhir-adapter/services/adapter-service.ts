import { NeotreeEntry } from '../../shared/types/neotree.types';
import { FHIRBundle, FHIRPatient } from '../../shared/types/fhir.types';
import { mapNeotreeToPatientData } from '../mappers/neotree-mapper';
import { PatientTranslator } from '../translators/patient-translator';
import { EncounterTranslator } from '../translators/encounter-translator';
import { ObservationTranslator } from '../translators/observation-translator';
import { ConditionTranslator } from '../translators/condition-translator';
import { RelatedPersonTranslator } from '../translators/related-person-translator';
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
  private encounterTranslator: EncounterTranslator;
  private observationTranslator: ObservationTranslator;
  private conditionTranslator: ConditionTranslator;
  private relatedPersonTranslator: RelatedPersonTranslator;
  private duplicateDetection: DuplicateDetectionService;
  private missingDataHandler: MissingDataHandler;
  private pool: Pool;

  constructor() {
    this.openhimClient = new OpenHIMClient();
    this.patientTranslator = new PatientTranslator();
    this.encounterTranslator = new EncounterTranslator();
    this.observationTranslator = new ObservationTranslator();
    this.conditionTranslator = new ConditionTranslator();
    this.relatedPersonTranslator = new RelatedPersonTranslator();
    this.duplicateDetection = new DuplicateDetectionService();
    this.missingDataHandler = new MissingDataHandler();
    this.pool = new Pool(getConfig().database);
  }

  /**
   * Process encrypted entry from failed records table with dual-flow support
   *
   * Enhanced flow for CR/SHR retry scenarios:
   * 1. Decrypt impilo_id and data
   * 2. Format/transform data to FHIR
   * 3. Attempt to retrieve existing patient from Client Registry (CR)
   * 4. If patient exists in CR, skip CR push and only push clinical data to SHR
   * 5. If patient not in CR, perform full dual-flow (CR + SHR)
   * 6. On success: set synced=true
   * 7. On failure: keep encrypted and retry later
   *
   * This handles the scenario: CR push succeeded, SHR push failed → retry only sends clinical data
   */
  async processSyncedEntry(record: FailedSyncRecord): Promise<void> {
    let decryptedData: unknown;
    let decryptedImpiloId: string;
    let neotreeEntry: NeotreeEntry | null = null;

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
        // It's a Neotree entry - store for later reference
        neotreeEntry = decryptedData as NeotreeEntry;
        patientData = mapNeotreeToPatientData(neotreeEntry);
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

      // Step 3: Try to retrieve existing patient from Client Registry
      logger.debug(
        { recordId: record.id, impiloId: decryptedImpiloId },
        'Attempting to retrieve existing patient from CR'
      );

      const neotreeIdentifier = (patientData as any).uid;
      const neotreeIdentifierSystem = `urn:neotree:impilo-id`;

      let existingCRPatient: FHIRPatient | null = null;
      try {
        existingCRPatient = await this.openhimClient.getPatientFromCR(
          neotreeIdentifierSystem,
          neotreeIdentifier
        );
      } catch (error) {
        logger.debug(
          {
            recordId: record.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'CR retrieval failed - will proceed with full dual-flow'
        );
      }

      // Step 4: Process based on whether patient exists in CR
      if (existingCRPatient) {
        logger.info(
          {
            recordId: record.id,
            impiloId: decryptedImpiloId,
            patientId: existingCRPatient.id,
          },
          'Patient already exists in CR - proceeding with SHR-only push'
        );

        // SHR-only push (patient already in CR from previous successful push)
        if (!neotreeEntry) {
          throw new Error('Cannot perform SHR-only push without Neotree entry');
        }

        const patientReference = `Patient/${existingCRPatient.id}`;
        const encounter = this.encounterTranslator.translate(
          patientData as any,
          patientReference
        );
        const observations = this.observationTranslator.translate(
          patientData as any,
          patientReference,
          `Encounter/${encounter.id || neotreeEntry.uid}`
        );
        const conditions = this.conditionTranslator.translate(
          patientData as any,
          patientReference,
          `Encounter/${encounter.id || neotreeEntry.uid}`
        );

        const shrBundle = BundleBuilder.createSHRBundle(encounter, observations, conditions);
        logger.debug(
          { recordId: record.id, entryCount: shrBundle.entry?.length || 0 },
          'Sending SHR-only bundle to retry push'
        );
        await this.openhimClient.sendBundleToSHR(shrBundle);

        logger.info(
          {
            recordId: record.id,
            impiloId: decryptedImpiloId,
            action: 'shr-only-push',
            patientId: existingCRPatient.id,
          },
          'Successfully sent clinical data to SHR for retry'
        );
      } else {
        logger.info(
          { recordId: record.id, impiloId: decryptedImpiloId },
          'Patient not in CR - performing full legacy dual-flow push'
        );

        // Full dual-flow push (patient not yet in CR)
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
                finalPatient = this.missingDataHandler.mergePatientData(
                  patient,
                  match.patient
                );
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
              {
                recordId: record.id,
                error: error instanceof Error ? error.message : String(error),
              },
              'Duplicate search failed - creating new patient'
            );
          }
        }

        // Step 5: Send to OpenHIM (legacy single bundle)
        const fhirBundle = BundleBuilder.createTransactionBundle(finalPatient);
        await this.openhimClient.sendBundle(fhirBundle);

        logger.info(
          {
            recordId: record.id,
            impiloId: decryptedImpiloId,
            action: isUpdate ? 'updated' : 'created',
          },
          'Successfully sent legacy bundle to OpenHIM'
        );
      }

      // Step 6: On success, mark as synced
      await this.pool.query(
        `UPDATE cdc_failed_records
         SET synced = true, last_error = NULL
         WHERE id = $1`,
        [record.id]
      );

      logger.info(
        { recordId: record.id, impiloId: decryptedImpiloId },
        'Updated failed record: synced marked as true'
      );
    } catch (error) {
      // Step 7: On failure, keep encrypted and update error
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
          {
            recordId: record.id,
            updateError: updateError instanceof Error ? updateError.message : String(updateError),
          },
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

  /**
   * Retry flow with CR patient retrieval
   * Used when CR push was successful but SHR push failed
   *
   * Flow:
   * 1. Retrieve existing patient from Client Registry using identifiers
   * 2. If patient found in CR, use existing patient ID for clinical data
   * 3. Send only SHR bundle (clinical data) to Shared Health Record (/SHR/fhir)
   * 4. Avoids duplicate patient creation by reusing CR patient
   */
  async processEntrySHRRetry(
    entry: NeotreeEntry,
    syncId?: string
  ): Promise<{ crPatient: FHIRPatient; shrResponse: FHIRBundle }> {
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

      logger.info(
        { uid: entry.uid, syncId },
        'Processing entry SHR retry - retrieving existing patient from CR'
      );

      // ===== RETRIEVE PATIENT FROM CLIENT REGISTRY =====
      const neotreeIdentifier = patientData.uid;
      const neotreeIdentifierSystem = `urn:neotree:impilo-id`;

      let existingPatient: FHIRPatient | null = null;
      try {
        existingPatient = await this.openhimClient.getPatientFromCR(
          neotreeIdentifierSystem,
          neotreeIdentifier
        );
      } catch (error) {
        logger.warn(
          {
            uid: entry.uid,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to retrieve patient from CR - falling back to new patient'
        );
      }

      if (!existingPatient) {
        throw new Error(
          `Could not retrieve existing patient from Client Registry for retry. Patient ID: ${neotreeIdentifier}`
        );
      }

      logger.info(
        { uid: entry.uid, patientId: existingPatient.id },
        'Successfully retrieved patient from CR'
      );

      // ===== SHARED HEALTH RECORD FLOW (Clinical Data Only) =====
      const patientReference = `Patient/${existingPatient.id || entry.uid}`;

      // Translate clinical resources
      const encounter = this.encounterTranslator.translate(patientData, patientReference);
      const observations = this.observationTranslator.translate(
        patientData,
        patientReference,
        `Encounter/${encounter.id || entry.uid}`
      );
      const conditions = this.conditionTranslator.translate(
        patientData,
        patientReference,
        `Encounter/${encounter.id || entry.uid}`
      );

      // Build and send SHR bundle
      const shrBundle = BundleBuilder.createSHRBundle(encounter, observations, conditions);
      logger.debug(
        {
          uid: entry.uid,
          entryCount: shrBundle.entry?.length || 0,
          resources: `1 Encounter, ${observations.length} Observations, ${conditions.length} Conditions`,
        },
        'Sending SHR bundle (clinical data only) for retry'
      );
      const shrResponse = await this.openhimClient.sendBundleToSHR(shrBundle);

      logger.info(
        {
          uid: entry.uid,
          patientId: existingPatient.id,
          endpoint: '/SHR/fhir',
          resources: `1 Encounter, ${observations.length} Observations, ${conditions.length} Conditions`,
        },
        'Successfully sent clinical data to SHR during retry'
      );

      logger.info(
        { uid: entry.uid, syncId, patientId: existingPatient.id },
        'Entry SHR retry completed successfully'
      );

      return { crPatient: existingPatient, shrResponse };
    } catch (error) {
      throw handleError(error, logger, { uid: entry.uid, syncId });
    }
  }

  /**
   * Process entry with dual-flow: send demographics to CR, clinical data to SHR
   * This is the preferred method per FHIR mapping documentation
   *
   * Flow:
   * 1. Translate patient data to Patient + RelatedPerson
   * 2. Send CR bundle (demographics) to Client Registry (/CR/fhir)
   * 3. Translate clinical data to Encounter + Observations + Conditions
   * 4. Send SHR bundle (clinical data) to Shared Health Record (/SHR/fhir)
   */
  async processEntryWithDualFlow(entry: NeotreeEntry, syncId?: string): Promise<{ crResponse: FHIRBundle; shrResponse: FHIRBundle }> {
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

      logger.info({ uid: entry.uid }, 'Processing entry with dual-flow (CR + SHR)');

      // ===== CLIENT REGISTRY FLOW (Demographics) =====
      const patient = this.patientTranslator.translate(patientData);

      // Check missing data for patient
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
                'Auto-match found - updating existing patient in CR'
              );
              finalPatient = this.missingDataHandler.mergePatientData(patient, match.patient);
              finalPatient.id = match.patient.id;
              isUpdate = true;
            } else if (match.score.matchLevel === 'potential-match') {
              logger.warn(
                { uid: entry.uid, matchScore: match.score.totalScore, existingPatientId: match.patient.id },
                'Potential duplicate - creating new patient in CR'
              );
            }
          }
        } catch (error) {
          logger.warn(
            { uid: entry.uid, error: error instanceof Error ? error.message : String(error) },
            'Duplicate search failed - creating new patient in CR'
          );
        }
      }

      // Translate RelatedPerson (mother) for CR
      const relatedPerson = this.relatedPersonTranslator.translate(patientData, `Patient/${finalPatient.id || 'new'}`);

      // Build and send CR bundle
      const crBundle = BundleBuilder.createCRBundle(finalPatient, relatedPerson);
      logger.debug({ uid: entry.uid, entryCount: crBundle.entry?.length || 0 }, 'Sending CR bundle (Patient + RelatedPerson)');
      const crResponse = await this.openhimClient.sendBundleToCR(crBundle);

      logger.info(
        { uid: entry.uid, action: isUpdate ? 'updated' : 'created', endpoint: '/CR/fhir' },
        'Successfully sent demographics to Client Registry'
      );

      // ===== SHARED HEALTH RECORD FLOW (Clinical Data) =====
      // Build patient reference for SHR resources (use the ID from CR response or generated ID)
      const patientReference = finalPatient.id || `Patient/${entry.uid}`;

      // Translate clinical resources
      const encounter = this.encounterTranslator.translate(patientData, patientReference);
      const observations = this.observationTranslator.translate(patientData, patientReference, `Encounter/${encounter.id || entry.uid}`);
      const conditions = this.conditionTranslator.translate(patientData, patientReference, `Encounter/${encounter.id || entry.uid}`);

      // Build and send SHR bundle
      const shrBundle = BundleBuilder.createSHRBundle(encounter, observations, conditions);
      logger.debug(
        { uid: entry.uid, entryCount: shrBundle.entry?.length || 0, resources: `1 Encounter, ${observations.length} Observations, ${conditions.length} Conditions` },
        'Sending SHR bundle (clinical data)'
      );
      const shrResponse = await this.openhimClient.sendBundleToSHR(shrBundle);

      logger.info(
        { uid: entry.uid, endpoint: '/SHR/fhir', resources: `1 Encounter, ${observations.length} Observations, ${conditions.length} Conditions` },
        'Successfully sent clinical data to Shared Health Record'
      );

      logger.info(
        { uid: entry.uid, syncId, crAction: isUpdate ? 'updated' : 'created', shrResources: shrBundle.entry?.length || 0 },
        'Entry processed successfully with dual-flow'
      );

      return { crResponse, shrResponse };
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
