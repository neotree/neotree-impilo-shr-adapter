"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdapterService = void 0;
const neotree_mapper_1 = require("../mappers/neotree-mapper");
const patient_translator_1 = require("../translators/patient-translator");
const bundle_builder_1 = require("./bundle-builder");
const openhim_client_1 = require("../clients/openhim-client");
const sync_service_1 = require("./sync-service");
const logger_1 = require("../../shared/utils/logger");
const errors_1 = require("../../shared/utils/errors");
const validation_1 = require("../utils/validation");
const duplicate_detection_service_1 = require("./duplicate-detection-service");
const missing_data_handler_1 = require("./missing-data-handler");
const pg_1 = require("pg");
const config_1 = require("../../shared/config");
const logger = (0, logger_1.getLogger)('adapter-service');
class AdapterService {
    constructor() {
        this.openhimClient = new openhim_client_1.OpenHIMClient();
        this.patientTranslator = new patient_translator_1.PatientTranslator();
        this.duplicateDetection = new duplicate_detection_service_1.DuplicateDetectionService();
        this.missingDataHandler = new missing_data_handler_1.MissingDataHandler();
        this.pool = new pg_1.Pool((0, config_1.getConfig)().database);
    }
    /**
     * Process encrypted entry from failed records table:
     * 1. Decrypt impilo_id and data
     * 2. Format/transform data to FHIR
     * 3. Send to OpenHIM
     * 4. On success: update impilo_id to one-way hash and set synced=true
     * 5. On failure: keep encrypted and retry later
     */
    async processSyncedEntry(record) {
        let decryptedData;
        let decryptedImpiloId;
        try {
            // Step 1: Decrypt the data and impilo_id
            if (!record.impilo_id || !record.data) {
                throw new Error('Missing encrypted impilo_id or data in failed record');
            }
            logger.info({ recordId: record.id, sessionId: record.session_id }, 'Decrypting failed sync record');
            const decryptedSyncData = sync_service_1.SyncService.decryptSyncData(record.impilo_id, record.data);
            decryptedImpiloId = decryptedSyncData.impiloId;
            decryptedData = decryptedSyncData.data;
            logger.info({ recordId: record.id, impiloId: decryptedImpiloId }, 'Successfully decrypted sync record');
            // Step 2: Format the data - check if it's already structured as Neotree entry or raw data
            let patientData;
            if (typeof decryptedData === 'object' && decryptedData !== null && 'script' in decryptedData) {
                // It's a Neotree entry
                const entry = decryptedData;
                patientData = (0, neotree_mapper_1.mapNeotreeToPatientData)(entry);
            }
            else {
                // Assume it's already formatted patient data
                patientData = decryptedData;
            }
            // Validate the patient data
            let validationResult;
            try {
                validationResult = (0, validation_1.validateAllResources)(patientData);
            }
            catch {
                // If validation fails on unknown type, assume it's valid for now
                validationResult = { canProceed: true, patient: { missingFields: [] } };
            }
            if (!validationResult.canProceed) {
                throw new Error(`Validation failed: missing required fields [${validationResult.patient.missingFields.join(', ')}]`);
            }
            const patient = this.patientTranslator.translate(patientData);
            // Check missing data
            const missingDataReport = this.missingDataHandler.analyzeMissingData(patient, decryptedImpiloId);
            if (!missingDataReport.canProceed) {
                throw new Error(`Critical fields missing: [${missingDataReport.criticalFieldsMissing.join(', ')}]`);
            }
            // Check for duplicates
            const searchParams = {};
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
                    const duplicates = await this.duplicateDetection.findPotentialDuplicates(patient, searchResults);
                    if (duplicates.length > 0) {
                        const match = duplicates[0];
                        if (match.score.matchLevel === 'auto-match') {
                            logger.info({
                                recordId: record.id,
                                matchScore: match.score.totalScore,
                                existingPatientId: match.patient.id,
                            }, 'Auto-match found - updating existing patient');
                            finalPatient = this.missingDataHandler.mergePatientData(patient, match.patient);
                            finalPatient.id = match.patient.id;
                            isUpdate = true;
                        }
                        else if (match.score.matchLevel === 'potential-match') {
                            logger.warn({
                                recordId: record.id,
                                matchScore: match.score.totalScore,
                                existingPatientId: match.patient.id,
                            }, 'Potential duplicate - creating new patient');
                        }
                    }
                }
                catch (error) {
                    logger.warn({ recordId: record.id, error: error instanceof Error ? error.message : String(error) }, 'Duplicate search failed - creating new patient');
                }
            }
            // Step 3: Send to OpenHIM
            const fhirBundle = bundle_builder_1.BundleBuilder.createTransactionBundle(finalPatient);
            await this.openhimClient.sendBundle(fhirBundle);
            logger.info({ recordId: record.id, impiloId: decryptedImpiloId, action: isUpdate ? 'updated' : 'created' }, 'Successfully sent to OpenHIM');
            // Step 4: On success, hash the impilo_id and mark as synced
            const hashedImpiloId = sync_service_1.SyncService.hashImpiloId(decryptedImpiloId);
            await this.pool.query(`UPDATE cdc_failed_records
         SET impilo_id = $1, synced = true, last_error = NULL
         WHERE id = $2`, [hashedImpiloId, record.id]);
            logger.info({ recordId: record.id, hashedImpiloId: hashedImpiloId.substring(0, 8) }, 'Updated failed record: impilo_id hashed and synced marked as true');
        }
        catch (error) {
            // Step 5: On failure, keep encrypted and update error
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({ recordId: record.id, error: errorMessage }, 'Failed to process synced entry - keeping encrypted for retry');
            try {
                await this.pool.query(`SELECT update_failed_session_retry($1, $2, $3)`, [record.id, errorMessage, false]);
            }
            catch (updateError) {
                logger.error({ recordId: record.id, updateError: updateError instanceof Error ? updateError.message : String(updateError) }, 'Failed to update failed record status');
            }
            throw error;
        }
    }
    async processEntry(entry, syncId) {
        try {
            if (!entry.script) {
                throw new Error(`Missing script data for entry ${entry.uid}`);
            }
            const patientData = (0, neotree_mapper_1.mapNeotreeToPatientData)(entry);
            const validation = (0, validation_1.validateAllResources)(patientData);
            if (!validation.canProceed) {
                throw new Error(`Validation failed: missing required fields [${validation.patient.missingFields.join(', ')}]`);
            }
            const patient = this.patientTranslator.translate(patientData);
            // Check missing data
            const missingDataReport = this.missingDataHandler.analyzeMissingData(patient, entry.uid);
            if (!missingDataReport.canProceed) {
                throw new Error(`Critical fields missing: [${missingDataReport.criticalFieldsMissing.join(', ')}]`);
            }
            // Check for duplicates
            const searchParams = {};
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
                    const duplicates = await this.duplicateDetection.findPotentialDuplicates(patient, searchResults);
                    if (duplicates.length > 0) {
                        const match = duplicates[0];
                        if (match.score.matchLevel === 'auto-match') {
                            logger.info({ uid: entry.uid, matchScore: match.score.totalScore, existingPatientId: match.patient.id }, 'Auto-match found - updating existing patient');
                            finalPatient = this.missingDataHandler.mergePatientData(patient, match.patient);
                            finalPatient.id = match.patient.id;
                            isUpdate = true;
                        }
                        else if (match.score.matchLevel === 'potential-match') {
                            logger.warn({ uid: entry.uid, matchScore: match.score.totalScore, existingPatientId: match.patient.id }, 'Potential duplicate - creating new patient');
                        }
                    }
                }
                catch (error) {
                    logger.warn({ uid: entry.uid, error: error instanceof Error ? error.message : String(error) }, 'Duplicate search failed - creating new patient');
                }
            }
            const fhirBundle = bundle_builder_1.BundleBuilder.createTransactionBundle(finalPatient);
            const response = await this.openhimClient.sendBundle(fhirBundle);
            logger.info({ uid: entry.uid, action: isUpdate ? 'updated' : 'created' }, 'Processed entry');
            return response;
        }
        catch (error) {
            throw (0, errors_1.handleError)(error, logger, { uid: entry.uid, syncId });
        }
    }
    async testConnections() {
        try {
            const openhim = await this.openhimClient.testConnection();
            return { openhim };
        }
        catch {
            return { openhim: false };
        }
    }
    /**
     * Close database connection
     */
    async disconnect() {
        await this.pool.end();
    }
}
exports.AdapterService = AdapterService;
//# sourceMappingURL=adapter-service.js.map