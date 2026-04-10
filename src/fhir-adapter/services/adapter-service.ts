import { NeotreeEntry, NeotreePatientData } from '../../shared/types/neotree.types';
import { FHIRBundle, FHIRPatient, FHIRResource, FHIROrganization } from '../../shared/types/fhir.types';
import { mapNeotreeToPatientData } from '../mappers/neotree-mapper';
import { PatientTranslator } from '../translators/patient-translator';
import { EncounterTranslator } from '../translators/encounter-translator';
import { ObservationTranslator } from '../translators/observation-translator';
import { ConditionTranslator } from '../translators/condition-translator';
import { RelatedPersonTranslator } from '../translators/related-person-translator';
import { QuestionnaireResponseTranslator } from '../translators/questionnaire-response-translator';
import { BundleBuilder } from './bundle-builder';
import { OpenHIMClient } from '../clients/openhim-client';
import { SyncService } from './sync-service';
import { DBDecryptionService } from './db-decryption-service';
import { FacilityIdGenerator } from '../utils/facility-id-generator';
import { getFacilityMapperService } from './facility-mapper-service';
import { getLogger } from '../../shared/utils/logger';
import { AxiosError } from 'axios';
import { getJsonFileLogger } from '../../shared/utils/json-file-logger';
import { AdapterError, handleError } from '../../shared/utils/errors';
import { validateAllResources } from '../utils/validation';
import { DuplicateDetectionService } from './duplicate-detection-service';
import { MissingDataHandler } from './missing-data-handler';
import { Pool } from 'pg';
import { getPool } from '../../shared/database/pool';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../../shared/config';
import e from 'express';

const logger = getLogger('adapter-service');
const jsonLogger = getJsonFileLogger();

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
  cr_synced: boolean;
  shr_synced: boolean;
}

interface SHRPushResult {
  resourceType: string;
  id?: string;
  status: number;
  endpoint: string;
}

export class AdapterService {
  private config = getConfig();
  private openhimClient: OpenHIMClient;
  private patientTranslator: PatientTranslator;
  private encounterTranslator: EncounterTranslator;
  private observationTranslator: ObservationTranslator;
  private conditionTranslator: ConditionTranslator;
  private relatedPersonTranslator: RelatedPersonTranslator;
  private questionnaireResponseTranslator: QuestionnaireResponseTranslator;
  private duplicateDetection: DuplicateDetectionService;
  private missingDataHandler: MissingDataHandler;
  private pool: Pool;
  private facilityMapper = getFacilityMapperService();

  constructor() {
    this.openhimClient = new OpenHIMClient();
    this.patientTranslator = new PatientTranslator();
    this.encounterTranslator = new EncounterTranslator();
    this.observationTranslator = new ObservationTranslator();
    this.conditionTranslator = new ConditionTranslator();
    this.relatedPersonTranslator = new RelatedPersonTranslator();
    this.questionnaireResponseTranslator = new QuestionnaireResponseTranslator();
    this.duplicateDetection = new DuplicateDetectionService();
    this.missingDataHandler = new MissingDataHandler();
    this.pool = getPool();
  }

  private async pushShrResources(
    resources: FHIRResource[],
    context: { uid: string; impiloUid?: string; impiloId?: string }
  ): Promise<SHRPushResult[]> {
    const results: SHRPushResult[] = [];

    for (const resource of resources) {
      if (!resource) {
        continue;
      }

      try {
        const response = await this.openhimClient.sendResourceToSHR(resource);
        results.push({
          resourceType: response.resource.resourceType || resource.resourceType,
          id: response.resource.id || resource.id,
          status: response.status,
          endpoint: response.endpoint,
        });
      } catch (error) {
        const httpStatus = error instanceof AxiosError ? error.response?.status : undefined;
        const diagnostics = (error instanceof AxiosError ? (error.response?.data as { issue?: Array<{ diagnostics?: string }> } | undefined)?.issue?.[0]?.diagnostics : undefined) || '';
        const isVersionConflict = diagnostics.includes('version constraint failure');
        if (httpStatus === 409 || httpStatus === 412 || isVersionConflict) {
          logger.warn(
            {
              uid: context.uid,
              impiloUid: context.impiloUid,
              resourceType: resource.resourceType,
              resourceId: resource.id,
            },
            'SHR version conflict - treating as success'
          );
          results.push({
            resourceType: resource.resourceType,
            id: resource.id,
            status: httpStatus || 409,
            endpoint: `${this.config.openhim.shrEndpoint}/${resource.resourceType}/${resource.id || ''}`,
          });
          continue;
        }
        logger.error(
          {
            uid: context.uid,
            impiloUid: context.impiloUid,
            resourceType: resource.resourceType,
            resourceId: resource.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to send SHR resource'
        );
        throw error;
      }
    }

    return results;
  }

  private async logShrPatientRecord(
    patientReference: string,
    context: { uid?: string; impiloId?: string; impiloUid?: string }
  ): Promise<void> {
    void patientReference;
    void context;
  }


  /**
   * Process encrypted entry from failed records table with dual-flow support
   *
   * Enhanced flow for CR/SHR retry scenarios:
   * 1. Decrypt impilo_id and data using IMPILO_ENCRYPTION_SECRET
   * 2. Format/transform data to FHIR
   * 3. Attempt to retrieve existing patient from Client Registry (CR)
   * 4. If patient exists in CR, skip CR push and only push clinical data to SHR
   * 5. If patient not in CR, perform full dual-flow (CR + SHR)
   * 6. On success: set synced=true
   * 7. On failure: keep encrypted and retry later
   *
   * This handles the scenario: CR push succeeded, SHR push failed → retry only sends clinical data
   * Encrypted data columns stay encrypted in failed table until successful retry
   */
  async processSyncedEntry(record: FailedSyncRecord): Promise<void> {
    let decryptedData: unknown;
    let decryptedImpiloId: string;
    let neotreeEntry: NeotreeEntry | null = null;
    let crSuccess = record.cr_synced;
    let shrSuccess = record.shr_synced;

    try {
      // Step 1: Decrypt the data and impilo_id from failed record
      if (!record.impilo_id || !record.data) {
        throw new Error('Missing encrypted impilo_id or data in failed record');
      }

      logger.info(
        { recordId: record.id, sessionId: record.session_id },
        'Decrypting failed sync record using IMPILO_ENCRYPTION_SECRET'
      );

      // Try to decrypt using DBDecryptionService (for IMPILO_ENCRYPTION_SECRET encrypted data)
      let decryptedSyncData;
      try {
        decryptedSyncData = DBDecryptionService.decryptDBRecord(record.impilo_id, record.data);
        logger.debug({ recordId: record.id }, 'Successfully decrypted using DBDecryptionService');
      } catch (dbDecryptError) {
        // Fallback to SyncService (for ENCRYPTION_KEY encrypted data)
        logger.debug({ recordId: record.id }, 'DBDecryption failed, attempting fallback with SyncService');
        decryptedSyncData = SyncService.decryptSyncData(record.impilo_id, record.data);
      }

      decryptedImpiloId = decryptedSyncData.impiloId;
      decryptedData = decryptedSyncData.data;

      // Log decrypted metadata without the data column for debugging
      logger.info(
        {
          recordId: record.id,
          sessionId: record.session_id,
          impiloId: decryptedImpiloId,
          crSynced: record.cr_synced,
          shrSynced: record.shr_synced,
          attemptCount: record.attempt_count,
        },
        'Decrypted failed record metadata (excluding data payload)'
      );

      // Step 2: Generate FACILITY_ID from decrypted impilo_id for CR push
      let facilityId: string | null = null;
      try {
        facilityId = FacilityIdGenerator.generateFromImpiloId(decryptedImpiloId);
        logger.debug({ recordId: record.id, decryptedImpiloId, facilityId }, 'Generated FACILITY_ID from decrypted impilo_id');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error({ recordId: record.id, decryptedImpiloId, error: errorMsg }, 'Failed to generate FACILITY_ID');
        throw new Error(`Cannot process failed sync record: ${errorMsg}`);
      }

      // Step 3: Format the data
      let patientData: NeotreePatientData;
      if (typeof decryptedData === 'object' && decryptedData !== null && 'script' in decryptedData) {
        neotreeEntry = decryptedData as NeotreeEntry;
        patientData = mapNeotreeToPatientData(neotreeEntry, facilityId || undefined);
      } else {
        patientData = decryptedData as NeotreePatientData;
      }

      const scriptId = patientData.scriptId || neotreeEntry?.script?.id;
      if (!scriptId || !this.facilityMapper.hasFacility(scriptId)) {
        logger.info(
          { recordId: record.id, sessionId: record.session_id, scriptId },
          'Skipping failed record retry: scriptId not in facility-mapper'
        );
        return;
      }
      if (facilityId) {
        (patientData as { facilityId?: string }).facilityId = facilityId;
      }
      patientData.impilo_id = decryptedImpiloId;
      const facilityName = patientData.scriptId
        ? this.facilityMapper.getFacilityName(patientData.scriptId)
        : facilityId || 'Unknown Facility';
      if (facilityId) {
        await this.ensureOrganizationExists(facilityId, facilityName);
      }

      // Step 4: Phase 1 - Client Registry (if not already synced)
      if (!crSuccess) {
        try {
          logger.info({ recordId: record.id, impiloId: decryptedImpiloId, facilityId }, 'Phase 1: Pushing demographics to Client Registry (CR)');
          
          const patient = this.patientTranslator.translate(patientData as any, facilityId || undefined);
          
          // Check for duplicates before pushing
          const searchParams: Record<string, string> = {};
          if (patient.identifier?.[0]?.value) {
            searchParams.identifier = `${patient.identifier[0].system}|${patient.identifier[0].value}`;
          }
          
          let finalPatient = patient;
          if (Object.keys(searchParams).length > 0) {
            try {
              const searchResults = await this.openhimClient.searchPatients(searchParams);
              const duplicates = await this.duplicateDetection.findPotentialDuplicates(patient, searchResults);
              if (duplicates.length > 0 && duplicates[0].score.matchLevel === 'auto-match') {
                finalPatient = this.missingDataHandler.mergePatientData(patient, duplicates[0].patient);
                finalPatient.id = duplicates[0].patient.id;
              }
            } catch {
              logger.warn({ recordId: record.id }, 'Duplicate search failed, proceeding with original patient data');
            }
          }

          const relatedPerson = this.relatedPersonTranslator.translate(
            patientData as any,
            `Patient/${finalPatient.id || 'new'}`,
            facilityId || undefined,
            this.config.source.id
          );
          const crBundle = BundleBuilder.createCRBundle(finalPatient, relatedPerson);
          await this.openhimClient.sendBundleToCR(crBundle);
          
          crSuccess = true;
          logger.info({ recordId: record.id, impiloId: decryptedImpiloId }, 'Phase 1 Success: Client Registry push completed');
        } catch (error) {
          logger.error({ recordId: record.id, error: error instanceof Error ? error.message : String(error) }, 'Phase 1 Failed: Client Registry push failed');
          throw error; // Re-throw to update status with failure
        }
      } else {
        logger.info({ recordId: record.id }, 'Phase 1 Skip: Already synced to Client Registry');
      }

      // Step 5: Phase 2 - Shared Health Record (if CR is successful and SHR not yet synced)
      if (crSuccess && !shrSuccess) {
        try {
          logger.info({ recordId: record.id, impiloId: decryptedImpiloId }, 'Phase 2: Pushing clinical data to Shared Health Record (SHR)');

          // We need the patient bundle ID from CR for clinical data linkage
          // Try to retrieve patient using impilo_id first (more reliable), then fallback to uid
          const neotreeIdentifierSystem = `urn:neotree:impilo-id`;
          const primaryIdentifierValue = patientData.impilo_id || patientData.uid;
          let crResponse = null;

          if (primaryIdentifierValue) {
            try {
              logger.debug({ recordId: record.id, impiloId: primaryIdentifierValue }, 'Searching for patient in CR using impilo_id');
              crResponse = await this.openhimClient.getPatientFromCR(neotreeIdentifierSystem, primaryIdentifierValue);
              logger.debug({ recordId: record.id, bundleId: crResponse?.bundleId, hasPatient: !!crResponse?.patient }, 'CR response received');
            } catch (impiloSearchError) {
              logger.warn(
                { recordId: record.id, impiloId: primaryIdentifierValue, error: impiloSearchError instanceof Error ? impiloSearchError.message : String(impiloSearchError) },
                'Failed to search CR using impilo_id, attempting fallback with uid'
              );
            }
          }

      // Fallback to uid if impilo_id search failed
      if (!crResponse) {
        const neotreeIdentifier = patientData.uid;
        logger.debug({ recordId: record.id, uid: neotreeIdentifier }, 'Searching for patient in CR using uid');
        crResponse = await this.openhimClient.getPatientFromCR(neotreeIdentifierSystem, neotreeIdentifier);
      }

      if (!crResponse || !crResponse.bundleId) {
        const cachedBundleId = await this.getCachedCrBundleId(decryptedImpiloId, (patientData as any).uid);
        if (cachedBundleId) {
          logger.warn(
            { recordId: record.id, bundleId: cachedBundleId },
            'CR lookup failed, using cached bundleId for SHR linkage'
          );
          crResponse = { bundleId: cachedBundleId };
        }
      }

      if (!crResponse || !crResponse.bundleId) {
        throw new Error('Cannot link clinical data: Patient bundle not found in CR');
      }
      await this.storeCrBundleId(decryptedImpiloId, (patientData as any).uid, crResponse.bundleId);

          // ===== SHARED HEALTH RECORD FLOW - PHASE 1: SHALLOW PATIENT =====
          // Post shallow patient record to SHR before sending clinical data
          let shrPatientId: string | undefined;
          let shallowPatientReference: string | undefined;
          try {
            const shallowPatient = crResponse.patient
              ? this.createShallowPatientFromCR(crResponse.patient)
              : this.createShallowPatientFromEntry(patientData, crResponse.bundleId, facilityId || undefined);
            shallowPatientReference = shallowPatient.id ? `Patient/${shallowPatient.id}` : undefined;
            logger.debug(
              { recordId: record.id, bundleId: crResponse.bundleId },
              'Creating shallow patient for SHR'
            );
            const shrPatient = await this.openhimClient.sendShallowPatientToSHR(shallowPatient);
            shrPatientId = shrPatient?.id;
            logger.info(
              { recordId: record.id, bundleId: crResponse.bundleId, shrPatientId, endpoint: '/SHR/fhir/Patient' },
              'Shallow patient posted successfully to SHR'
            );
          } catch (error) {
            logger.warn(
              { recordId: record.id, error: error instanceof Error ? error.message : String(error) },
              'Shallow patient POST to SHR failed, continuing with clinical data'
            );
            // Non-critical error - log warning but continue with clinical data push
          }

          // ===== SHARED HEALTH RECORD FLOW - PHASE 2: CLINICAL DATA =====
          const patientReference = shrPatientId
            ? `Patient/${shrPatientId}`
            : shallowPatientReference || `Patient/${crResponse.bundleId}`;
          const encounterId = uuidv4();
          const encounterReference = `Encounter/${encounterId}`;
          const scriptId = (patientData as any).scriptId;
          const facilityIdFromManagingOrg = this.extractFacilityIdFromManagingOrganization(crResponse.patient);
          const resolvedFacilityId = facilityId || facilityIdFromManagingOrg;
          if (!resolvedFacilityId) {
            throw new Error('Cannot push SHR resources: missing facilityId for Questionnaire reference');
          }
          (patientData as { facilityId?: string }).facilityId = resolvedFacilityId;
          const encounter = this.encounterTranslator.translate(patientData as any, patientReference, encounterId, scriptId);
          const observations = this.observationTranslator.translate(
            patientData as any,
            patientReference,
            encounterReference,
            resolvedFacilityId
          );
          const conditions = this.conditionTranslator.translate(
            patientData as any,
            patientReference,
            encounterReference,
            resolvedFacilityId,
            this.config.source.id
          );

          // Translate complete form submission as QuestionnaireResponse (audit trail)
          const questionnaireResponse = neotreeEntry
            ? this.questionnaireResponseTranslator.translate(patientData as any, patientReference, encounterReference, neotreeEntry)
            : undefined;

          const shrResources: FHIRResource[] = [
            encounter,
            ...observations,
            ...conditions,
            ...(questionnaireResponse ? [questionnaireResponse] : []),
          ];
          await this.pushShrResources(shrResources, {
            uid: neotreeEntry?.uid || 'unknown',
            impiloUid: decryptedImpiloId,
            impiloId: patientData.impilo_id,
          });
          await this.logShrPatientRecord(patientReference, {
            uid: neotreeEntry?.uid || 'unknown',
            impiloId: decryptedImpiloId,
          });

          shrSuccess = true;
          logger.info({ recordId: record.id, impiloId: decryptedImpiloId }, 'Phase 2 Success: Shared Health Record push completed');
        } catch (error) {
          logger.error({ recordId: record.id, error: error instanceof Error ? error.message : String(error) }, 'Phase 2 Failed: Shared Health Record push failed');
          throw error;
        }
      } else if (!crSuccess) {
        logger.warn({ recordId: record.id }, 'Phase 2 Delayed: Waiting for Phase 1 (CR) to succeed');
      } else {
        logger.info({ recordId: record.id }, 'Phase 2 Skip: Already synced to Shared Health Record');
      }

      // Step 6: Update overall sync status
      const fullySynced = crSuccess && shrSuccess;
      await this.pool.query(
        `SELECT update_failed_session_retry($1, $2, $3, $4, $5)`,
        [record.id, null, fullySynced, crSuccess, shrSuccess]
      );

      logger.info({ recordId: record.id, fullySynced }, 'Successfully updated record sync status');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.pool.query(
        `SELECT update_failed_session_retry($1, $2, $3, $4, $5)`,
        [record.id, errorMessage, false, crSuccess, shrSuccess]
      );
      throw error;
    }
  }

  async processEntry(entry: NeotreeEntry, syncId?: string): Promise<FHIRBundle> {
    try {
      if (!entry.script) {
        throw new Error(`Missing script data for entry ${entry.uid}`);
      }
      const scriptId = entry.script?.id;
      if (!scriptId || !this.facilityMapper.hasFacility(scriptId)) {
        logger.info(
          { uid: entry.uid, scriptId },
          'Skipping entry: scriptId not in facility-mapper'
        );
        return { resourceType: 'Bundle', type: 'collection', entry: [] };
      }
      let facilityId: string | undefined;
      const facilitySourceId = entry.impilo_id || entry.impilo_uid;
      if (facilitySourceId) {
        try {
          facilityId = FacilityIdGenerator.generateFromImpiloId(facilitySourceId);
          logger.debug(
            { uid: entry.uid, impiloId: entry.impilo_id, impiloUid: entry.impilo_uid, facilityId },
            'Generated FACILITY_ID from impilo_id'
          );
        } catch (error) {
          logger.warn(
            { uid: entry.uid, impiloId: entry.impilo_id, impiloUid: entry.impilo_uid, error: error instanceof Error ? error.message : String(error) },
            'Failed to generate FACILITY_ID from impilo_id'
          );
        }
      }

      const patientData = mapNeotreeToPatientData(entry, facilityId);
      patientData.facilityId = facilityId;
      if (entry.impilo_id) {
        patientData.impilo_id = entry.impilo_id;
      }
      const facilityName = entry.script?.id
        ? this.facilityMapper.getFacilityName(entry.script.id)
        : facilityId || 'Unknown Facility';
      if (facilityId) {
        await this.ensureOrganizationExists(facilityId, facilityName);
      }
      const validation = validateAllResources(patientData);

      if (!validation.canProceed) {
        throw new Error(
          `Validation failed: missing required fields [${validation.patient.missingFields.join(', ')}]`
        );
      }

      const patient = this.patientTranslator.translate(patientData, facilityId);

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
   * 1. Retrieve existing patient bundle from Client Registry using identifiers
   * 2. If patient found in CR, use bundle ID for clinical data linkage
   * 3. Send SHR resources (clinical data) to Shared Health Record (/SHR/fhir)
   * 4. Avoids duplicate patient creation by reusing CR bundle reference
   */
  async processEntrySHRRetry(
    entry: NeotreeEntry,
    syncId?: string
  ): Promise<{ crBundleId: string; shrResponse: SHRPushResult[] }> {
    try {
      if (!entry.script) {
        throw new Error(`Missing script data for entry ${entry.uid}`);
      }

      const patientData = mapNeotreeToPatientData(entry);
      if (entry.impilo_id) {
        patientData.impilo_id = entry.impilo_id;
      }
      const retryFacilityId = entry.impilo_id || entry.impilo_uid
        ? FacilityIdGenerator.generateFromImpiloId(entry.impilo_id || entry.impilo_uid)
        : undefined;
      const facilityName = entry.script?.id
        ? this.facilityMapper.getFacilityName(entry.script.id)
        : retryFacilityId || 'Unknown Facility';
      if (retryFacilityId) {
        await this.ensureOrganizationExists(retryFacilityId, facilityName);
      }
      const validation = validateAllResources(patientData);

      if (!validation.canProceed) {
        throw new Error(
          `Validation failed: missing required fields [${validation.patient.missingFields.join(', ')}]`
        );
      }

      logger.info(
        { uid: entry.uid, syncId, impiloUid: entry.impilo_uid },
        'Processing entry SHR retry - retrieving existing patient from CR'
      );

      // ===== RETRIEVE PATIENT FROM CLIENT REGISTRY =====
      const neotreeIdentifierSystem = `urn:neotree:impilo-id`;
      let crResponse = null;

      const primaryIdentifierValue = patientData.impilo_id || patientData.uid;
      if (primaryIdentifierValue) {
        try {
          logger.debug(
            { uid: entry.uid, impiloId: primaryIdentifierValue },
            'Searching for patient in CR using impilo_id'
          );
          crResponse = await this.openhimClient.getPatientFromCR(
            neotreeIdentifierSystem,
            primaryIdentifierValue
          );
        } catch (error) {
          logger.warn(
            {
              uid: entry.uid,
              impiloId: primaryIdentifierValue,
              error: error instanceof Error ? error.message : String(error),
            },
            'Failed to retrieve patient from CR using impilo_id, attempting fallback with uid'
          );
        }
      }

      // Fallback to uid if impilo_id search failed
      if (!crResponse) {
        const neotreeIdentifier = patientData.uid;
        try {
          logger.debug(
            { uid: entry.uid, neotreeIdentifier },
            'Searching for patient in CR using uid'
          );
          crResponse = await this.openhimClient.getPatientFromCR(
            neotreeIdentifierSystem,
            neotreeIdentifier
          );
        } catch (error) {
          logger.warn(
            {
              uid: entry.uid,
              error: error instanceof Error ? error.message : String(error),
            },
            'Failed to retrieve patient from CR using uid'
          );
        }
      }

      if (!crResponse || !crResponse.bundleId) {
        throw new Error(
          `Could not retrieve patient bundle from Client Registry for retry. Tried impilo_uid: ${entry.impilo_uid}, uid: ${patientData.uid}`
        );
      }

      logger.info(
        { uid: entry.uid, bundleId: crResponse.bundleId },
        'Successfully retrieved patient from CR'
      );

      // ===== SHARED HEALTH RECORD FLOW (Clinical Data Only) =====
      const patientReference = `Patient/${crResponse.bundleId}`;
      const encounterId = uuidv4();
      const encounterReference = `Encounter/${encounterId}`;
      const scriptId = patientData.scriptId;
      const facilityIdFromManagingOrg = this.extractFacilityIdFromManagingOrganization(crResponse.patient);
      const resolvedFacilityId = facilityIdFromManagingOrg || undefined;
      if (resolvedFacilityId) {
        (patientData as { facilityId?: string }).facilityId = resolvedFacilityId;
      }

      // Translate clinical resources
      const encounter = this.encounterTranslator.translate(patientData, patientReference, encounterId, scriptId);
      const observations = this.observationTranslator.translate(
        patientData,
        patientReference,
        encounterReference,
        resolvedFacilityId
      );
      const conditions = this.conditionTranslator.translate(
        patientData,
        patientReference,
        encounterReference,
        resolvedFacilityId,
        this.config.source.id
      );

      // Translate complete form submission as QuestionnaireResponse (audit trail)
      const questionnaireResponse = this.questionnaireResponseTranslator.translate(
        patientData,
        patientReference,
        encounterReference,
        entry
      );

      const shrResources: FHIRResource[] = [
        encounter,
        ...observations,
        ...conditions,
        questionnaireResponse,
      ];
      logger.debug(
        {
          uid: entry.uid,
          entryCount: shrResources.length,
          resources: `1 Encounter, ${observations.length} Observations, ${conditions.length} Conditions`,
        },
        'Sending SHR resources (clinical data only) for retry'
      );
      const shrResponse = await this.pushShrResources(shrResources, {
        uid: entry.uid,
        impiloUid: entry.impilo_uid,
        impiloId: patientData.impilo_id,
      });
      await this.logShrPatientRecord(patientReference, {
        uid: entry.uid,
        impiloUid: entry.impilo_uid || undefined,
      });

      logger.info(
        {
          uid: entry.uid,
          bundleId: crResponse.bundleId,
          endpoint: '/SHR/fhir',
          resources: `1 Encounter, ${observations.length} Observations, ${conditions.length} Conditions`,
        },
        'Successfully sent clinical data to SHR during retry'
      );

      logger.info(
        { uid: entry.uid, syncId, bundleId: crResponse.bundleId },
        'Entry SHR retry completed successfully'
      );

      return { crBundleId: crResponse.bundleId, shrResponse };
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
   * 4. Send SHR resources (clinical data) to Shared Health Record (/SHR/fhir)
   */
  async processEntryWithDualFlow(entry: NeotreeEntry, syncId?: string): Promise<{ crResponse: FHIRBundle; shrResponse: SHRPushResult[] }> {
    let crSynced = false;
    try {
      if (!entry.script) {
        throw new Error(`Missing script data for entry ${entry.uid}`);
      }
      const scriptId = entry.script?.id;
      if (!scriptId || !this.facilityMapper.hasFacility(scriptId)) {
        logger.info(
          { uid: entry.uid, scriptId },
          'Skipping entry: scriptId not in facility-mapper'
        );
        return {
          crResponse: { resourceType: 'Bundle', type: 'collection', entry: [] },
          shrResponse: [],
        };
      }

      // Generate FACILITY_ID from impilo_id (fallback to impilo_uid)
      let facilityId: string;
      try {
        const facilitySourceId = entry.impilo_id || entry.impilo_uid;
        if (!facilitySourceId) {
          throw new Error('Missing impilo_id for facility mapping');
        }
        facilityId = FacilityIdGenerator.generateFromImpiloId(facilitySourceId);
        logger.debug(
          { uid: entry.uid, impiloId: entry.impilo_id, impiloUid: entry.impilo_uid, facilityId },
          'Generated FACILITY_ID from impilo_id'
        );
      } catch (error) {
        throw new Error(
          `Cannot process entry: ${error instanceof Error ? error.message : String(error)}. ` +
          `Entry UID: ${entry.uid}`
        );
      }

      const patientData = mapNeotreeToPatientData(entry, facilityId);
      if (entry.impilo_id) {
        patientData.impilo_id = entry.impilo_id;
      }
      const validation = validateAllResources(patientData);

      if (!validation.canProceed) {
        throw new Error(
          `Validation failed: missing required fields [${validation.patient.missingFields.join(', ')}]`
        );
      }

      logger.info({ uid: entry.uid, facilityId }, 'Processing entry with dual-flow (CR + SHR)');

      // ===== CLIENT REGISTRY FLOW (Demographics) =====
      const facilityName = this.facilityMapper.getFacilityName(entry.script.id);
      await this.ensureOrganizationExists(facilityId, facilityName);
      const patient = this.patientTranslator.translate(patientData, facilityId);

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
      const relatedPerson = this.relatedPersonTranslator.translate(
        patientData,
        `Patient/${finalPatient.id || 'new'}`,
        facilityId,
        this.config.source.id
      );

      // Build and send CR bundle
      const crBundle = BundleBuilder.createCRBundle(finalPatient, relatedPerson);
      logger.debug({ uid: entry.uid, entryCount: crBundle.entry?.length || 0 }, 'Sending CR bundle (Patient + RelatedPerson)');

      let crBundleResponse: FHIRBundle;
      try {
        crBundleResponse = await this.openhimClient.sendBundleToCR(crBundle);
      } catch (crError) {
        logger.error(
          { uid: entry.uid, error: crError instanceof Error ? crError.message : String(crError) },
          'CR push failed - storing record for retry without attempting SHR push'
        );
        throw crError; // Re-throw to mark as failed and retry later
      }
      crSynced = true;

      logger.info(
        { uid: entry.uid, action: isUpdate ? 'updated' : 'created', endpoint: '/CR/fhir' },
        'Successfully sent demographics to Client Registry'
      );

      try {
        // ===== RETRIEVE PATIENT BUNDLE ID FROM CR FOR SHR LINKAGE =====
        // After CR push succeeds, retrieve the patient bundle ID to use for SHR resources
        const neotreeIdentifierSystem = `urn:neotree:impilo-id`;
        let crSearchResponse = null;
        const primaryIdentifierValue =
          finalPatient.identifier?.[0]?.value || patientData.impilo_id || entry.uid;

        if (primaryIdentifierValue) {
          try {
            logger.debug({ uid: entry.uid, impiloId: primaryIdentifierValue }, 'Retrieving patient bundle ID from CR for SHR linkage');
            crSearchResponse = await this.openhimClient.getPatientFromCR(neotreeIdentifierSystem, primaryIdentifierValue);
          } catch (error) {
            logger.warn(
              { uid: entry.uid, impiloId: primaryIdentifierValue, error: error instanceof Error ? error.message : String(error) },
              'Failed to retrieve patient bundle from CR, attempting fallback with uid'
            );
          }
        }

        // Fallback to uid if impilo_id search failed
        if (!crSearchResponse) {
          try {
            logger.debug({ uid: entry.uid }, 'Retrieving patient bundle ID from CR using uid for SHR linkage');
            crSearchResponse = await this.openhimClient.getPatientFromCR(neotreeIdentifierSystem, entry.uid);
          } catch (error) {
            logger.warn(
              { uid: entry.uid, error: error instanceof Error ? error.message : String(error) },
              'Failed to retrieve patient bundle from CR using uid'
            );
          }
        }

        if (!crSearchResponse || !crSearchResponse.bundleId) {
          const cachedBundleId = await this.getCachedCrBundleId(entry.impilo_uid, entry.uid);
          if (cachedBundleId) {
            logger.warn(
              { uid: entry.uid, bundleId: cachedBundleId },
              'CR lookup failed, using cached bundleId for SHR linkage'
            );
            crSearchResponse = { bundleId: cachedBundleId };
          }
        }

        if (!crSearchResponse || !crSearchResponse.bundleId) {
          throw new Error('Cannot link clinical data to SHR: Patient bundle not found in CR after demographics push');
        }
        await this.storeCrBundleId(entry.impilo_uid, entry.uid, crSearchResponse.bundleId);

        logger.debug({ uid: entry.uid, bundleId: crSearchResponse.bundleId }, 'Retrieved patient bundle ID from CR for SHR');

        // ===== SHARED HEALTH RECORD FLOW - PHASE 1: SHALLOW PATIENT =====
        // Post shallow patient record to SHR before sending clinical data
        let shrPatientId: string | undefined;
        let shallowPatientReference: string | undefined;
        try {
          const shallowPatient = crSearchResponse.patient
            ? this.createShallowPatientFromCR(crSearchResponse.patient)
            : this.createShallowPatientFromEntry(patientData, crSearchResponse.bundleId, facilityId);
          shallowPatientReference = shallowPatient.id ? `Patient/${shallowPatient.id}` : undefined;
          logger.debug(
            { uid: entry.uid, bundleId: crSearchResponse.bundleId },
            'Creating shallow patient for SHR'
          );
          const shrPatient = await this.openhimClient.sendShallowPatientToSHR(shallowPatient);
          shrPatientId = shrPatient?.id;
          logger.info(
            { uid: entry.uid, bundleId: crSearchResponse.bundleId, shrPatientId, endpoint: '/SHR/fhir/Patient' },
            'Shallow patient posted successfully to SHR'
          );
        } catch (error) {
          logger.warn(
            { uid: entry.uid, error: error instanceof Error ? error.message : String(error) },
            'Shallow patient POST to SHR failed, continuing with clinical data'
          );
        }

        // ===== SHARED HEALTH RECORD FLOW - PHASE 2: CLINICAL DATA =====
        // Build patient reference for SHR resources using the same patient sent to SHR
        const patientReference = shrPatientId
          ? `Patient/${shrPatientId}`
          : shallowPatientReference || `Patient/${crSearchResponse.bundleId}`;
        const encounterId = uuidv4();
        const encounterReference = `Encounter/${encounterId}`;
        const dualFlowScriptId = patientData.scriptId;
        const facilityIdFromManagingOrg = this.extractFacilityIdFromManagingOrganization(crSearchResponse.patient);
        const resolvedFacilityId = facilityId || facilityIdFromManagingOrg;
        if (!resolvedFacilityId) {
          throw new Error('Cannot push SHR resources: missing facilityId for Questionnaire reference');
        }
        (patientData as { facilityId?: string }).facilityId = resolvedFacilityId;

        // Translate clinical resources
        const encounter = this.encounterTranslator.translate(patientData, patientReference, encounterId, dualFlowScriptId);
        const observations = this.observationTranslator.translate(
          patientData,
          patientReference,
          encounterReference,
          resolvedFacilityId
        );
        const conditions = this.conditionTranslator.translate(
          patientData,
          patientReference,
          encounterReference,
          resolvedFacilityId,
          this.config.source.id
        );

        // Translate complete form submission as QuestionnaireResponse (audit trail)
        const questionnaireResponse = this.questionnaireResponseTranslator.translate(
          patientData,
          patientReference,
          encounterReference,
          entry
        );

        const shrResources: FHIRResource[] = [
          encounter,
          ...observations,
          ...conditions,
          questionnaireResponse,
        ];
        logger.debug(
          { uid: entry.uid, entryCount: shrResources.length, resources: `1 Encounter, ${observations.length} Observations, ${conditions.length} Conditions` },
          'Sending SHR resources (clinical data)'
        );
        const shrResponse = await this.pushShrResources(shrResources, {
          uid: entry.uid,
          impiloUid: entry.impilo_uid,
          impiloId: patientData.impilo_id,
        });
        await this.logShrPatientRecord(patientReference, {
          uid: entry.uid,
          impiloUid: entry.impilo_uid || undefined,
        });

        logger.info(
          { uid: entry.uid, endpoint: '/SHR/fhir', resources: `1 Encounter, ${observations.length} Observations, ${conditions.length} Conditions` },
          'Successfully sent clinical data to Shared Health Record'
        );

        logger.info(
          { uid: entry.uid, syncId, crAction: isUpdate ? 'updated' : 'created', shrResources: shrResponse.length },
          'Entry processed successfully with dual-flow'
        );

        return { crResponse: crBundleResponse, shrResponse };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new AdapterError(
          `SHR push failed after CR success: ${errorMessage}`,
          'SHR_SYNC_FAILED',
          502,
          { crSynced: true, shrSynced: false }
        );
      }
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
   * Create shallow patient with identifiers and basic demographics for SHR
   * Used for demonstration: POST shallow patient before sending clinical data to SHR
   *
   * Includes:
   * - All identifiers from CR (urn:neotree:impilo-id, urn:impilo:person-id, urn:impilo:uid)
   * - Names, gender, and birthDate demographics
   *
   * @param crPatient Full patient resource from Client Registry
   * @returns Shallow patient FHIR resource for SHR
   */
  private createShallowPatientFromCR(crPatient: any): any {
    const facilityId = this.extractFacilityIdFromManagingOrganization(crPatient);
    const shallowPatient: any = {
      resourceType: 'Patient',
      id: crPatient.id,
      identifier: crPatient.identifier || [],
    };

    // Include name(s) from CR
    if (crPatient.name && crPatient.name.length > 0) {
      shallowPatient.name = crPatient.name;
    }

    // Include gender from CR
    if (crPatient.gender) {
      shallowPatient.gender = crPatient.gender;
    }

    // Include birthDate from CR
    if (crPatient.birthDate) {
      shallowPatient.birthDate = crPatient.birthDate;
    }

    const clientIdTag = (crPatient.meta?.tag || []).find(
      (tag: { system?: string; code?: string }) =>
        tag.system === 'http://openclientregistry.org/fhir/clientid' && tag.code
    );

    if (facilityId) {
      shallowPatient.meta = {
        tag: [
          {
            system: 'http://openclientregistry.org/fhir/clientid',
            code: facilityId,
          },
        ],
      };
      shallowPatient.managingOrganization = {
        reference: `Organization/${facilityId}`,
      };
    } else if (clientIdTag) {
      shallowPatient.meta = { tag: [clientIdTag] };
    } else if (crPatient.managingOrganization) {
      shallowPatient.managingOrganization = crPatient.managingOrganization;
    }

    logger.debug(
      {
        patientId: crPatient.id,
        identifierCount: shallowPatient.identifier?.length || 0,
        hasName: !!shallowPatient.name,
        hasGender: !!shallowPatient.gender,
        hasBirthDate: !!shallowPatient.birthDate,
      },
      'Created shallow patient from CR data'
    );

    return shallowPatient;
  }

  /**
   * Create shallow patient from local entry data when CR patient is unavailable
   */
  private createShallowPatientFromEntry(patientData: any, bundleId: string, facilityId?: string): FHIRPatient {
    const translatedPatient = this.patientTranslator.translate(patientData as any, facilityId);
    const shallowPatient: FHIRPatient = {
      resourceType: 'Patient',
      id: bundleId,
      identifier: translatedPatient.identifier || [],
    };

    if (translatedPatient.name && translatedPatient.name.length > 0) {
      shallowPatient.name = translatedPatient.name;
    }

    if (translatedPatient.gender && translatedPatient.gender !== 'unknown') {
      shallowPatient.gender = translatedPatient.gender;
    } else if (patientData.gender && patientData.gender !== 'unknown') {
      shallowPatient.gender = patientData.gender;
    } else if (translatedPatient.gender) {
      shallowPatient.gender = translatedPatient.gender;
    }

    if (translatedPatient.birthDate) {
      shallowPatient.birthDate = translatedPatient.birthDate;
    }

    if (translatedPatient.meta) {
      shallowPatient.meta = translatedPatient.meta;
    }

    if (translatedPatient.managingOrganization) {
      shallowPatient.managingOrganization = translatedPatient.managingOrganization;
    }

    logger.debug(
      {
        patientId: bundleId,
        identifierCount: shallowPatient.identifier?.length || 0,
        hasName: !!shallowPatient.name,
        hasGender: !!shallowPatient.gender,
        hasBirthDate: !!shallowPatient.birthDate,
      },
      'Created shallow patient from entry data'
    );

    return shallowPatient;
  }

  private extractFacilityIdFromManagingOrganization(patient?: FHIRPatient | null): string | undefined {
    const reference = patient?.managingOrganization?.reference;
    if (!reference) {
      return undefined;
    }
    const parts = reference.split('/');
    return parts[parts.length - 1] || undefined;
  }

  private buildOrganizationResource(facilityId: string, facilityName: string): FHIROrganization {
    return {
      resourceType: 'Organization',
      id: facilityId,
      identifier: [
        {
          system: 'http://health.gov.zw/fhir/organization',
          value: facilityId,
        },
      ],
      active: true,
      name: facilityName,
      type: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/organization-type',
              code: 'prov',
              display: 'Healthcare Provider',
            },
          ],
        },
      ],
    };
  }

  private async ensureOrganizationExists(facilityId: string, facilityName: string): Promise<void> {
    const organization = this.buildOrganizationResource(facilityId, facilityName);
    logger.info({ facilityId, facilityName }, 'Ensuring Organization exists in CR and SHR');
    try {
      await this.openhimClient.sendResourceToCR(organization);
    } catch (error) {
      logger.error(
        { facilityId, error: error instanceof Error ? error.message : String(error) },
        'Failed to create Organization in CR'
      );
      throw error;
    }
    try {
      await this.openhimClient.sendResourceToSHR(organization);
    } catch (error) {
      logger.error(
        { facilityId, error: error instanceof Error ? error.message : String(error) },
        'Failed to create Organization in SHR'
      );
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  private async getCachedCrBundleId(impiloUid?: string | null, uid?: string | null): Promise<string | undefined> {
    if (impiloUid) {
      const result = await this.pool.query<{ cr_bundle_id: string }>(
        `SELECT cr_bundle_id FROM cr_patient_links WHERE impilo_uid = $1 ORDER BY updated_at DESC LIMIT 1`,
        [impiloUid]
      );
      if (result.rows[0]?.cr_bundle_id) {
        return result.rows[0].cr_bundle_id;
      }
    }
    if (uid) {
      const result = await this.pool.query<{ cr_bundle_id: string }>(
        `SELECT cr_bundle_id FROM cr_patient_links WHERE uid = $1 ORDER BY updated_at DESC LIMIT 1`,
        [uid]
      );
      if (result.rows[0]?.cr_bundle_id) {
        return result.rows[0].cr_bundle_id;
      }
    }
    return undefined;
  }

  private async storeCrBundleId(impiloUid: string | null | undefined, uid: string | null | undefined, bundleId: string): Promise<void> {
    if (impiloUid) {
      await this.pool.query(
        `INSERT INTO cr_patient_links (impilo_uid, uid, cr_bundle_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (impilo_uid) WHERE impilo_uid IS NOT NULL
         DO UPDATE SET uid = EXCLUDED.uid, cr_bundle_id = EXCLUDED.cr_bundle_id, updated_at = NOW()`,
        [impiloUid, uid || null, bundleId]
      );
      return;
    }
    if (uid) {
      await this.pool.query(
        `INSERT INTO cr_patient_links (uid, cr_bundle_id)
         VALUES ($1, $2)
         ON CONFLICT (uid) WHERE uid IS NOT NULL
         DO UPDATE SET cr_bundle_id = EXCLUDED.cr_bundle_id, updated_at = NOW()`,
        [uid, bundleId]
      );
    }
  }
}
