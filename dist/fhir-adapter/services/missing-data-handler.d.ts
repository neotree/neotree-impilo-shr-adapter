/**
 * Missing Data Handler
 * Manages missing data using decision rules strategies
 */
import { FHIRPatient } from '../../shared/types/fhir.types';
export interface MissingDataReport {
    uid: string;
    missingFields: string[];
    criticalFieldsMissing: string[];
    canProceed: boolean;
    warnings: string[];
}
export declare class MissingDataHandler {
    private rules;
    constructor();
    /**
     * Analyze missing data in a patient record
     */
    analyzeMissingData(patient: FHIRPatient, uid: string): MissingDataReport;
    /**
     * Extract field value from FHIR Patient
     */
    private extractFieldValue;
    /**
     * Determine if a field is critical based on its rules
     */
    private isCriticalField;
    /**
     * Merge data from existing patient into new patient (fill missing fields)
     */
    mergePatientData(newPatient: FHIRPatient, existingPatient: FHIRPatient): FHIRPatient;
}
//# sourceMappingURL=missing-data-handler.d.ts.map