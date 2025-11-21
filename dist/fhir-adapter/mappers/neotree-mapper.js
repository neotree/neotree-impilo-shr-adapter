"use strict";
/**
 * Neotree Data Mapper
 * Extracts and normalizes data from Neotree format
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapNeotreeToPatientData = mapNeotreeToPatientData;
exports.extractVitalSigns = extractVitalSigns;
exports.extractBodyMeasurements = extractBodyMeasurements;
const config_1 = require("../../shared/config");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFieldValue(entries, fieldName) {
    const field = entries[fieldName];
    if (!field || !field.values || !field.values.value) {
        return null;
    }
    const value = field.values.value[0];
    return value !== null && value !== undefined ? value : null;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFieldLabel(entries, fieldName) {
    const field = entries[fieldName];
    if (!field || !field.values || !field.values.label) {
        return null;
    }
    const label = field.values.label[0];
    return label !== null && label !== undefined ? label : null;
}
function _combineDateAndTime(date, time) {
    if (!date)
        return null;
    try {
        const dateObj = new Date(date);
        if (time) {
            const timeObj = new Date(time);
            dateObj.setHours(timeObj.getHours(), timeObj.getMinutes(), timeObj.getSeconds());
        }
        return dateObj.toISOString();
    }
    catch {
        return null;
    }
}
/**
 * Map Neotree entry to standardized patient data
 */
function mapNeotreeToPatientData(entry) {
    const config = (0, config_1.getConfig)();
    const { entries } = entry;
    // Extract baby information
    const babyFirstName = getFieldValue(entries, 'BabyFirst');
    const babyLastName = getFieldValue(entries, 'BabyLast');
    const gender = getFieldValue(entries, 'Gender');
    const dobDate = getFieldValue(entries, 'DOBTOB');
    const birthWeight = getFieldValue(entries, 'BirthWeight');
    const length = getFieldValue(entries, 'Length');
    const ofc = getFieldValue(entries, 'OFC');
    const gestation = getFieldValue(entries, 'Gestation');
    // Extract mother information
    const motherFirstName = getFieldValue(entries, 'MotherFirstName');
    const motherSurname = getFieldValue(entries, 'MotherSurname');
    const motherHIVStatus = getFieldValue(entries, 'HIVtestResult');
    const motherHIVTestDate = getFieldValue(entries, 'DateHIVtest');
    // Extract clinical data
    const apgar1 = getFieldValue(entries, 'Apgar1');
    const apgar5 = getFieldValue(entries, 'Apgar5');
    const apgar10 = getFieldValue(entries, 'Apgar10');
    const admissionReason = getFieldLabel(entries, 'AdmReason');
    // Extract vital signs
    const heartRate = getFieldValue(entries, 'HR') || getFieldValue(entries, 'DischHR');
    const respiratoryRate = getFieldValue(entries, 'RR') || getFieldValue(entries, 'DischRR');
    const temperature = getFieldValue(entries, 'Temperature') || getFieldValue(entries, 'DischTemp');
    const saturation = getFieldValue(entries, 'SatsAir') || getFieldValue(entries, 'DischSats');
    // Extract diagnoses
    const diagnoses = [];
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
    // Extract timestamps
    const admissionDateTime = getFieldValue(entries, 'DateTimeAdmission');
    const dischargeDateTime = getFieldValue(entries, 'DateTimeDischarge');
    // Other clinical data
    const ethnicity = getFieldValue(entries, 'Ethnicity');
    const religion = getFieldValue(entries, 'Religion');
    const modeOfDelivery = getFieldValue(entries, 'ModeDelivery');
    const birthPlace = getFieldValue(entries, 'BirthPlace');
    return {
        uid: entry.uid,
        impilo_uid: entry.impilo_uid,
        uniqueKey: entry.unique_key,
        // Baby details
        babyFirstName,
        babyLastName,
        gender: mapGender(gender),
        dateOfBirth: dobDate,
        birthWeight,
        length,
        ofc,
        gestation,
        // Mother details
        motherFirstName,
        motherSurname,
        motherHIVStatus,
        motherHIVTestDate,
        // Clinical data
        apgar1,
        apgar5,
        apgar10,
        admissionReason,
        diagnoses,
        // Facility information
        facilityId: config.source.facilityId,
        facilityName: config.source.facilityName,
        birthPlace,
        // Timestamps
        admissionDateTime,
        dischargeDateTime,
        // Vital signs
        heartRate,
        respiratoryRate,
        temperature,
        saturation,
        // Additional
        ethnicity,
        religion,
        modeOfDelivery,
        // Metadata
        scriptType: entry.script?.type || 'admission',
        hospitalId: entry.hospital_id,
    };
}
/**
 * Map Neotree gender codes to FHIR gender
 */
function mapGender(code) {
    if (!code)
        return undefined;
    const genderMap = {
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
function extractVitalSigns(data) {
    const vitals = new Map();
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
function extractBodyMeasurements(data) {
    const measurements = new Map();
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
//# sourceMappingURL=neotree-mapper.js.map