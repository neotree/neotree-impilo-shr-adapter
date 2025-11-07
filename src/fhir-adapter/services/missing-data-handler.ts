/**
 * Missing Data Handler
 * Manages missing data using decision rules strategies
 */

import { FHIRPatient } from '../../shared/types/fhir.types';
import { MatchingRule, FieldRule } from '../../shared/types/decision-rules.types';
import { loadDecisionRules } from '../../shared/utils/decision-rules-loader';

export interface MissingDataReport {
  uid: string;
  missingFields: string[];
  criticalFieldsMissing: string[];
  canProceed: boolean;
  warnings: string[];
}

export class MissingDataHandler {
  private rules: MatchingRule[];

  constructor() {
    const decisionRules = loadDecisionRules();
    this.rules = decisionRules.rules;
  }

  /**
   * Analyze missing data in a patient record
   */
  analyzeMissingData(patient: FHIRPatient, uid: string): MissingDataReport {
    const missingFields: string[] = [];
    const criticalFieldsMissing: string[] = [];
    const warnings: string[] = [];

    // Get all unique fields from all rules
    const allFields = new Map<string, FieldRule>();
    for (const rule of this.rules) {
      for (const [fieldName, fieldRule] of Object.entries(rule.fields)) {
        if (!allFields.has(fieldName)) {
          allFields.set(fieldName, fieldRule);
        }
      }
    }

    // Check each field
    for (const [fieldName, fieldRule] of allFields.entries()) {
      const value = this.extractFieldValue(patient, fieldRule);

      if (value === null) {
        missingFields.push(fieldName);

        // Determine criticality based on weight and null handling
        if (this.isCriticalField(fieldRule)) {
          criticalFieldsMissing.push(fieldName);
        }

        warnings.push(
          `${fieldName} (weight: ${fieldRule.weight}, handling: ${fieldRule.null_handling})`
        );
      }
    }

    // Decision: can proceed if no conservative fields are missing
    const canProceed = criticalFieldsMissing.length === 0;

    return {
      uid,
      missingFields,
      criticalFieldsMissing,
      canProceed,
      warnings,
    };
  }

  /**
   * Extract field value from FHIR Patient
   */
  private extractFieldValue(patient: FHIRPatient, fieldRule: FieldRule): string | null {
    const path = fieldRule.espath;

    switch (path) {
      case 'identifier.neotreeId':
        return patient.identifier?.find((i) => i.system === 'urn:neotree:impilo-id')?.value || null;
      case 'identifier.patientId':
        return patient.identifier?.find((i) => i.system === 'urn:impilo:uid')?.value || null;
      case 'birthDate':
        return patient.birthDate || null;
      case 'family':
        return patient.name?.[patient.name.length - 1]?.family || null;
      case 'given':
        return patient.name?.[patient.name.length - 1]?.given?.[0] || null;
      case 'gender':
        return patient.gender || null;
      default:
        return null;
    }
  }

  /**
   * Determine if a field is critical based on its rules
   */
  private isCriticalField(fieldRule: FieldRule): boolean {
    // Critical if:
    // - High weight (>= 7)
    // - Conservative null handling
    return fieldRule.weight >= 7 || fieldRule.null_handling === 'conservative';
  }

  /**
   * Merge data from existing patient into new patient (fill missing fields)
   */
  mergePatientData(newPatient: FHIRPatient, existingPatient: FHIRPatient): FHIRPatient {
    const merged = { ...newPatient };

    // Merge identifiers
    if (!merged.identifier || merged.identifier.length === 0) {
      merged.identifier = existingPatient.identifier;
    }

    // Merge birthDate
    if (!merged.birthDate && existingPatient.birthDate) {
      merged.birthDate = existingPatient.birthDate;
    }

    // Merge gender
    if (!merged.gender && existingPatient.gender) {
      merged.gender = existingPatient.gender;
    }

    // Merge name
    if (!merged.name || merged.name.length === 0 || !merged.name[0].family) {
      if (existingPatient.name && existingPatient.name.length > 0) {
        merged.name = existingPatient.name;
      }
    }

    return merged;
  }
}
