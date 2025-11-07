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
  uniqueKey: string;

  // Baby details
  babyFirstName?: string;
  babyLastName?: string;
  gender?: string;
  dateOfBirth?: string;
  timeOfBirth?: string;
  birthWeight?: number;
  length?: number;
  ofc?: number; // Occipital Frontal Circumference
  gestation?: number;

  // Mother details
  motherFirstName?: string;
  motherSurname?: string;
  motherDOB?: string;
  motherHIVStatus?: string;
  motherHIVTestDate?: string;

  // Clinical data
  apgar1?: number;
  apgar5?: number;
  apgar10?: number;
  admissionReason?: string;
  diagnoses: string[];

  // Facility information
  facilityId: string;
  facilityName: string;
  birthPlace?: string;

  // Timestamps
  admissionDateTime?: string;
  dischargeDateTime?: string;

  // Vital signs
  heartRate?: number;
  respiratoryRate?: number;
  temperature?: number;
  saturation?: number;

  // Additional clinical
  ethnicity?: string;
  religion?: string;
  modeOfDelivery?: string;

  // Script metadata
  scriptType: 'admission' | 'discharge' | 'outcome';
  hospitalId: string;
}
