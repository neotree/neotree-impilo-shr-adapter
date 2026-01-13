import { v4 as uuidv4 } from 'uuid';
import { FHIRBundle, BundleEntry, FHIRResource, FHIRPatient, FHIRRelatedPerson, FHIREncounter, FHIRObservation, FHIRCondition } from '../../shared/types/fhir.types';
import { getLogger } from '../../shared/utils/logger';

const logger = getLogger('bundle-builder');

export class BundleBuilder {
  /**
   * Create a Client Registry (CR) bundle with Patient + RelatedPerson
   * Sends demographic information to CR
   */
  static createCRBundle(patient: FHIRPatient, relatedPerson?: FHIRRelatedPerson | null): FHIRBundle {
    logger.debug('Building Client Registry bundle');

    const entries: BundleEntry[] = [];

    // Add Patient resource
    if (patient.id) {
      entries.push({
        fullUrl: `Patient/${patient.id}`,
        resource: patient,
        request: {
          method: 'PUT',
          url: `Patient/${patient.id}`,
        },
      });
    } else {
      const patientId = uuidv4();
      entries.push({
        fullUrl: `urn:uuid:${patientId}`,
        resource: patient,
        request: {
          method: 'POST',
          url: 'Patient',
        },
      });
    }

    // Add RelatedPerson (mother) if available
    if (relatedPerson) {
      entries.push({
        fullUrl: relatedPerson.id ? `RelatedPerson/${relatedPerson.id}` : `urn:uuid:${uuidv4()}`,
        resource: relatedPerson,
        request: {
          method: 'POST',
          url: 'RelatedPerson',
        },
      });
    }

    const bundle: FHIRBundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: entries,
    };

    logger.debug({ entryCount: entries.length }, 'Client Registry bundle created');

    return bundle;
  }

  /**
   * Create a Shared Health Record (SHR) bundle with clinical data
   * Sends Encounters, Observations, Conditions
   */
  static createSHRBundle(
    encounter: FHIREncounter,
    observations: FHIRObservation[] = [],
    conditions: FHIRCondition[] = []
  ): FHIRBundle {
    logger.debug('Building Shared Health Record bundle');

    const entries: BundleEntry[] = [];

    // Add Encounter resource
    entries.push({
      fullUrl: encounter.id ? `Encounter/${encounter.id}` : `urn:uuid:${uuidv4()}`,
      resource: encounter,
      request: {
        method: 'POST',
        url: 'Encounter',
      },
    });

    // Add Observation resources
    observations.forEach((obs) => {
      entries.push({
        fullUrl: obs.id ? `Observation/${obs.id}` : `urn:uuid:${uuidv4()}`,
        resource: obs,
        request: {
          method: 'POST',
          url: 'Observation',
        },
      });
    });

    // Add Condition resources
    conditions.forEach((cond) => {
      entries.push({
        fullUrl: cond.id ? `Condition/${cond.id}` : `urn:uuid:${uuidv4()}`,
        resource: cond,
        request: {
          method: 'POST',
          url: 'Condition',
        },
      });
    });

    const bundle: FHIRBundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: entries,
    };

    logger.debug({ entryCount: entries.length }, 'Shared Health Record bundle created');

    return bundle;
  }

  /**
   * Legacy method for backward compatibility
   * Creates a transaction bundle with Patient only (uses CR endpoint)
   */
  static createTransactionBundle(patient: FHIRPatient): FHIRBundle {
    logger.debug('Building transaction bundle (legacy)');

    const entries: BundleEntry[] = [];

    // If patient has an ID, it's an update (PUT), otherwise it's a create (POST)
    if (patient.id) {
      entries.push({
        fullUrl: `Patient/${patient.id}`,
        resource: patient,
        request: {
          method: 'PUT',
          url: `Patient/${patient.id}`,
        },
      });
    } else {
      const patientId = uuidv4();
      entries.push({
        fullUrl: `urn:uuid:${patientId}`,
        resource: patient,
        request: {
          method: 'POST',
          url: 'Patient',
        },
      });
    }

    const bundle: FHIRBundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: entries,
    };

    logger.debug({ entryCount: entries.length }, 'Transaction bundle created');

    return bundle;
  }

  static createSearchSetBundle(resources: FHIRResource[]): FHIRBundle {
    const entries: BundleEntry[] = resources.map((resource) => ({
      fullUrl: resource.id ? `${resource.resourceType}/${resource.id}` : undefined,
      resource,
    }));

    return {
      resourceType: 'Bundle',
      type: 'searchset',
      timestamp: new Date().toISOString(),
      total: resources.length,
      entry: entries,
    };
  }

  static createCollectionBundle(resources: FHIRResource[]): FHIRBundle {
    const entries: BundleEntry[] = resources.map((resource) => ({
      fullUrl: resource.id ? `${resource.resourceType}/${resource.id}` : `urn:uuid:${uuidv4()}`,
      resource,
    }));

    return {
      resourceType: 'Bundle',
      type: 'collection',
      timestamp: new Date().toISOString(),
      entry: entries,
    };
  }
}
