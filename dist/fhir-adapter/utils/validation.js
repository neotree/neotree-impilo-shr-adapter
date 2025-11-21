"use strict";
/**
 * Validation Utilities
 * Validates required fields for FHIR resources before submission
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePatientFields = validatePatientFields;
exports.validateRelatedPersonFields = validateRelatedPersonFields;
exports.validateEncounterFields = validateEncounterFields;
exports.validateAllResources = validateAllResources;
const logger_1 = require("../../shared/utils/logger");
const logger = (0, logger_1.getLogger)('validation');
/**
 * Required fields for Patient resource (main record)
 * These are the minimum fields needed to create a valid Patient resource
 */
const REQUIRED_PATIENT_FIELDS = [
    'uid', // Always required as the primary identifier
];
/**
 * Validate Patient resource required fields
 */
function validatePatientFields(data) {
    const missingFields = [];
    // Check required fields
    for (const field of REQUIRED_PATIENT_FIELDS) {
        if (!data[field]) {
            missingFields.push(field);
        }
    }
    const isValid = missingFields.length === 0;
    if (!isValid) {
        logger.warn({
            uid: data.uid,
            missingFields,
        }, 'Patient record validation failed: missing required fields');
    }
    return {
        isValid,
        missingFields,
        resourceType: 'Patient',
    };
}
/**
 * Validate RelatedPerson resource required fields
 * For RelatedPerson, we need at least one name field (motherFirstName or motherSurname)
 */
function validateRelatedPersonFields(data) {
    const missingFields = [];
    // Check if at least one mother name field is present
    const hasMotherName = Boolean(data.motherFirstName || data.motherSurname);
    if (!hasMotherName) {
        missingFields.push('motherFirstName or motherSurname');
    }
    const isValid = hasMotherName;
    if (!isValid) {
        logger.warn({
            uid: data.uid,
            missingFields,
        }, 'RelatedPerson (mother) validation failed: missing required name fields');
    }
    return {
        isValid,
        missingFields,
        resourceType: 'RelatedPerson',
    };
}
/**
 * Validate Encounter resource required fields
 * Currently not enforced but available for future use
 */
function validateEncounterFields(data) {
    const missingFields = [];
    // Check for admission date/time
    if (!data.admissionDateTime) {
        missingFields.push('admissionDateTime');
    }
    const isValid = missingFields.length === 0;
    if (!isValid) {
        logger.warn({
            uid: data.uid,
            missingFields,
        }, 'Encounter validation failed: missing required fields');
    }
    return {
        isValid,
        missingFields,
        resourceType: 'Encounter',
    };
}
/**
 * Validate all resources and return validation results
 * This provides a comprehensive validation report
 */
function validateAllResources(data) {
    const patient = validatePatientFields(data);
    const relatedPerson = validateRelatedPersonFields(data);
    const encounter = validateEncounterFields(data);
    // Can proceed only if the main Patient resource is valid
    const canProceed = patient.isValid;
    if (!canProceed) {
        logger.error({
            uid: data.uid,
            patientMissingFields: patient.missingFields,
        }, 'Cannot proceed with submission: Patient record has missing required fields');
    }
    return {
        patient,
        relatedPerson,
        encounter,
        canProceed,
    };
}
//# sourceMappingURL=validation.js.map