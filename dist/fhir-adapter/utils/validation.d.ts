/**
 * Validation Utilities
 * Validates required fields for FHIR resources before submission
 */
import { NeotreePatientData } from '../../shared/types/neotree.types';
export interface ValidationResult {
    isValid: boolean;
    missingFields: string[];
    resourceType: string;
}
/**
 * Validate Patient resource required fields
 */
export declare function validatePatientFields(data: NeotreePatientData): ValidationResult;
/**
 * Validate RelatedPerson resource required fields
 * For RelatedPerson, we need at least one name field (motherFirstName or motherSurname)
 */
export declare function validateRelatedPersonFields(data: NeotreePatientData): ValidationResult;
/**
 * Validate Encounter resource required fields
 * Currently not enforced but available for future use
 */
export declare function validateEncounterFields(data: NeotreePatientData): ValidationResult;
/**
 * Validate all resources and return validation results
 * This provides a comprehensive validation report
 */
export declare function validateAllResources(data: NeotreePatientData): {
    patient: ValidationResult;
    relatedPerson: ValidationResult;
    encounter: ValidationResult;
    canProceed: boolean;
};
//# sourceMappingURL=validation.d.ts.map