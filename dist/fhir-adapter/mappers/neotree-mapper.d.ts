/**
 * Neotree Data Mapper
 * Extracts and normalizes data from Neotree format
 */
import { NeotreeEntry, NeotreePatientData } from '../../shared/types/neotree.types';
/**
 * Map Neotree entry to standardized patient data
 */
export declare function mapNeotreeToPatientData(entry: NeotreeEntry): NeotreePatientData;
/**
 * Extract vital signs as a map
 */
export declare function extractVitalSigns(data: NeotreePatientData): Map<string, {
    value: number;
    unit: string;
}>;
/**
 * Extract body measurements
 */
export declare function extractBodyMeasurements(data: NeotreePatientData): Map<string, {
    value: number;
    unit: string;
}>;
//# sourceMappingURL=neotree-mapper.d.ts.map