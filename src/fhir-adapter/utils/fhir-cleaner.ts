/**
 * FHIR Resource Cleaner
 * Removes undefined and null values from FHIR resources to prevent validation errors
 * Recursively cleans nested objects and arrays
 */

import { FHIRResource, FHIRBundle } from '../../shared/types/fhir.types';
import { getLogger } from '../../shared/utils/logger';

const logger = getLogger('fhir-cleaner');

export class FHIRCleaner {
  /**
   * Clean a FHIR resource by removing undefined and null values
   * Preserves structure but removes empty properties
   */
  static cleanResource<T extends FHIRResource>(resource: T): T {
    if (!resource || typeof resource !== 'object') {
      return resource;
    }

    return this.cleanObject(resource) as T;
  }

  /**
   * Clean a FHIR bundle by removing undefined values from all entries
   */
  static cleanBundle(bundle: FHIRBundle): FHIRBundle {
    if (!bundle || !bundle.entry) {
      return bundle;
    }

    const cleanedEntries = bundle.entry
      .map((entry) => ({
        ...entry,
        resource: entry.resource ? this.cleanResource(entry.resource) : entry.resource,
      }))
      .filter((entry) => entry.resource); // Remove entries without resources

    return {
      ...this.cleanObject(bundle),
      entry: cleanedEntries,
    } as FHIRBundle;
  }

  /**
   * Recursively clean an object, removing undefined and null values
   * But keeps 0, false, and empty strings if explicitly set
   */
  private static cleanObject(obj: any): any {
    if (obj === null || obj === undefined) {
      return undefined;
    }

    if (Array.isArray(obj)) {
      return obj
        .map((item) => this.cleanObject(item))
        .filter((item) => item !== undefined);
    }

    if (typeof obj !== 'object' || obj instanceof Date) {
      return obj;
    }

    const cleaned: any = {};

    for (const [key, value] of Object.entries(obj)) {
      // Skip private and internal properties
      if (key.startsWith('_') || key === '__proto__') {
        continue;
      }

      // Recursively clean the value
      const cleanedValue = this.cleanObject(value);

      // Only include if not undefined
      if (cleanedValue !== undefined) {
        cleaned[key] = cleanedValue;
      }
    }

    return cleaned;
  }

  /**
   * Validate that a resource doesn't have undefined/null in critical fields
   * Returns array of issues found
   */
  static validateResource(resource: FHIRResource): string[] {
    const issues: string[] = [];

    if (!resource || !resource.resourceType) {
      issues.push('Missing resourceType');
      return issues;
    }

    // Check for common undefined patterns
    const jsonStr = JSON.stringify(resource);

    if (jsonStr.includes(':undefined')) {
      issues.push('Resource contains undefined values');
    }

    // Check for undefined in Organization references
    if (jsonStr.includes('Organization/undefined')) {
      issues.push('Organization reference is undefined');
    }

    // Check for undefined in source
    if (jsonStr.includes('neotree-mobile/undefined')) {
      issues.push('Source contains undefined organization');
    }

    // Check for Subject references pointing to undefined patients
    if (
      resource.resourceType !== 'Patient' &&
      jsonStr.includes('"reference":"Patient/undefined')
    ) {
      issues.push('Subject/Patient reference is undefined');
    }

    return issues;
  }

  /**
   * Log resource cleaning statistics
   */
  static logCleaningStats(before: any, after: any): void {
    const beforeStr = JSON.stringify(before);
    const afterStr = JSON.stringify(after);

    const sizeBefore = beforeStr.length;
    const sizeAfter = afterStr.length;
    const reduction = ((1 - sizeAfter / sizeBefore) * 100).toFixed(2);

    logger.debug(
      {
        sizeBefore,
        sizeAfter,
        reductionPercent: reduction,
        bytesRemoved: sizeBefore - sizeAfter,
      },
      'FHIR resource cleaned'
    );
  }
}
