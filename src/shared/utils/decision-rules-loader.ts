/**
 * Decision Rules Loader
 * Loads and validates decision rules configuration
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { DecisionRules } from '../types/decision-rules.types';

let cachedRules: DecisionRules | null = null;

export function loadDecisionRules(): DecisionRules {
  if (cachedRules) return cachedRules;

  const configPath = join(process.cwd(), 'config', 'decisionRules.neotree.json');
  const content = readFileSync(configPath, 'utf-8');
  cachedRules = JSON.parse(content) as DecisionRules;

  return cachedRules;
}
