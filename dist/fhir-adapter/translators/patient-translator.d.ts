/**
 * FHIR Patient Resource Translator
 * Transforms Neotree patient data to FHIR Patient resource
 */
import type { FHIRPatient } from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
export declare class PatientTranslator {
    private config;
    translate(data: NeotreePatientData): FHIRPatient;
    /**
     * Build patient identifiers
     */
    private buildIdentifiers;
    /**
     * Build patient names
     */
    private buildNames;
    private extractDate;
}
//# sourceMappingURL=patient-translator.d.ts.map