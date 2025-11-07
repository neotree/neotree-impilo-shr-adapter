/**
 * Decision Rules Types
 */

export type MatchAlgorithm = 'exact' | 'levenshtein' | 'jaro-winkler';
export type NullHandling = 'conservative' | 'moderate' | 'greedy';
export type MatchingType = 'deterministic' | 'probabilistic';

export interface FieldRule {
  algorithm: MatchAlgorithm;
  threshold?: number;
  fhirpath: string;
  weight: number;
  null_handling: NullHandling;
  null_handling_both: NullHandling;
  espath: string;
  description: string;
}

export interface MatchingRule {
  matchingType: MatchingType;
  description: string;
  fields: Record<string, FieldRule>;
  autoMatchThreshold: number;
  potentialMatchThreshold: number;
}

export interface DecisionRules {
  rules: MatchingRule[];
}

export interface MatchScore {
  totalScore: number;
  fieldScores: Record<string, number>;
  matchLevel: 'auto-match' | 'potential-match' | 'no-match';
  details: string;
}
