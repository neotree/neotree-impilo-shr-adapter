/**
 * FHIR Observation Resource Translator
 * Transforms vital signs and measurements to FHIR Observation resources
 */
import type { FHIRObservation } from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
export declare class ObservationTranslator {
    private config;
    /**
     * Translate Neotree data to FHIR Observation resources
     */
    translate(data: NeotreePatientData, patientReference: string, encounterReference?: string): FHIRObservation[];
    /**
     * Build a single observation resource
     */
    private buildObservation;
    /**
     * Build Apgar score observation
     */
    private buildApgarObservation;
    /**
     * Calculate the effective time for Apgar score
     */
    private calculateApgarTime;
}
//# sourceMappingURL=observation-translator.d.ts.map