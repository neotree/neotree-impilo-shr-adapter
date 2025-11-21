/**
 * FHIR Condition Resource Translator
 * Transforms diagnoses to FHIR Condition resources
 */
import type { FHIRCondition } from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
export declare class ConditionTranslator {
    private config;
    /**
     * Translate Neotree diagnoses to FHIR Condition resources
     */
    translate(data: NeotreePatientData, patientReference: string, encounterReference?: string): FHIRCondition[];
    /**
     * Build a single condition resource
     */
    private buildCondition;
    /**
     * Build condition code
     * In a production system, you would map these to SNOMED CT or ICD-10 codes
     */
    private buildConditionCode;
}
//# sourceMappingURL=condition-translator.d.ts.map