/**
 * Neotree Data Types
 * Types representing the structure of data from the Neotree system
 */

export interface NeotreeEntry {
  uid: string;
  impilo_uid?: string;
  appEnv: string;
  script?: {
    id: string;
    type: 'admission' | 'discharge' | 'outcome';
    title: string;
  };
  country: string;
  entries: Record<string, EntryField>;
  app_mode: string;
  diagnoses: Diagnosis[];
  appVersion: string;
  started_at: string;
  unique_key: string;
  canceled_at: string | null;
  hospital_id: string;
  scriptTitle: string;
  completed_at: string;
  scriptVersion: number;
}

export interface EntryField {
  type: string;
  values: {
    label: (string | number | null)[];
    value: (string | number | null)[];
  };
  comments: string[];
  prePopulate: string[];
}

export interface Diagnosis {
  [key: string]: {
    Priority: number;
    Suggested: boolean;
    hcw_agree: string;
    hcw_reason_given: string | null;
    hcw_follow_instructions: string | null;
  };
}

export interface NeotreePatientData {
  // Patient identifiers
  uid: string;
  impilo_uid?: string;
  person_id?: string; // Facility-specific person ID (nfor)
  uniqueKey: string;

  // ===== BABY DEMOGRAPHICS =====
  babyFirstName?: string;
  babyLastName?: string;
  gender?: string;
  dateOfBirth?: string;
  timeOfBirth?: string;

  // ===== BABY VITAL SIGNS & MEASUREMENTS =====
  birthWeight?: number;           // in grams
  admissionWeight?: number;       // in grams
  length?: number;                // in cm
  ofc?: number;                   // Occipital Frontal Circumference, in cm
  gestation?: number;             // in weeks
  methodEstGest?: string;         // Method of estimating gestation (e.g., "LMP")
  heartRate?: number;             // beats/min
  respiratoryRate?: number;       // breaths/min
  temperature?: number;           // in Celsius
  saturation?: number;            // oxygen saturation in air, %
  bloodSugarMmol?: number;        // in mmol/L
  bloodSugarMg?: number;          // in mg/dL

  // ===== BABY APGAR SCORES =====
  apgar1?: number;
  apgar5?: number;
  apgar10?: number;
  cryBirth?: boolean;             // Did baby cry at birth?
  resuscitation?: string[];       // Resuscitation methods (e.g., ["Stimulation", "Suctioning"])

  // ===== BABY EXAMINATIONS - GENERAL =====
  suckReflex?: string;            // Suck reflex assessment (e.g., "Strong", "Weak", "Absent")
  palate?: string;                // Palate examination (e.g., "Normal", "Cleft")
  headShape?: string;             // Head shape (e.g., "Normal", "Caput", "Cephalohematoma")
  dysmorphic?: boolean;           // Dysmorphic features present?
  tone?: string;                  // Muscle tone assessment (e.g., "Normal", "Hypertonic", "Hypotonic")
  spine?: string;                 // Spine condition (e.g., "Normal", "Scoliosis")
  activity?: string;              // Activity level (e.g., "Alert", "Drowsy", "Lethargic")
  fontanelle?: string;            // Fontanelle state (e.g., "Normal", "Bulging", "Sunken")

  // ===== BABY EXAMINATIONS - RESPIRATORY =====
  signsRD?: string[];             // Respiratory distress signs (array of findings)
  wob?: string;                   // Work of breathing (e.g., "Normal", "Mild", "Severe")
  chestAusc?: string[];           // Chest auscultation findings (array)
  colour?: string;                // Skin color/appearance (e.g., "Pink", "Pale", "Cyanotic")

  // ===== BABY EXAMINATIONS - CIRCULATION =====
  crt?: string;                   // Capillary refill time (e.g., "<2sec", "2-3sec", "Prolonged")

  // ===== BABY EXAMINATIONS - ABDOMEN & GENITALIA =====
  signsDehydrations?: string[];   // Dehydration signs (array)
  abdomen?: string[];             // Abdominal examination findings (array)
  umbilicus?: string[];           // Umbilicus condition (array of findings)
  genitalia?: string;             // Genital examination findings
  anus?: boolean;                 // Anus patent?

  // ===== BABY EXAMINATIONS - MUSCULOSKELETAL & SKIN =====
  mskProblems?: string[];         // Musculoskeletal problems (array)
  jaundice?: string;              // Jaundice assessment (e.g., "Yes", "No", "Mild", "Severe")
  skin?: string[];                // Skin examination findings (array)

  // ===== MOTHER/GUARDIAN DETAILS =====
  motherFirstName?: string;
  motherSurname?: string;
  motherDOB?: string;
  motherAgeYears?: number;        // Mother's age in years
  maritalStatus?: string;         // e.g., "Single", "Married", "Divorced"
  motherEthnicity?: string;       // Mother's ethnicity
  motherReligion?: string;        // Mother's religion
  motherProvince?: string;        // Mother's province/state

  // ===== MOTHER HIV/INFECTION STATUS =====
  motherHIVTest?: boolean;        // Had HIV test?
  motherHIVTestDate?: string;     // Date of test
  motherHIVStatus?: string;       // Test result (e.g., "Positive", "Negative", "Unknown")
  haart?: boolean;                // On HAART (antiretroviral therapy)?
  maternalViralLoad?: number;     // Viral load count
  nvpGiven?: boolean;             // NVP (Nevirapine) given to baby?
  syphilisTestDate?: string;      // Date of syphilis test
  syphilisResult?: string;        // Syphilis test result (e.g., "Positive", "Negative")

  // ===== MOTHER PREGNANCY CONDITIONS =====
  pregnancyConditions?: string[]; // Medical conditions in pregnancy (array)
  antenatalCareVisits?: number;   // Number of ANC visits
  tetanusToxoidVaccine?: boolean; // Tetanus vaccine received?
  ironSupplementation?: boolean;  // Iron received?
  folateSupplementation?: boolean; // Folic acid received?
  antenatalSteroids?: boolean;    // Antenatal steroids given?

  // ===== LABOUR & DELIVERY HISTORY =====
  labourProblems?: string[];      // Problems during labour (array)
  labourDuration?: number;        // Duration in hours
  romLength?: string;             // Time from ROM to birth (e.g., "< 6 hours", ">18 hours")
  maternalSepsisRiskFactors?: string[]; // Sepsis risk factors (array)
  modeOfDelivery?: string;        // e.g., "Vaginal", "Cesarean", "Assisted"

  // ===== CLINICAL DATA & ADMISSION =====
  admissionReason?: string;       // Main reason for admission
  admissionDateTime?: string;
  dischargeDateTime?: string;
  diagnoses: string[];            // Array of diagnoses

  // ===== FACILITY INFORMATION =====
  facilityId?: string;
  facilityName?: string;
  birthPlace?: string;

  // ===== TIMESTAMPS =====
  completedAt?: string;           // When form was completed (critical for SHR timing)

  // ===== SCRIPT METADATA =====
  scriptType: 'admission' | 'discharge' | 'outcome';
  hospitalId: string;
  scriptId?: string; // Script ID from source database (used for facility mapping)

  // ===== RAW/ADDITIONAL DATA =====
  rawData?: Record<string, unknown>; // Store any extra fields not explicitly mapped
}
