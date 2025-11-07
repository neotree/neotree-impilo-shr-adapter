/**
 * Duplicate Detection Service
 * Uses decision rules to detect potential duplicates
 */

import { FHIRPatient, FHIRBundle } from '../../shared/types/fhir.types';
import { MatchingRule, MatchScore, FieldRule, NullHandling } from '../../shared/types/decision-rules.types';
import { loadDecisionRules } from '../../shared/utils/decision-rules-loader';
import { levenshteinDistance, jaroWinklerSimilarity } from '../../shared/utils/string-matching';

export class DuplicateDetectionService {
  private rules: MatchingRule[];

  constructor() {
    const decisionRules = loadDecisionRules();
    this.rules = decisionRules.rules;
  }

  /**
   * Find potential duplicates for a patient
   */
  async findPotentialDuplicates(
    patient: FHIRPatient,
    searchResults: FHIRBundle
  ): Promise<{ patient: FHIRPatient; score: MatchScore }[]> {
    if (!searchResults.entry || searchResults.entry.length === 0) {
      return [];
    }

    const candidates = searchResults.entry
      .map((entry) => entry.resource as FHIRPatient)
      .filter((p) => p.resourceType === 'Patient');

    const matches: { patient: FHIRPatient; score: MatchScore }[] = [];

    for (const candidate of candidates) {
      const bestScore = this.calculateBestMatchScore(patient, candidate);
      if (bestScore.matchLevel !== 'no-match') {
        matches.push({ patient: candidate, score: bestScore });
      }
    }

    return matches.sort((a, b) => b.score.totalScore - a.score.totalScore);
  }

  /**
   * Calculate the best match score across all rules
   */
  private calculateBestMatchScore(patient1: FHIRPatient, patient2: FHIRPatient): MatchScore {
    let bestScore: MatchScore = {
      totalScore: 0,
      fieldScores: {},
      matchLevel: 'no-match',
      details: 'No matching rule produced a score',
    };

    for (const rule of this.rules) {
      const score = this.calculateMatchScore(patient1, patient2, rule);
      if (score.totalScore > bestScore.totalScore) {
        bestScore = score;
      }
    }

    return bestScore;
  }

  /**
   * Calculate match score for a specific rule
   */
  private calculateMatchScore(
    patient1: FHIRPatient,
    patient2: FHIRPatient,
    rule: MatchingRule
  ): MatchScore {
    const fieldScores: Record<string, number> = {};
    let totalScore = 0;

    for (const [fieldName, fieldRule] of Object.entries(rule.fields)) {
      const value1 = this.extractFieldValue(patient1, fieldRule);
      const value2 = this.extractFieldValue(patient2, fieldRule);

      const score = this.compareFields(value1, value2, fieldRule);
      fieldScores[fieldName] = score;
      totalScore += score;
    }

    let matchLevel: 'auto-match' | 'potential-match' | 'no-match' = 'no-match';
    if (totalScore >= rule.autoMatchThreshold) {
      matchLevel = 'auto-match';
    } else if (totalScore >= rule.potentialMatchThreshold) {
      matchLevel = 'potential-match';
    }

    return {
      totalScore,
      fieldScores,
      matchLevel,
      details: `${rule.matchingType} rule: score ${totalScore}`,
    };
  }

  /**
   * Extract field value from FHIR Patient using simplified path
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
   * Compare two field values using the specified algorithm
   */
  private compareFields(value1: string | null, value2: string | null, fieldRule: FieldRule): number {
    // Handle null values
    if (value1 === null && value2 === null) {
      return this.handleBothNull(fieldRule);
    }
    if (value1 === null || value2 === null) {
      return this.handleOneNull(fieldRule);
    }

    // Perform comparison based on algorithm
    switch (fieldRule.algorithm) {
      case 'exact':
        return value1 === value2 ? fieldRule.weight : 0;

      case 'levenshtein': {
        const distance = levenshteinDistance(value1, value2);
        const threshold = fieldRule.threshold || 2;
        return distance <= threshold ? fieldRule.weight : 0;
      }

      case 'jaro-winkler': {
        const similarity = jaroWinklerSimilarity(value1, value2);
        const threshold = fieldRule.threshold || 0.85;
        return similarity >= threshold ? fieldRule.weight : 0;
      }

      default:
        return 0;
    }
  }

  /**
   * Handle case where both values are null
   */
  private handleBothNull(fieldRule: FieldRule): number {
    const handling = fieldRule.null_handling_both;
    return this.getNullScore(handling, fieldRule.weight);
  }

  /**
   * Handle case where one value is null
   */
  private handleOneNull(fieldRule: FieldRule): number {
    const handling = fieldRule.null_handling;
    return this.getNullScore(handling, fieldRule.weight);
  }

  /**
   * Get score based on null handling strategy
   */
  private getNullScore(handling: NullHandling, weight: number): number {
    switch (handling) {
      case 'conservative':
        return 0;
      case 'moderate':
        return weight * 0.5;
      case 'greedy':
        return weight;
      default:
        return 0;
    }
  }
}
