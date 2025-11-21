#!/usr/bin/env ts-node
/**
 * Generate synthetic test data for source table
 * Usage: npx ts-node scripts/generate-test-data.ts [count] [starting-id] [table-name]
 * Example: npx ts-node scripts/generate-test-data.ts 5 497751 sessions
 */

import { randomInt, randomBytes } from 'crypto';
import { config as dotenvConfig } from 'dotenv';

// Load environment variables
dotenvConfig();

// Configuration
const FACILITY_CODE = 'CB59';
const SCRIPT_ID = '-ZO1TK4zMvLhxTw6eKia';
const SCRIPT_TYPE = 'admission';
const SCRIPT_TITLE = 'Sally Mugabe CH Admission';
const HOSPITAL_ID = '-MZm_dIkquPzKnJl-tbM';

// Sample data pools
const FIRST_NAMES = ['John', 'Mary', 'David', 'Sarah', 'Michael', 'Elizabeth', 'James', 'Jennifer', 'Robert', 'Linda','Karlos','Khedha','Taflo'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez','Mutiro','Magwaza','Endby'];
const GENDERS = ['M', 'F'] as const;
const PROVINCES = [
  { label: 'Harare', value: 'HA' },
  { label: 'Bulawayo', value: 'BU' },
  { label: 'Manicaland', value: 'MA' },
  { label: 'Mashonaland Central', value: 'MC' },
];
const DISTRICTS_HA = [
  { label: 'Glen View', value: 'GLV' },
  { label: 'Mbare', value: 'MBA' },
  { label: 'Highfield', value: 'HIG' },
];

// Helper functions
function randomElement<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

function randomBoolean(): boolean {
  return Math.random() > 0.5;
}

function randomNumber(min: number, max: number): number {
  return randomInt(min, max + 1);
}

function generateUID(): string {
  const number = randomInt(8800000, 8899999);
  return `${FACILITY_CODE}-${number}`;
}

function generateImpiloUID(): string {
  // Generate a UUID v4 format
  return randomBytes(16)
    .toString('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

function generateUniqueKey(): string {
  return randomBytes(16).toString('hex');
}

function generateTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

function generateBirthDateTime(): string {
  const now = new Date();
  const daysAgo = randomInt(1, 7);
  const birthDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return birthDate.toISOString();
}

function generateDateString(): string {
  const date = new Date(generateBirthDateTime());
  const day = String(date.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${day} ${month}, ${year} ${hours}:${minutes}`;
}

function generateTestRecord(id: number) {
  const uid = generateUID();
  const impiloUid = generateImpiloUID();
  const uniqueKey = generateUniqueKey();
  const ingestedAt = generateTimestamp();
  const gender = randomElement(GENDERS);
  const babyFirst = randomElement(FIRST_NAMES);
  const babyLast = randomElement(LAST_NAMES);
  const motherFirst = randomElement(FIRST_NAMES);
  const motherLast = randomElement(LAST_NAMES);
  const birthWeight = randomNumber(2000, 5000);
  const gestation = randomNumber(35, 42);
  const apgar1 = randomNumber(5, 9);
  const apgar5 = randomNumber(7, 10);
  const temperature = (35 + Math.random() * 2).toFixed(1);
  const hr = randomNumber(110, 150);
  const rr = randomNumber(20, 40);
  const ofc = randomNumber(30, 40);
  const length = randomNumber(45, 60);
  const age = randomNumber(1, 48);
  const province = randomElement(PROVINCES);
  const district = randomElement(DISTRICTS_HA);
  const dobTob = generateBirthDateTime();
  const dateHivTest = new Date(new Date(dobTob).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const admissionDateTime = generateDateString();

  const data = {
    uid,
    impilo_uid: impiloUid,
    appEnv: 'PROD',
    script: {
      id: SCRIPT_ID,
      type: SCRIPT_TYPE,
      title: SCRIPT_TITLE,
    },
    country: 'zw',
    entries: {
      HR: { type: 'number', values: { label: [String(hr)], value: [String(hr)] }, comments: [], prePopulate: [] },
      RR: { type: 'timer', values: { label: [rr * 2], value: [String(rr)] }, comments: [], prePopulate: [] },
      Age: { type: 'number', values: { label: [`${age} hours`], value: [age] }, comments: [], prePopulate: ['admissionSearches'] },
      CRT: { type: 'single_select', values: { label: ['Less than 3 seconds'], value: ['Norm'] }, comments: [], prePopulate: [] },
      HBW: birthWeight > 4000 ? { type: 'diagnosis', values: { label: [null], value: ['Macrosomia (>4000g)'] }, comments: [], prePopulate: [] } : { type: 'diagnosis', values: { label: [null], value: ['Normal birth weight'] }, comments: [], prePopulate: [] },
      OFC: { type: 'number', values: { label: [String(ofc)], value: [String(ofc)] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      PAR: { type: 'number', values: { label: [String(randomNumber(1, 5))], value: [String(randomNumber(1, 5))] }, comments: [], prePopulate: ['twinSearches', 'admissionSearches'] },
      TEO: { type: 'dropdown', values: { label: ['No'], value: ['N'] }, comments: [], prePopulate: ['admissionSearches'] },
      TTV: { type: 'dropdown', values: { label: ['Yes'], value: ['Y'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      UID: { type: 'text', values: { label: [null], value: [uid] }, comments: [], prePopulate: [] },
      Firm: { type: 'dropdown', values: { label: ['Dr Christine  Rambanapasi'], value: ['CR'] }, comments: [], prePopulate: [] },
      Iron: { type: 'dropdown', values: { label: ['Yes'], value: ['Y'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      Med1: { type: 'text', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      Med2: { type: 'text', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      Med3: { type: 'text', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      Med4: { type: 'text', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      Plan: { type: 'set<id>', values: { label: ['Admit to Observation', 'Check glucose stat then 4 hourly', 'Observations 4 hourly', 'Keep warm with hat, bootees etc', 'Breast feed with cup top ups'], value: ['AdOb', 'Gluc', 'Obs', 'Warm', 'Cup'] }, comments: [], prePopulate: [] },
      Skin: { type: 'set<id>', values: { label: ['Normal'], value: ['None'] }, comments: [], prePopulate: [] },
      Tone: { type: 'single_select', values: { label: ['Normal tone, movement in all limbs'], value: ['Norm'] }, comments: [], prePopulate: [] },
      VitK: { type: 'dropdown', values: { label: ['No'], value: ['N'] }, comments: [], prePopulate: ['admissionSearches'] },
      Anus2: { type: 'single_select', values: { label: ['Patent (normal)'], value: ['Pat'] }, comments: [], prePopulate: [] },
      Cadre: { type: 'dropdown', values: { label: ['Senior Resident Medical Officer'], value: ['SRMO'] }, comments: [], prePopulate: [] },
      DOBYN: { type: 'dropdown', values: { label: ['Yes'], value: ['Y'] }, comments: [], prePopulate: [] },
      HAART: { type: 'dropdown', values: { label: [null], value: [null] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      HCWID: { type: 'text', values: { label: ['NyTa'], value: ['NyTa'] }, comments: [], prePopulate: [] },
      Resus: { type: 'set<id>', values: { label: ['Stimulation'], value: ['Stim'] }, comments: [], prePopulate: ['admissionSearches'] },
      Spine: { type: 'single_select', values: { label: ['Normal'], value: ['Norm'] }, comments: [], prePopulate: [] },
      ANVDRL: { type: 'single_select', values: { label: ['Yes'], value: ['Y'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      Apgar1: { type: 'number', values: { label: [String(apgar1)], value: [String(apgar1)] }, comments: [], prePopulate: ['admissionSearches'] },
      Apgar5: { type: 'number', values: { label: [String(apgar5)], value: [String(apgar5)] }, comments: [], prePopulate: ['admissionSearches'] },
      BSUnit: { type: 'dropdown', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      Colour: { type: 'set<id>', values: { label: ['Pink'], value: ['Pink'] }, comments: [], prePopulate: [] },
      DOBTOB: { type: 'date', values: { label: [null], value: [dobTob] }, comments: [], prePopulate: ['admissionSearches'] },
      Folate: { type: 'dropdown', values: { label: ['Yes'], value: ['Y'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      Gender: { type: 'single_select', values: { label: [gender === 'M' ? 'Male' : 'Female'], value: [gender] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      Length: { type: 'number', values: { label: [String(length)], value: [String(length)] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      MatAdm: { type: 'yesno', values: { label: ['Yes'], value: ['Yes'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      RespSR: { type: 'set<id>', values: { label: ['None'], value: ['None'] }, comments: [], prePopulate: [] },
      Review: { type: 'dropdown', values: { label: ['No'], value: ['N'] }, comments: [], prePopulate: [] },
      Abdomen: { type: 'set<id>', values: { label: ['Soft and normal'], value: ['Norm'] }, comments: [], prePopulate: [] },
      Apgar10: { type: 'number', values: { label: [null], value: [null] }, comments: [], prePopulate: ['admissionSearches'] },
      BSmonYN: { type: 'dropdown', values: { label: ['No'], value: ['N'] }, comments: [], prePopulate: [] },
      FeverSR: { type: 'yesno', values: { label: ['No'], value: ['No'] }, comments: [], prePopulate: [] },
      InOrOut: { type: 'yesno', values: { label: ['Yes'], value: ['Yes'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      SatsAir: { type: 'number', values: { label: ['100'], value: ['100'] }, comments: [], prePopulate: [] },
      SignsRD: { type: 'set<id>', values: { label: ['NONE'], value: ['None'] }, comments: [], prePopulate: [] },
      SyphAct: { type: 'text', values: { label: [null], value: [null] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      VLKnown: { type: 'dropdown', values: { label: [null], value: [null] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      YColour: { type: 'dropdown', values: { label: [' No'], value: ['N'] }, comments: [], prePopulate: [] },
      Activity: { type: 'single_select', values: { label: ['Alert, active, appropriate'], value: ['Alert'] }, comments: [], prePopulate: [] },
      BabyLast: { type: 'text', values: { label: [babyLast], value: [babyLast] }, comments: [], prePopulate: [] },
      CryBirth: { type: 'dropdown', values: { label: ['No'], value: ['N'] }, comments: [], prePopulate: ['admissionSearches'] },
      FeedsAdm: { type: 'set<id>', values: { label: ['Breast feeding normally'], value: ['BF'] }, comments: [], prePopulate: [] },
      Femorals: { type: 'single_select', values: { label: ['Palpable'], value: ['Present'] }, comments: [], prePopulate: [] },
      Ortolani: { type: 'single_select', values: { label: ['No clunk/click'], value: ['NoOrto'] }, comments: [], prePopulate: [] },
      PUInfant: { type: 'dropdown', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      ProbsLab: { type: 'set<id>', values: { label: ['NONE'], value: ['NONE'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      RFSepsis: { type: 'set<id>', values: { label: ['NONE'], value: ['NONE'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      Religion: { type: 'single_select', values: { label: ['Pentecostal (Christian Protestant)'], value: ['PE'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      ReviewID: { type: 'text', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      VLNumber: { type: 'number', values: { label: [null], value: [null] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      Vomiting: { type: 'set<id>', values: { label: ['NONE'], value: ['No'] }, comments: [], prePopulate: [] },
      AdmReason: { type: 'dropdown', values: { label: birthWeight > 4000 ? ['Macrosomia'] : ['Normal admission'], value: birthWeight > 4000 ? ['Mac'] : ['Norm'] }, comments: [], prePopulate: [] },
      BabyFirst: { type: 'text', values: { label: [babyFirst], value: [babyFirst] }, comments: [], prePopulate: [] },
      ChestAusc: { type: 'set<id>', values: { label: ['Chest is clear'], value: ['Clear'] }, comments: [], prePopulate: [] },
      Ethnicity: { type: 'dropdown', values: { label: ['African'], value: ['A'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      Genitalia: { type: 'single_select', values: { label: [gender === 'M' ? 'Normal Male genitalia' : 'Normal Female genitalia'], value: [gender] }, comments: [], prePopulate: [] },
      Gestation: { type: 'number', values: { label: [String(gestation)], value: [String(gestation)] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      HeadShape: { type: 'single_select', values: { label: ['Normal'], value: ['Norm'] }, comments: [], prePopulate: [] },
      MatAgeYrs: { type: 'number', values: { label: [null], value: [null] }, comments: [], prePopulate: ['admissionSearches'] },
      PUNewborn: { type: 'dropdown', values: { label: ['Not sure'], value: ['Unk'] }, comments: [], prePopulate: [] },
      PassedMec: { type: 'dropdown', values: { label: ['Passed meconium in 1st 24 hrs'], value: ['Mec24'] }, comments: [], prePopulate: [] },
      ROMlength: { type: 'dropdown', values: { label: [' Less than 18 hours'], value: ['NOPROM'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      RiskCovid: { type: 'yesno', values: { label: ['No'], value: ['No'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      TypeBirth: { type: 'dropdown', values: { label: [' Single'], value: ['S'] }, comments: [], prePopulate: [] },
      Umbilicus: { type: 'set<id>', values: { label: ['Healthy & clean'], value: ['Norm'] }, comments: [], prePopulate: [] },
      ANSteroids: { type: 'single_select', values: { label: ['No'], value: ['N'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      ANVDRLDate: { type: 'date', values: { label: [null], value: [null] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      DelivInter: { type: 'set<id>', values: { label: ['Delayed Cord Clamping (greater than 60 secs)', 'Skin to Skin (within 1st hour of life)', 'Breast Feeding (within 1st hour of life)'], value: ['DCC', 'S2S', 'BF'] }, comments: [], prePopulate: ['admissionSearches'] },
      Dysmorphic: { type: 'yesno', values: { label: ['No'], value: ['No'] }, comments: [], prePopulate: [] },
      Ethnicity2: { type: 'text', values: { label: [null], value: [null] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      Fontanelle: { type: 'single_select', values: { label: ['Flat, Not Tense (normal)'], value: ['Flat'] }, comments: [], prePopulate: [] },
      MatHIVtest: { type: 'yesno', values: { label: ['Yes'], value: ['Yes'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      SuckReflex: { type: 'single_select', values: { label: ['Present and strong'], value: ['Strong'] }, comments: [], prePopulate: [] },
      AgeEstimate: { type: 'dropdown', values: { label: [null], value: [null] }, comments: [], prePopulate: ['admissionSearches'] },
      BirthWeight: { type: 'number', values: { label: [String(birthWeight)], value: [String(birthWeight)] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      DangerSigns: { type: 'set<id>', values: { label: ['NONE'], value: ['None'] }, comments: [], prePopulate: [] },
      DateHIVtest: { type: 'date', values: { label: [null], value: [dateHivTest] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      DurationLab: { type: 'number', values: { label: [String(randomNumber(2, 12))], value: [String(randomNumber(2, 12))] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      LengthHAART: { type: 'dropdown', values: { label: [null], value: [null] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      MSKproblems: { type: 'set<id>', values: { label: ['NONE'], value: ['None'] }, comments: [], prePopulate: [] },
      MaritalStat: { type: 'single_select', values: { label: ['Married'], value: ['MAR'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      MotherDOBYN: { type: 'dropdown', values: { label: [' Yes'], value: ['Y'] }, comments: [], prePopulate: [] },
      Readmission: { type: 'dropdown', values: { label: ['No'], value: ['N'] }, comments: [], prePopulate: [] },
      ReviewCadre: { type: 'dropdown', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      Temperature: { type: 'number', values: { label: [temperature], value: [temperature] }, comments: [], prePopulate: ['admissionSearches'] },
      repeatables: {},
      ANVDRLReport: { type: 'dropdown', values: { label: [' From her documentation'], value: ['Doc'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      ANVDRLResult: { type: 'dropdown', values: { label: ['Negative'], value: ['N'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      AdmReasonAdd: { type: 'set<id>', values: { label: ['NONE'], value: ['NONE'] }, comments: [], prePopulate: [] },
      AdmReasonOth: { type: 'text', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      AdmittedFrom: { type: 'single_select', values: { label: ['Labour ward (LW)'], value: ['LW'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      BloodSugarmg: { type: 'number', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      DangerSigns2: { type: 'set<id>', values: { label: ['NONE'], value: ['None'] }, comments: [], prePopulate: [] },
      ModeDelivery: { type: 'dropdown', values: { label: ['Spontaneous Vaginal Delivery'], value: ['1'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      Presentation: { type: 'dropdown', values: { label: ['Vertex'], value: ['Vertex'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      SRNeuroOther: { type: 'set<id>', values: { label: ['NONE'], value: ['None'] }, comments: [], prePopulate: [] },
      StoolsInfant: { type: 'dropdown', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      TestThisPreg: { type: 'dropdown', values: { label: ['During this pregnancy'], value: ['Y'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      AntenatalCare: { type: 'number', values: { label: [String(randomNumber(1, 8))], value: [String(randomNumber(1, 8))] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      BabyCryTriage: { type: 'yesno', values: { label: ['No'], value: ['No'] }, comments: [], prePopulate: [] },
      FurtherTriage: { type: 'single_select', values: { label: ['Stable '], value: ['Stable'] }, comments: [], prePopulate: [] },
      HIVtestReport: { type: 'dropdown', values: { label: ['From her documentation'], value: ['Doc'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      HIVtestResult: { type: 'dropdown', values: { label: ['Negative'], value: ['NR'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      MethodEstGest: { type: 'dropdown', values: { label: ['Last Menstrual Period (LMP)'], value: ['LMP'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      MotherSurname: { type: 'text', values: { label: [motherLast], value: [motherLast] }, comments: [], prePopulate: [] },
      PartnerTrSyph: { type: 'dropdown', values: { label: [null], value: [null] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      ANMatSyphTreat: { type: 'dropdown', values: { label: [null], value: [null] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      BirthPlaceSame: { type: 'yesno', values: { label: ['Yes'], value: ['Yes'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      BloodSugarmmol: { type: 'number', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      PregConditions: { type: 'set<id>', values: { label: ['NONE'], value: ['NONE'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      AdmissionWeight: { type: 'number', values: { label: [null], value: [null] }, comments: [], prePopulate: [] },
      DateVDRLSameHIV: { type: 'dropdown', values: { label: ['Yes'], value: ['Y'] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      MatAddrProvince: { type: 'dropdown', values: { label: [province.label], value: [province.value] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      MotherFirstName: { type: 'text', values: { label: [motherFirst], value: [motherFirst] }, comments: [], prePopulate: [] },
      DateTimeAdmission: { type: 'date', values: { label: [admissionDateTime], value: [admissionDateTime] }, comments: [], prePopulate: [] },
      MatAddrHaDistrict: { type: 'dropdown', values: { label: [district.label], value: [district.value] }, comments: [], prePopulate: ['admissionSearches', 'twinSearches'] },
      EDLIZSummaryTableScore: { type: '', values: { label: [], value: [] }, comments: [], prePopulate: [] },
    },
    app_mode: 'production',
    diagnoses: birthWeight > 4000 ? [{ 'Macrosomia (>4000g)': { Priority: 1, Suggested: false, hcw_agree: 'Yes', hcw_reason_given: null, hcw_follow_instructions: null } }] : [],
    appVersion: '2.5.11',
    started_at: new Date(new Date(dobTob).getTime() + 2 * 60 * 60 * 1000).toISOString(),
    unique_key: uniqueKey,
    canceled_at: null,
    hospital_id: HOSPITAL_ID,
    scriptTitle: SCRIPT_ID,
    completed_at: new Date(new Date(dobTob).getTime() + 3 * 60 * 60 * 1000).toISOString(),
    scriptVersion: 527,
  };

  return {
    id,
    uid,
    impiloUid,
    ingestedAt,
    data: JSON.stringify(data).replace(/'/g, "''"), // Escape single quotes for SQL
    scriptid: SCRIPT_ID,
    uniqueKey,
  };
}

function generateInsertSQL(record: ReturnType<typeof generateTestRecord>, tableName: string): string {
  return `INSERT INTO ${tableName} (id, uid, ingested_at, data, scriptid, unique_key,impilo_uid)
VALUES (
    ${record.id},
    '${record.uid}',
    '${record.ingestedAt}',
    '${record.data}'::jsonb,
    '${record.scriptid}',
    '${record.uniqueKey}',
    '${record.impiloUid}'
);`;
}

// Main script
const args = process.argv.slice(2);
const count = parseInt(args[0] || '1', 10);
const startingId = parseInt(args[1] || '497751', 10);
const tableName = args[2] || process.env.DB_SOURCE_TABLE || 'sessions';

console.log(`-- Generated test data for ${tableName} table`);
console.log(`-- Count: ${count}, Starting ID: ${startingId}`);
console.log(`-- Generated at: ${new Date().toISOString()}`);
console.log('-- Usage: psql -U postgres -d neotree_nodeapi_local -f generated-inserts.sql\n');

for (let i = 0; i < count; i++) {
  const record = generateTestRecord(startingId + i);
  const sql = generateInsertSQL(record, tableName);
  console.log(sql);
  console.log('');
}

console.log('-- Verify the inserts');
console.log(`SELECT COUNT(*) as total_records FROM ${tableName};`);
console.log(`SELECT id, uid, ingested_at, scriptid, unique_key FROM ${tableName} ORDER BY id DESC LIMIT 10;`);
