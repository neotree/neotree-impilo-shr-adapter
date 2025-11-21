"use strict";
/**
 * OpenHIM Client
 * Handles communication with OpenHIM including authentication
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenHIMClient = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../../shared/config");
const logger_1 = require("../../shared/utils/logger");
const errors_1 = require("../../shared/utils/errors");
const logger = (0, logger_1.getLogger)('openhim-client');
class OpenHIMClient {
    constructor() {
        this.config = (0, config_1.getConfig)();
        this.client = axios_1.default.create({
            baseURL: this.config.openhim.baseUrl,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/fhir+json',
            },
        });
        // Add response interceptor for error handling
        this.client.interceptors.response.use((response) => response, (error) => {
            return this.handleError(error);
        });
    }
    /**
     * Generate OpenHIM authentication headers
     * Supports both Basic Auth and OpenHIM's custom token-based auth
     */
    generateAuthHeaders() {
        const username = this.config.openhim.username;
        const password = this.config.openhim.password;
        // Use HTTP Basic Authentication
        // OpenHIM can be configured to accept Basic Auth instead of token-based auth
        const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
        return {
            'Authorization': `Basic ${basicAuth}`,
            'auth-username': username,
            'auth-ts': '',
            'auth-salt': '',
            'auth-token': '',
        };
    }
    async sendBundle(bundle) {
        try {
            const authHeaders = this.generateAuthHeaders();
            const response = await this.client.post(this.config.openhim.channelPath, bundle, {
                headers: {
                    ...authHeaders,
                    'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
                    'X-Forwarded-For': 'neotree-adapter',
                },
            });
            if (response.data.type === 'transaction-response' && response.data.entry) {
                const failedEntries = response.data.entry.filter((entry) => entry.response?.status && !entry.response.status.startsWith('2'));
                if (failedEntries.length > 0) {
                    logger.error({ failedCount: failedEntries.length }, 'Bundle entries failed');
                }
                if (response.data.entry.length === 0) {
                    throw new errors_1.OpenHIMError('Empty response', response.status, {
                        responseData: response.data,
                    });
                }
            }
            return response.data;
        }
        catch (error) {
            logger.error('Bundle send failed');
            throw error;
        }
    }
    async sendResource(resource) {
        try {
            const authHeaders = this.generateAuthHeaders();
            const path = `${this.config.openhim.channelPath}/${resource.resourceType}`;
            const response = await this.client.post(path, resource, {
                headers: {
                    ...authHeaders,
                    'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
                },
            });
            return { resource: response.data, status: response.status };
        }
        catch (error) {
            logger.error({ resourceType: resource.resourceType }, 'Resource send failed');
            throw error;
        }
    }
    async queryPatient(identifierSystem, identifierValue) {
        try {
            const authHeaders = this.generateAuthHeaders();
            const response = await this.client.get(`${this.config.openhim.channelPath}/Patient`, {
                params: {
                    identifier: `${identifierSystem}|${identifierValue}`,
                },
                headers: {
                    ...authHeaders,
                    'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
                },
            });
            if (response.data.entry && response.data.entry.length > 0) {
                return response.data.entry[0].resource;
            }
            return null;
        }
        catch (error) {
            logger.error('Query failed');
            throw error;
        }
    }
    async searchPatients(searchParams) {
        try {
            const authHeaders = this.generateAuthHeaders();
            const response = await this.client.get(`${this.config.openhim.channelPath}/Patient`, {
                params: searchParams,
                headers: {
                    ...authHeaders,
                    'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
                },
            });
            return response.data;
        }
        catch (error) {
            logger.error('Search failed');
            throw error;
        }
    }
    async updatePatient(patient) {
        try {
            const authHeaders = this.generateAuthHeaders();
            if (!patient.id) {
                throw new errors_1.OpenHIMError('Patient ID required', 400);
            }
            const response = await this.client.put(`${this.config.openhim.channelPath}/Patient/${patient.id}`, patient, {
                headers: {
                    ...authHeaders,
                    'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
                },
            });
            return response.data;
        }
        catch (error) {
            logger.error({ patientId: patient.id }, 'Update failed');
            throw error;
        }
    }
    async testConnection() {
        try {
            const authHeaders = this.generateAuthHeaders();
            const response = await this.client.get('/heartbeat', {
                headers: authHeaders,
            });
            return response.status === 200;
        }
        catch {
            return false;
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleError(error) {
        if (error.response) {
            const status = error.response.status;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = error.response.data;
            // Check if this is actually a successful FHIR transaction despite HTTP 500
            if (data?.type === 'transaction-response' && data?.entry && Array.isArray(data.entry)) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const allSuccessful = data.entry.every((entry) => entry.response?.status && entry.response.status.startsWith('2'));
                if (allSuccessful && data.entry.length > 0) {
                    logger.info({ entryCount: data.entry.length }, 'Transaction successful despite HTTP 500');
                    // Return the response as if it succeeded
                    return error.response;
                }
            }
            logger.error({ status }, 'Request failed');
            throw new errors_1.OpenHIMError(`Request failed: ${error.message}`, status, { status, data: error.response.data });
        }
        if (error.request) {
            throw new errors_1.OpenHIMError('No response', 503, { error: error.message });
        }
        throw new errors_1.OpenHIMError(`Client error: ${error.message}`, 500);
    }
}
exports.OpenHIMClient = OpenHIMClient;
//# sourceMappingURL=openhim-client.js.map