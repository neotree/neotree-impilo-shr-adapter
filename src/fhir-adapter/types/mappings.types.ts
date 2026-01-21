/**
 * Mapping Type Definitions
 * Defines interfaces for dynamic, configuration-driven field mappings
 */

/**
 * Supported FHIR data types
 */
export type FHIRDataType = 'string' | 'number' | 'boolean' | 'date' | 'code' | 'quantity' | 'codeableconcept';

/**
 * Supported FHIR resource types for mapping
 */
export type FHIRResourceType = 'Observation' | 'Condition' | 'MedicationStatement' | 'Procedure' | 'QuestionnaireResponse';

/**
 * Code system identifiers
 */
export enum CodeSystem {
  LOINC = 'http://loinc.org',
  SNOMED = 'http://snomed.info/sct',
  ICD10 = 'http://hl7.org/fhir/sid/icd-10-cm',
  CIEL = 'http://ciel.ilibrary.org',
  NEOTREE = 'urn:neotree:data-key',
  OBSERVATION_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category',
  UNITS_OF_MEASURE = 'http://unitsofmeasure.org',
}

/**
 * Observation categories
 */
export enum ObservationCategory {
  VITAL_SIGNS = 'vital-signs',
  EXAM_FINDING = 'exam-finding',
  IMAGING = 'imaging',
  LABORATORY = 'laboratory',
  PROCEDURE = 'procedure',
  SURVEY = 'survey',
  THERAPY = 'therapy',
  ACTIVITY = 'activity',
}

/**
 * Single field mapping configuration
 */
export interface FieldMapping {
  // Identification
  neotreeKey: string;                    // Neotree source field name (e.g., "RR")
  neotreeDisplayName?: string;           // Human-readable display name
  neotreeDescription?: string;           // Field description from mapper

  // FHIR Target
  fhirResourceType: FHIRResourceType;    // "Observation", "Condition", etc.
  fhirElementPath?: string;              // Path like "valueQuantity.value"
  fhirDataType: FHIRDataType;            // Data type mapping

  // Coding/Terminology
  codeSystem?: CodeSystem;               // Which coding system to use
  code?: string;                         // Specific code (LOINC, SNOMED, etc.)
  codeDisplay?: string;                  // Human-readable code display

  // For Observations specifically
  observationCategory?: ObservationCategory;
  categorySystem?: string;               // Optional category system override (e.g., urn:neotree:question-category)
  categoryCode?: string;                 // Optional category code override (e.g., "67")
  categoryDisplay?: string;              // Optional category display override
  unit?: string;                         // Unit of measure (e.g., "bpm")
  ucumCode?: string;                     // UCUM code (e.g., "/min")

  // Data handling
  required?: boolean;                    // Is this field required?
  multiValue?: boolean;                  // Does field have multiple values (SET<STRING>)?
  valueMapping?: Record<string, string>; // Map input values to output codes (e.g., {"Y": "true", "N": "false"})

  // Fallback behavior
  questionnaireFallback?: boolean;       // If mapping fails, store as questionnaire response
  fallbackQuestionId?: string;           // Questionnaire question link ID

  // Metadata
  priority?: number;                     // 1=high, 2=medium, 3=low (for processing order)
  deprecated?: boolean;                  // Is this mapping deprecated?
  notes?: string;                        // Additional notes or warnings
}

/**
 * Questionnaire configuration for unmapped fields
 */
export interface QuestionnaireConfig {
  id: string;                            // Questionnaire resource ID
  url: string;                           // Questionnaire canonical URL
  title: string;                         // Display title
  description?: string;                  // Description
  version?: string;                      // Version
  questions: QuestionConfig[];           // Array of questions
  genericQuestion?: GenericQuestionConfig; // Fallback template for unmapped keys
}

/**
 * Single questionnaire question
 */
export interface QuestionConfig {
  linkId: string;                        // Unique link ID
  text: string;                          // Question text
  type: 'string' | 'boolean' | 'choice' | 'open-choice' | 'decimal' | 'integer' | 'date' | 'time' | 'dateTime';
  required?: boolean;                    // Is answer required?
  options?: QuestionOption[];            // Answer options for choice questions
  group?: string;                        // Group/category this question belongs to
}

/**
 * Generic question template for unmapped keys
 */
export interface GenericQuestionConfig {
  linkIdPrefix: string;                  // Prefix for linkId (e.g., neonatal-question-)
  textTemplate?: string;                 // Template with {key} placeholder
  type: QuestionConfig['type'];          // Question data type
  group?: string;                        // Group/category for the generic question
}

/**
 * Answer option for questionnaire choice questions
 */
export interface QuestionOption {
  code: string;                          // Option code
  display: string;                       // Display text
}

/**
 * Main mapping configuration
 */
export interface MappingConfiguration {
  // Metadata
  version: string;                       // Configuration version (e.g., "1.0.0")
  facilityId?: string;                   // Facility-specific config (undefined = default)
  facilityName?: string;                 // Human-readable facility name
  description?: string;                  // Configuration description
  lastUpdated?: string;                  // ISO 8601 timestamp

  // Field mappings
  fieldMappings: FieldMapping[];         // Array of all field mappings

  // Questionnaire for unmapped fields
  questionnaire?: QuestionnaireConfig;   // Optional questionnaire for unmapped data

  // Configuration options
  options?: {
    enableQuestionnaireFallback?: boolean;  // Default fallback behavior
    strictMode?: boolean;                   // Fail if required field cannot be mapped
    logUnmappedFields?: boolean;            // Log when field not found in mapping
    allowCustomExtensions?: boolean;        // Allow facility-specific extensions
  };
}

/**
 * Mapping resolution result
 */
export interface MappingResolution {
  found: boolean;                        // Was mapping found?
  mapping?: FieldMapping;                // The mapping if found
  reason?: string;                       // Why mapping wasn't found (if applicable)
  alternatives?: FieldMapping[];         // Alternative mappings to consider
}

/**
 * Extracted and mapped field data
 */
export interface MappedFieldData {
  neotreeKey: string;                    // Original Neotree key
  neotreeValue: unknown;                 // Original value
  mapping: FieldMapping;                 // Mapping configuration used
  fhirResource: {                        // Generated FHIR resource details
    resourceType: FHIRResourceType;
    elementPath?: string;
    value: unknown;                      // Transformed value
    metadata?: Record<string, unknown>;  // Additional metadata
  };
}

/**
 * Mapping application result
 */
export interface MappingResult {
  success: boolean;                      // Was mapping successful?
  mappedFields: MappedFieldData[];        // Successfully mapped fields
  unmappedFields: {                       // Fields that couldn't be mapped
    key: string;
    value: unknown;
    reason: string;
  }[];
  errors: {                              // Any errors during mapping
    field: string;
    error: string;
  }[];
  questionnaireFallbacks?: {             // Fields stored in questionnaire fallback
    questionId: string;
    neotreeKey: string;
    value: unknown;
  }[];
}

/**
 * Facility-specific mapping configuration override
 */
export interface FacilityMappingOverride {
  facilityId: string;                    // Which facility
  mappingOverrides: {                    // Override specific mappings
    neotreeKey: string;                  // Which field to override
    override: Partial<FieldMapping>;     // Fields to override
  }[];
  additionalMappings?: FieldMapping[];   // Add new mappings
  disabledMappings?: string[];           // Disable specific mappings
}

/**
 * Mapping statistics/audit
 */
export interface MappingAudit {
  timestamp: string;                     // When mapping was applied
  facilityId: string;                    // Which facility
  neotreeUid: string;                    // Which Neotree record
  mappingVersion: string;                // Which mapping config version
  statistics: {
    totalFields: number;
    mappedFields: number;
    unmappedFields: number;
    questionnaireFallbacks: number;
    errors: number;
    successRate: number;                 // Percentage successfully mapped
  };
  details?: {                            // Detailed field-by-field audit
    mapped: string[];                    // Successfully mapped fields
    unmapped: string[];                  // Unmapped fields
    failed: { [key: string]: string };  // Fields that failed with errors
  };
}
