/**
 * FHIR Encounter Resource Translator
 * Transforms Neotree admission/discharge data to FHIR Encounter resource
 */
import type { FHIREncounter } from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
export declare class EncounterTranslator {
    private config;
    /**
     * Translate Neotree data to FHIR Encounter resource
     */
    translate(data: NeotreePatientData, patientReference: string): FHIREncounter;
    /**
     * Build encounter identifiers
     */
    private buildIdentifiers;
    /**
     * Determine encounter status
     */
    private determineStatus;
    /**
     * Build encounter class (inpatient for neonatal admissions)
     */
    private buildEncounterClass;
    /**
     * Build encounter type
     */
    private buildEncounterType;
    /**
     * Build encounter period
     */
    private buildPeriod;
    /**
     * Build reason codes (admission reason)
     */
    private buildReasonCodes;
    /**
     * Build service provider reference
     */
    private buildServiceProvider;
    /**
     * Build patient display name
     */
    private buildPatientDisplay;
}
//# sourceMappingURL=encounter-translator.d.ts.map