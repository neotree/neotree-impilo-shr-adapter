"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BundleBuilder = void 0;
const uuid_1 = require("uuid");
const logger_1 = require("../../shared/utils/logger");
const logger = (0, logger_1.getLogger)('bundle-builder');
class BundleBuilder {
    static createTransactionBundle(patient) {
        logger.debug('Building transaction bundle');
        const entries = [];
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
        }
        else {
            const patientId = (0, uuid_1.v4)();
            entries.push({
                fullUrl: `urn:uuid:${patientId}`,
                resource: patient,
                request: {
                    method: 'POST',
                    url: 'Patient',
                },
            });
        }
        const bundle = {
            resourceType: 'Bundle',
            type: 'transaction',
            entry: entries,
        };
        logger.debug({ entryCount: entries.length }, 'Transaction bundle created');
        return bundle;
    }
    static createSearchSetBundle(resources) {
        const entries = resources.map((resource) => ({
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
    static createCollectionBundle(resources) {
        const entries = resources.map((resource) => ({
            fullUrl: resource.id ? `${resource.resourceType}/${resource.id}` : `urn:uuid:${(0, uuid_1.v4)()}`,
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
exports.BundleBuilder = BundleBuilder;
//# sourceMappingURL=bundle-builder.js.map