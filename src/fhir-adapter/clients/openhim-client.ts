/**
 * OpenHIM Client
 * Handles communication with OpenHIM including authentication
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { getConfig } from '../../shared/config';
import { getLogger } from '../../shared/utils/logger';
import { getJsonFileLogger } from '../../shared/utils/json-file-logger';
import { OpenHIMError } from '../../shared/utils/errors';
import { FHIRBundle, FHIRResource, FHIRPatient } from '../../shared/types/fhir.types';
import { FHIRCleaner } from '../utils/fhir-cleaner';

const logger = getLogger('openhim-client');
const jsonLogger = getJsonFileLogger();

interface OpenHIMAuthHeaders {
  'auth-username': string;
  'auth-ts': string;
  'auth-salt': string;
  'auth-token': string;
  [key: string]: string;
}

export class OpenHIMClient {
  private config = getConfig();
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: this.config.openhim.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/fhir+json',
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        return this.handleError(error);
      }
    );
  }

  /**
   * Generate OpenHIM authentication headers
   * Supports both Basic Auth and OpenHIM's custom token-based auth
   */
  private generateAuthHeaders(): OpenHIMAuthHeaders {
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

  /**
   * Send bundle to Client Registry (CR) endpoint
   * Used for demographics (Patient + RelatedPerson)
   */
  async sendBundleToCR(bundle: FHIRBundle): Promise<FHIRBundle> {
    return this.sendBundleToEndpointWithLogging(bundle, this.config.openhim.crEndpoint, 'cr');
  }

  /**
   * Send bundle to Shared Health Record (SHR) endpoint
   * Used for clinical data (Encounters, Observations, Conditions)
   */
  async sendBundleToSHR(bundle: FHIRBundle): Promise<FHIRBundle> {
    return this.sendBundleToEndpointWithLogging(bundle, this.config.openhim.shrEndpoint, 'shr');
  }

  /**
   * Send shallow patient to SHR Patient endpoint
   * Used for demonstration: POST shallow patient record to /SHR/fhir/Patient
   * Includes only identifiers and basic demographics
   */
  async sendShallowPatientToSHR(patient: FHIRPatient): Promise<FHIRPatient> {
    const startTime = Date.now();
    const endpoint = `${this.config.openhim.shrEndpoint}/Patient`;

    try {
      const authHeaders = this.generateAuthHeaders();

      logger.info(
        { patientId: patient.id, endpoint },
        'Sending shallow patient to Shared Health Record'
      );

      const response = await this.client.post<FHIRPatient>(
        endpoint,
        patient,
        {
          headers: {
            ...authHeaders,
            'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
            'X-Forwarded-For': 'neotree-adapter',
          },
        }
      );

      const durationMs = Date.now() - startTime;

      logger.info(
        {
          endpoint,
          durationMs,
          responsePatientId: response.data.id,
          httpStatus: response.status
        },
        'Shallow patient sent successfully to SHR'
      );

      // Log to JSON file
      jsonLogger.logSHRRequest({
        timestamp: new Date().toISOString(),
        action: 'push',
        requestBundle: { type: 'Patient', entry: [{ resource: patient }] } as any,
        responseBundle: { type: 'Patient', entry: [{ resource: response.data }] } as any,
        httpStatus: response.status,
        success: true,
        durationMs,
      });

      return response.data;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const httpStatus = error instanceof AxiosError ? error.response?.status : undefined;
      const responseData = error instanceof AxiosError ? error.response?.data : undefined;

      logger.error(
        { endpoint, error: errorMessage, durationMs },
        'Failed to send shallow patient to SHR'
      );

      // Log failure to JSON file
      jsonLogger.logSHRRequest({
        timestamp: new Date().toISOString(),
        action: 'push',
        requestBundle: { type: 'Patient', entry: [{ resource: patient }] } as any,
        responseBundle: responseData,
        httpStatus,
        success: false,
        error: errorMessage,
        durationMs,
      });

      throw error;
    }
  }

  /**
   * Send bundle to specified endpoint (with automatic routing)
   * Falls back to legacy channelPath if endpoint-specific endpoints not available
   */
  async sendBundle(bundle: FHIRBundle): Promise<FHIRBundle> {
    // Default to CR endpoint for backward compatibility
    return this.sendBundleToEndpoint(bundle, this.config.openhim.channelPath);
  }

  /**
   * Internal method to send bundle to any endpoint with CR/SHR specific logging
   */
  private async sendBundleToEndpointWithLogging(
    bundle: FHIRBundle,
    endpoint: string,
    endpointType: 'cr' | 'shr'
  ): Promise<FHIRBundle> {
    const startTime = Date.now();

    try {
      const response = await this.sendBundleToEndpoint(bundle, endpoint);

      const durationMs = Date.now() - startTime;
      const logEntry = {
        timestamp: new Date().toISOString(),
        action: 'push' as const,
        requestBundle: bundle,
        responseBundle: response,
        httpStatus: 200,
        success: true,
        durationMs,
      };

      if (endpointType === 'cr') {
        jsonLogger.logCRRequest(logEntry);
      } else {
        jsonLogger.logSHRRequest(logEntry);
      }

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const httpStatus = error instanceof AxiosError ? error.response?.status : undefined;

      const logEntry = {
        timestamp: new Date().toISOString(),
        action: 'push' as const,
        requestBundle: bundle,
        responseBundle: error instanceof AxiosError ? error.response?.data : undefined,
        httpStatus,
        success: false,
        error: errorMessage,
        durationMs,
      };

      if (endpointType === 'cr') {
        jsonLogger.logCRRequest(logEntry);
      } else {
        jsonLogger.logSHRRequest(logEntry);
      }

      throw error;
    }
  }

  /**
   * Internal method to send bundle to any endpoint
   */
  private async sendBundleToEndpoint(bundle: FHIRBundle, endpoint: string): Promise<FHIRBundle> {
    const startTime = Date.now();

    // Clean bundle before sending - remove undefined/null values that cause validation errors
    const cleanedBundle = FHIRCleaner.cleanBundle(bundle);

    // Validate cleaned bundle for remaining issues
    if (cleanedBundle.entry) {
      for (const entry of cleanedBundle.entry) {
        if (entry.resource) {
          const validationIssues = FHIRCleaner.validateResource(entry.resource);
          if (validationIssues.length > 0) {
            logger.warn(
              { resourceType: entry.resource.resourceType, issues: validationIssues },
              'Resource has validation issues after cleaning'
            );
          }
        }
      }
    }

    const bundleResourceTypes = cleanedBundle.entry?.map((e) => e.resource?.resourceType).filter(Boolean) || [];

    try {
      const authHeaders = this.generateAuthHeaders();

      logger.debug(
        { endpoint, bundleType: cleanedBundle.type, entryCount: cleanedBundle.entry?.length || 0, resourceTypes: bundleResourceTypes },
        'Sending cleaned FHIR bundle to endpoint'
      );

      const response = await this.client.post<FHIRBundle>(
        endpoint,
        cleanedBundle,
        {
          headers: {
            ...authHeaders,
            'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
            'X-Forwarded-For': 'neotree-adapter',
          },
        }
      );

      const durationMs = Date.now() - startTime;
      let successCount = 0;
      let failedCount = 0;

      if (response.data.type === 'transaction-response' && response.data.entry) {
        const failedEntries = response.data.entry.filter(
          (entry) => entry.response?.status && !entry.response.status.startsWith('2')
        );
        successCount = response.data.entry.length - failedEntries.length;
        failedCount = failedEntries.length;

        if (failedEntries.length > 0) {
          logger.error({ failedCount }, 'Bundle entries failed');
        }

        if (response.data.entry.length === 0) {
          throw new OpenHIMError('Empty response', response.status, {
            responseData: response.data,
          });
        }
      }

      // Log to JSON file with cleaned bundle data
      jsonLogger.logBundlePush({
        timestamp: new Date().toISOString(),
        operation: 'push',
        endpoint,
        httpMethod: 'POST',
        bundleType: cleanedBundle.type,
        entryCount: cleanedBundle.entry?.length || 0,
        resourceTypes: (bundleResourceTypes as string[]),
        httpStatus: response.status,
        success: true,
        durationMs,
        requestData: cleanedBundle, // Cleaned bundle that was sent
        responseData: response.data, // Full response data
      });

      logger.info(
        { endpoint, durationMs, successCount, failedCount },
        'Bundle sent successfully to endpoint'
      );

      return response.data;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const httpStatus = error instanceof AxiosError ? error.response?.status : undefined;
      const responseData = error instanceof AxiosError ? error.response?.data : undefined;

      logger.error({ endpoint, error: errorMessage, durationMs }, 'Bundle send failed');

      // Log failure to JSON file with cleaned bundle data and error details
      jsonLogger.logBundlePush({
        timestamp: new Date().toISOString(),
        operation: 'push',
        endpoint,
        httpMethod: 'POST',
        bundleType: cleanedBundle.type,
        entryCount: cleanedBundle.entry?.length || 0,
        resourceTypes: (bundleResourceTypes as string[]),
        httpStatus,
        success: false,
        durationMs,
        requestData: cleanedBundle, // Cleaned bundle that was sent
        error: errorMessage,
        errorDetails: responseData, // Error response from server
      });

      throw error;
    }
  }

  async sendResource(resource: FHIRResource): Promise<{ resource: FHIRResource; status: number }> {
    try {
      const authHeaders = this.generateAuthHeaders();
      const path = `${this.config.openhim.channelPath}/${resource.resourceType}`;

      const response = await this.client.post<FHIRResource>(path, resource, {
        headers: {
          ...authHeaders,
          'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
        },
      });

      return { resource: response.data, status: response.status };
    } catch (error) {
      logger.error({ resourceType: resource.resourceType }, 'Resource send failed');
      throw error;
    }
  }

  async queryPatient(
    identifierSystem: string,
    identifierValue: string
  ): Promise<FHIRPatient | null> {
    try {
      const authHeaders = this.generateAuthHeaders();

      const response = await this.client.get<FHIRBundle>(
        `${this.config.openhim.channelPath}/Patient`,
        {
          params: {
            identifier: `${identifierSystem}|${identifierValue}`,
          },
          headers: {
            ...authHeaders,
            'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
          },
        }
      );

      if (response.data.entry && response.data.entry.length > 0) {
        return response.data.entry[0].resource as FHIRPatient;
      }

      return null;
    } catch (error) {
      logger.error('Query failed');
      throw error;
    }
  }

  /**
   * Retrieve patient from Client Registry (CR)
   * Returns the Bundle ID and full Patient resource for use in SHR
   * Searches by impilo_id identifier (urn:neotree:impilo-id)
   */
  async getPatientFromCR(
    identifierSystem: string,
    identifierValue: string
  ): Promise<{ bundleId: string; patient?: FHIRPatient } | null> {
    const startTime = Date.now();
    const endpoint = `${this.config.openhim.crEndpoint}/Patient`;
    const searchParams = { identifier: `${identifierSystem}|${identifierValue}` };

    try {
      const authHeaders = this.generateAuthHeaders();

      logger.debug(
        { identifierSystem, identifierValue },
        'Retrieving patient from Client Registry'
      );

      const response = await this.client.get<FHIRBundle>(
        endpoint,
        {
          params: searchParams,
          headers: {
            ...authHeaders,
            'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
          },
        }
      );

      const durationMs = Date.now() - startTime;
      const bundleId = response.data.id || '';

      if (!bundleId) {
        throw new Error('CR search response missing bundle ID');
      }

      if (response.data.entry && response.data.entry.length > 0) {
        const patient = response.data.entry[0].resource as FHIRPatient;

        logger.info(
          { bundleId, patientId: patient.id, impiloId: identifierValue, identifierCount: patient.identifier?.length },
          'Successfully retrieved patient from Client Registry with full demographics'
        );

        // Log CR pull with full response data
        jsonLogger.logCRRequest({
          timestamp: new Date().toISOString(),
          action: 'pull',
          impiloId: identifierValue,
          responseBundle: response.data,
          httpStatus: response.status,
          success: true,
          durationMs,
        });

        // Also log to patient pull for backward compatibility
        jsonLogger.logPatientPull({
          timestamp: new Date().toISOString(),
          operation: 'patient_pull',
          endpoint,
          httpMethod: 'GET',
          searchParams,
          patientFound: true,
          patientId: patient.id,
          uid: identifierValue,
          httpStatus: response.status,
          success: true,
          durationMs,
          responseData: patient,
        });

        return { bundleId, patient };
      }

      // No patient entry found - try to retrieve using the bundle ID directly
      logger.warn(
        { bundleId, identifierSystem, impiloId: identifierValue },
        'No patient entry in CR search bundle, attempting to retrieve patient directly by bundle ID'
      );

      try {
        const directResponse = await this.client.get<FHIRPatient>(
          `${this.config.openhim.crEndpoint}/Patient/${bundleId}`,
          {
            headers: {
              ...authHeaders,
              'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
            },
          }
        );

        if (directResponse.data && directResponse.data.resourceType === 'Patient') {
          const patient = directResponse.data as FHIRPatient;
          logger.info(
            { bundleId, patientId: patient.id },
            'Successfully retrieved patient directly from CR by bundle ID'
          );

          return { bundleId, patient };
        }
      } catch (directError) {
        logger.debug(
          { bundleId, error: directError instanceof Error ? directError.message : String(directError) },
          'Failed to retrieve patient directly by bundle ID, returning bundleId only'
        );
      }

      // Log CR pull "not found" case
      jsonLogger.logCRRequest({
        timestamp: new Date().toISOString(),
        action: 'pull',
        impiloId: identifierValue,
        responseBundle: response.data,
        httpStatus: response.status,
        success: true,
        durationMs,
      });

      // Also log to patient pull for backward compatibility
      jsonLogger.logPatientPull({
        timestamp: new Date().toISOString(),
        operation: 'patient_pull',
        endpoint,
        httpMethod: 'GET',
        searchParams,
        patientFound: false,
        uid: identifierValue,
        httpStatus: response.status,
        success: true,
        durationMs,
        responseData: response.data,
      });

      return { bundleId };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const httpStatus = error instanceof AxiosError ? error.response?.status : undefined;
      const errorResponseData = error instanceof AxiosError ? error.response?.data : undefined;

      logger.error(
        { identifierValue, error: errorMessage },
        'Failed to retrieve patient from Client Registry'
      );

      // Log CR pull error
      jsonLogger.logCRRequest({
        timestamp: new Date().toISOString(),
        action: 'pull',
        impiloId: identifierValue,
        responseBundle: errorResponseData,
        httpStatus,
        success: false,
        error: errorMessage,
        durationMs,
      });

      // Also log to patient pull for backward compatibility
      jsonLogger.logPatientPull({
        timestamp: new Date().toISOString(),
        operation: 'patient_pull',
        endpoint,
        httpMethod: 'GET',
        searchParams,
        patientFound: false,
        uid: identifierValue,
        httpStatus,
        success: false,
        durationMs,
        error: errorMessage,
        errorDetails: errorResponseData,
      });

      throw error;
    }
  }

  async searchPatients(searchParams: Record<string, string>): Promise<FHIRBundle> {
    try {
      const authHeaders = this.generateAuthHeaders();

      const response = await this.client.get<FHIRBundle>(
        `${this.config.openhim.channelPath}/Patient`,
        {
          params: searchParams,
          headers: {
            ...authHeaders,
            'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Search failed');
      throw error;
    }
  }

  async updatePatient(patient: FHIRPatient): Promise<FHIRPatient> {
    try {
      const authHeaders = this.generateAuthHeaders();

      if (!patient.id) {
        throw new OpenHIMError('Patient ID required', 400);
      }

      const response = await this.client.put<FHIRPatient>(
        `${this.config.openhim.channelPath}/Patient/${patient.id}`,
        patient,
        {
          headers: {
            ...authHeaders,
            'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error({ patientId: patient.id }, 'Update failed');
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const authHeaders = this.generateAuthHeaders();
      const response = await this.client.get('/heartbeat', {
        headers: authHeaders,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleError(error: AxiosError): any {
    if (error.response) {
      const status = error.response.status;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = error.response.data as any;

      // Check if this is actually a successful FHIR transaction despite HTTP 500
      if (data?.type === 'transaction-response' && data?.entry && Array.isArray(data.entry)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allSuccessful = data.entry.every((entry: any) =>
          entry.response?.status && entry.response.status.startsWith('2')
        );

        if (allSuccessful && data.entry.length > 0) {
          logger.info({ entryCount: data.entry.length }, 'Transaction successful despite HTTP 500');
          // Return the response as if it succeeded
          return error.response;
        }
      }

      logger.error({ status }, 'Request failed');
      throw new OpenHIMError(
        `Request failed: ${error.message}`,
        status,
        { status, data: error.response.data }
      );
    }

    if (error.request) {
      throw new OpenHIMError('No response', 503, { error: error.message });
    }

    throw new OpenHIMError(`Client error: ${error.message}`, 500);
  }
}
