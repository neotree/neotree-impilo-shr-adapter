/**
 * Duplicate Detection Service
 * Uses decision rules to detect potential duplicates
 */
import { FHIRPatient, FHIRBundle } from '../../shared/types/fhir.types';
import { MatchScore } from '../../shared/types/decision-rules.types';
export declare class DuplicateDetectionService {
    private rules;
    constructor();
    /**
     * Find potential duplicates for a patient
     */
    findPotentialDuplicates(patient: FHIRPatient, searchResults: FHIRBundle): Promise<{
        patient: FHIRPatient;
        score: MatchScore;
    }[]>;
    /**
     * Calculate the best match score across all rules
     */
    private calculateBestMatchScore;
    /**
     * Calculate match score for a specific rule
     */
    private calculateMatchScore;
    /**
     * Extract field value from FHIR Patient using simplified path
     */
    private extractFieldValue;
    /**
     * Compare two field values using the specified algorithm
     */
    private compareFields;
    /**
     * Handle case where both values are null
     */
    private handleBothNull;
    /**
     * Handle case where one value is null
     */
    private handleOneNull;
    /**
     * Get score based on null handling strategy
     */
    private getNullScore;
}
//# sourceMappingURL=duplicate-detection-service.d.ts.map