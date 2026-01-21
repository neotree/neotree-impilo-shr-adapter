/**
 * Neotree Data Mapper
 * Extracts and normalizes data from Neotree format
 */

import { NeotreeEntry, NeotreePatientData } from '../../shared/types/neotree.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFieldValue(entries: Record<string, any>, fieldName: string): any {
  const field = entries[fieldName];
  if (!field || !field.values || !field.values.value) {
    return null;
  }

  const value = field.values.value[0];
  return value !== null && value !== undefined ? value : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFieldLabel(entries: Record<string, any>, fieldName: string): any {
  const field = entries[fieldName];
  if (!field || !field.values || !field.values.label) {
    return null;
  }

  const label = field.values.label[0];
  return label !== null && label !== undefined ? label : null;
}

function _combineDateAndTime(date: string | null, time?: string | null): string | null {
  if (!date) return null;

  try {
    const dateObj = new Date(date);
    if (time) {
      const timeObj = new Date(time);
      dateObj.setHours(timeObj.getHours(), timeObj.getMinutes(), timeObj.getSeconds());
    }
    return dateObj.toISOString();
  } catch {
    return null;
  }
}

/**
 * Map Neotree entry to standardized patient data
 * Enhanced to extract 40+ fields including examinations, maternal history, and labour data
 */
export function mapNeotreeToPatientData(
  entry: NeotreeEntry,
  facilityId?: string,
  facilityName?: string
): NeotreePatientData {
  const { entries } = entry;

  // Helper function to extract array values (for SET<STRING> fields)
  const getFieldArrayValue = (fieldName: string): string[] | undefined => {
    const field = entries[fieldName];
    if (!field || !field.values || !field.values.value) {
      return undefined;
    }
    const values = field.values.value;
    if (!Array.isArray(values) || values.length === 0) {
      return undefined;
    }
    return values.filter((v) => v && v !== 'NONE') as string[];
  };

  // Helper function to get boolean value
  const getFieldBoolean = (fieldName: string): boolean | undefined => {
    const value = getFieldValue(entries, fieldName);
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return value.toUpperCase() === 'Y' || value.toUpperCase() === 'TRUE' || value === '1';
    }
    return !!value;
  };

  // ===== BABY DEMOGRAPHICS =====
  const babyFirstName = getFieldValue(entries, 'BabyFirst');
  const babyLastName = getFieldValue(entries, 'BabyLast');
  const gender = getFieldValue(entries, 'Gender');
  const dobDate = getFieldValue(entries, 'DOBTOB');
  const timeOfBirth = getFieldValue(entries, 'TimeOfBirth');

  // ===== BABY VITAL SIGNS & MEASUREMENTS =====
  const birthWeight = getFieldValue(entries, 'BirthWeight');
  const admissionWeight = getFieldValue(entries, 'AdmissionWeight');
  const length = getFieldValue(entries, 'Length');
  const ofc = getFieldValue(entries, 'OFC');
  const gestation = getFieldValue(entries, 'Gestation');
  const methodEstGest = getFieldValue(entries, 'MethodEstGest');
  const heartRate = getFieldValue(entries, 'HR') || getFieldValue(entries, 'DischHR');
  const respiratoryRate = getFieldValue(entries, 'RR') || getFieldValue(entries, 'DischRR');
  const temperature = getFieldValue(entries, 'Temperature') || getFieldValue(entries, 'DischTemp');
  const saturation = getFieldValue(entries, 'SatsAir') || getFieldValue(entries, 'DischSats');
  const bloodSugarMmol = getFieldValue(entries, 'BSmmol');
  const bloodSugarMg = getFieldValue(entries, 'Bsmg');

  // ===== BABY APGAR & BIRTH =====
  const apgar1 = getFieldValue(entries, 'Apgar1');
  const apgar5 = getFieldValue(entries, 'Apgar5');
  const apgar10 = getFieldValue(entries, 'Apgar10');
  const cryBirth = getFieldBoolean('CryBirth');
  const resuscitation = getFieldArrayValue('Resus');

  // ===== BABY EXAMINATIONS - GENERAL =====
  const suckReflex = getFieldValue(entries, 'SuckReflex');
  const palate = getFieldValue(entries, 'Palate');
  const headShape = getFieldValue(entries, 'HeadShape');
  const dysmorphic = getFieldBoolean('Dysmorphic');
  const tone = getFieldValue(entries, 'Tone');
  const spine = getFieldValue(entries, 'Spine');
  const activity = getFieldValue(entries, 'Activity');
  const fontanelle = getFieldValue(entries, 'Fontanelle');

  // ===== BABY EXAMINATIONS - RESPIRATORY =====
  const signsRD = getFieldArrayValue('SignsRD');
  const wob = getFieldValue(entries, 'Wob');
  const chestAusc = getFieldArrayValue('ChestAusc');
  const colour = getFieldValue(entries, 'Colour');

  // ===== BABY EXAMINATIONS - CIRCULATION =====
  const crt = getFieldValue(entries, 'CRT');

  // ===== BABY EXAMINATIONS - ABDOMEN & GENITALIA =====
  const signsDehydrations = getFieldArrayValue('SignsDehydrations');
  const abdomen = getFieldArrayValue('Abdomen');
  const umbilicus = getFieldArrayValue('Umbilicus');
  const genitalia = getFieldValue(entries, 'Genitalia');
  const anus = getFieldBoolean('Anus2');

  // ===== BABY EXAMINATIONS - MUSCULOSKELETAL & SKIN =====
  const mskProblems = getFieldArrayValue('MSKproblems');
  const jaundice = getFieldValue(entries, 'Jaundice');
  const skin = getFieldArrayValue('Skin');

  // ===== MOTHER/GUARDIAN DETAILS =====
  const motherFirstName = getFieldValue(entries, 'MotherFirstName');
  const motherSurname = getFieldValue(entries, 'MotherSurname');
  const motherDOB = getFieldValue(entries, 'MotherDOB');
  const motherAgeYears = getFieldValue(entries, 'MatAgeYrs');
  const maritalStatus = getFieldValue(entries, 'MaritalStat');
  const motherEthnicity = getFieldValue(entries, 'Ethnicity');
  const motherReligion = getFieldValue(entries, 'Religion');
  const motherProvince = getFieldValue(entries, 'MatAddrProvince');

  // ===== MOTHER HIV/INFECTION STATUS =====
  const motherHIVTest = getFieldBoolean('MatHIVtest');
  const motherHIVTestDate = getFieldValue(entries, 'DateHIVtest');
  const motherHIVStatus = getFieldValue(entries, 'HIVtestResult');
  const haart = getFieldBoolean('HAART');
  const maternalViralLoad = getFieldValue(entries, 'VLNumber');
  const nvpGiven = getFieldBoolean('NVPgiven');
  const syphilisTestDate = getFieldValue(entries, 'ANVDRLDate');
  const syphilisResult = getFieldValue(entries, 'ANVDRLResult');

  // ===== MOTHER PREGNANCY CONDITIONS =====
  const pregnancyConditions = getFieldArrayValue('PregConditions');
  const antenatalCareVisits = getFieldValue(entries, 'AntenatalCare');
  const tetanusToxoidVaccine = getFieldBoolean('TTV');
  const ironSupplementation = getFieldBoolean('Iron');
  const folateSupplementation = getFieldBoolean('Folate');
  const antenatalSteroids = getFieldBoolean('ANSteroids');

  // ===== LABOUR & DELIVERY HISTORY =====
  const labourProblems = getFieldArrayValue('ProbsLab');
  const labourDuration = getFieldValue(entries, 'DurationLab');
  const romLength = getFieldValue(entries, 'ROMLength');
  const maternalSepsisRiskFactors = getFieldArrayValue('RFSepsis');
  const modeOfDelivery = getFieldValue(entries, 'ModeDelivery');

  // ===== CLINICAL DATA & ADMISSION =====
  const admissionReason = getFieldLabel(entries, 'AdmReason');
  const admissionDateTime = getFieldValue(entries, 'DateTimeAdmission');
  const dischargeDateTime = getFieldValue(entries, 'DateTimeDischarge');

  // Extract diagnoses
  const diagnoses: string[] = [];
  if (entry.diagnoses && Array.isArray(entry.diagnoses)) {
    entry.diagnoses.forEach((diagObj) => {
      Object.keys(diagObj).forEach((diagName) => {
        if (diagName && diagName !== 'NONE') {
          diagnoses.push(diagName);
        }
      });
    });
  }

  // Additional admission reason
  const admReasonValue = getFieldValue(entries, 'AdmReason');
  if (admReasonValue && !diagnoses.includes(admReasonValue)) {
    const diagLabel = getFieldLabel(entries, 'AdmReason');
    if (diagLabel) {
      diagnoses.push(diagLabel);
    }
  }

  // ===== OTHER DATA =====
  const completedAt = entry.completed_at;
  const birthPlace = getFieldValue(entries, 'BirthPlace');

  return {
    // Patient identifiers
    uid: entry.uid,
    impilo_uid: entry.impilo_uid,
    uniqueKey: entry.unique_key,

    // Baby demographics
    babyFirstName,
    babyLastName,
    gender: mapGender(gender),
    dateOfBirth: dobDate,
    timeOfBirth,

    // Baby vital signs & measurements
    birthWeight,
    admissionWeight,
    length,
    ofc,
    gestation,
    methodEstGest,
    heartRate,
    respiratoryRate,
    temperature,
    saturation,
    bloodSugarMmol,
    bloodSugarMg,

    // Baby Apgar & birth
    apgar1,
    apgar5,
    apgar10,
    cryBirth,
    resuscitation,

    // Baby examinations - general
    suckReflex,
    palate,
    headShape,
    dysmorphic,
    tone,
    spine,
    activity,
    fontanelle,

    // Baby examinations - respiratory
    signsRD,
    wob,
    chestAusc,
    colour,

    // Baby examinations - circulation
    crt,

    // Baby examinations - abdomen & genitalia
    signsDehydrations,
    abdomen,
    umbilicus,
    genitalia,
    anus,

    // Baby examinations - musculoskeletal & skin
    mskProblems,
    jaundice,
    skin,

    // Mother/Guardian details
    motherFirstName,
    motherSurname,
    motherDOB,
    motherAgeYears,
    maritalStatus,
    motherEthnicity,
    motherReligion,
    motherProvince,

    // Mother HIV/Infection status
    motherHIVTest,
    motherHIVTestDate,
    motherHIVStatus,
    haart,
    maternalViralLoad,
    nvpGiven,
    syphilisTestDate,
    syphilisResult,

    // Mother pregnancy conditions
    pregnancyConditions,
    antenatalCareVisits,
    tetanusToxoidVaccine,
    ironSupplementation,
    folateSupplementation,
    antenatalSteroids,

    // Labour & delivery history
    labourProblems,
    labourDuration,
    romLength,
    maternalSepsisRiskFactors,
    modeOfDelivery,

    // Clinical data & admission
    admissionReason,
    admissionDateTime,
    dischargeDateTime,
    diagnoses,

    // Facility information
    facilityId,
    facilityName,
    birthPlace,

    // Timestamps
    completedAt,

    // Script metadata
    scriptType: entry.script?.type || 'admission',
    hospitalId: entry.hospital_id,
    scriptId: entry.script?.id,
  };
}

/**
 * Map Neotree gender codes to FHIR 1
 */
function mapGender(code: string | null): string | undefined {
  if (!code) return undefined;

  const genderMap: Record<string, string> = {
    M: 'male',
    F: 'female',
    U: 'unknown',
    O: 'other',
  };

  return genderMap[code.toUpperCase()] || 'unknown';
}

/**
 * Extract vital signs as a map
 */
export function extractVitalSigns(data: NeotreePatientData): Map<string, { value: number; unit: string }> {
  const vitals = new Map<string, { value: number; unit: string }>();

  if (data.heartRate) {
    vitals.set('heart-rate', { value: data.heartRate, unit: 'beats/min' });
  }

  if (data.respiratoryRate) {
    vitals.set('respiratory-rate', { value: data.respiratoryRate, unit: 'breaths/min' });
  }

  if (data.temperature) {
    vitals.set('body-temperature', { value: data.temperature, unit: 'Cel' });
  }

  if (data.saturation) {
    vitals.set('oxygen-saturation', { value: data.saturation, unit: '%' });
  }

  return vitals;
}

/**
 * Extract body measurements
 */
export function extractBodyMeasurements(
  data: NeotreePatientData
): Map<string, { value: number; unit: string }> {
  const measurements = new Map<string, { value: number; unit: string }>();

  if (data.birthWeight) {
    measurements.set('body-weight', { value: data.birthWeight, unit: 'g' });
  }

  if (data.length) {
    measurements.set('body-length', { value: data.length, unit: 'cm' });
  }

  if (data.ofc) {
    measurements.set('head-occipital-frontal-circumference', { value: data.ofc, unit: 'cm' });
  }

  return measurements;
}
