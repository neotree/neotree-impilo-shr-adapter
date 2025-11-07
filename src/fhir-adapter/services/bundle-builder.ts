import { v4 as uuidv4 } from 'uuid';
import { FHIRBundle, BundleEntry, FHIRResource, FHIRPatient } from '../../shared/types/fhir.types';
import { getLogger } from '../../shared/utils/logger';

const logger = getLogger('bundle-builder');

export class BundleBuilder {
  static createTransactionBundle(patient: FHIRPatient): FHIRBundle {
    logger.debug('Building transaction bundle');

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
