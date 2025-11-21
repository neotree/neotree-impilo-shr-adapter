"use strict";
/**
 * Missing Data Handler
 * Manages missing data using decision rules strategies
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissingDataHandler = void 0;
const decision_rules_loader_1 = require("../../shared/utils/decision-rules-loader");
class MissingDataHandler {
    constructor() {
        const decisionRules = (0, decision_rules_loader_1.loadDecisionRules)();
        this.rules = decisionRules.rules;
    }
    /**
     * Analyze missing data in a patient record
     */
    analyzeMissingData(patient, uid) {
        const missingFields = [];
        const criticalFieldsMissing = [];
        const warnings = [];
        // Get all unique fields from all rules
        const allFields = new Map();
        for (const rule of this.rules) {
            for (const [fieldName, fieldRule] of Object.entries(rule.fields)) {
                if (!allFields.has(fieldName)) {
                    allFields.set(fieldName, fieldRule);
                }
            }
        }
        // Check each field
        for (const [fieldName, fieldRule] of allFields.entries()) {
            const value = this.extractFieldValue(patient, fieldRule);
            if (value === null) {
                missingFields.push(fieldName);
                // Determine criticality based on weight and null handling
                if (this.isCriticalField(fieldRule)) {
                    criticalFieldsMissing.push(fieldName);
                }
                warnings.push(`${fieldName} (weight: ${fieldRule.weight}, handling: ${fieldRule.null_handling})`);
            }
        }
        // Decision: can proceed if no conservative fields are missing
        const canProceed = criticalFieldsMissing.length === 0;
        return {
            uid,
            missingFields,
            criticalFieldsMissing,
            canProceed,
            warnings,
        };
    }
    /**
     * Extract field value from FHIR Patient
     */
    extractFieldValue(patient, fieldRule) {
        const path = fieldRule.espath;
        switch (path) {
            case 'identifier.neotreeId':
                return patient.identifier?.find((i) => i.system === 'urn:neotree:impilo-id')?.value || null;
            case 'identifier.patientId':
                return patient.identifier?.find((i) => i.system === 'urn:impilo:uid')?.value || null;
            case 'birthDate':
                return patient.birthDate || null;
            case 'family':
                return patient.name?.[patient.name.length - 1]?.family || null;
            case 'given':
                return patient.name?.[patient.name.length - 1]?.given?.[0] || null;
            case 'gender':
                return patient.gender || null;
            default:
                return null;
        }
    }
    /**
     * Determine if a field is critical based on its rules
     */
    isCriticalField(fieldRule) {
        // Critical if:
        // - High weight (>= 7)
        // - Conservative null handling
        return fieldRule.weight >= 7 || fieldRule.null_handling === 'conservative';
    }
    /**
     * Merge data from existing patient into new patient (fill missing fields)
     */
    mergePatientData(newPatient, existingPatient) {
        const merged = { ...newPatient };
        // Merge identifiers
        if (!merged.identifier || merged.identifier.length === 0) {
            merged.identifier = existingPatient.identifier;
        }
        // Merge birthDate
        if (!merged.birthDate && existingPatient.birthDate) {
            merged.birthDate = existingPatient.birthDate;
        }
        // Merge gender
        if (!merged.gender && existingPatient.gender) {
            merged.gender = existingPatient.gender;
        }
        // Merge name
        if (!merged.name || merged.name.length === 0 || !merged.name[0].family) {
            if (existingPatient.name && existingPatient.name.length > 0) {
                merged.name = existingPatient.name;
            }
        }
        return merged;
    }
}
exports.MissingDataHandler = MissingDataHandler;
//# sourceMappingURL=missing-data-handler.js.map