/**
 * FHIR RelatedPerson Resource Translator
 * Transforms mother data to FHIR RelatedPerson resource
 */
import type { FHIRRelatedPerson } from '../../shared/types/fhir.types';
import { NeotreePatientData } from '../../shared/types/neotree.types';
export declare class RelatedPersonTranslator {
    private config;
    /**
     * Translate Neotree mother data to FHIR RelatedPerson resource
     */
    translate(data: NeotreePatientData, patientReference: string): FHIRRelatedPerson | null;
    /**
     * Build mother identifiers
     */
    private buildIdentifiers;
    /**
     * Build mother relationship
     */
    private buildMotherRelationship;
    /**
     * Build mother names
     */
    private buildNames;
    /**
     * Build baby display name for reference
     */
    private buildBabyDisplay;
}
//# sourceMappingURL=related-person-translator.d.ts.map