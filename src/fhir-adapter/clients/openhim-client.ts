/**
 * OpenHIM Client
 * Handles communication with OpenHIM including authentication
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { getConfig } from '../../shared/config';
import { getLogger } from '../../shared/utils/logger';
import { OpenHIMError } from '../../shared/utils/errors';
import { FHIRBundle, FHIRResource, FHIRPatient } from '../../shared/types/fhir.types';

const logger = getLogger('openhim-client');

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

    // NOTE: If your OpenHIM instance uses custom token-based auth, uncomment below:
    // const timestamp = new Date().toISOString();
    // const salt = crypto.randomBytes(16).toString('hex');
    //
    // const passwordHash = crypto
    //   .createHash('sha512')
    //   .update(salt + password)
    //   .digest('hex');
    //
    // const token = crypto
    //   .createHash('sha512')
    //   .update(passwordHash + salt + timestamp)
    //   .digest('hex');
    //
    // return {
    //   'auth-username': username,
    //   'auth-ts': timestamp,
    //   'auth-salt': salt,
    //   'auth-token': token,
    // };
  }

  async sendBundle(bundle: FHIRBundle): Promise<FHIRBundle> {
    try {
      const authHeaders = this.generateAuthHeaders();

      const response = await this.client.post<FHIRBundle>(
        this.config.openhim.channelPath,
        bundle,
        {
          headers: {
            ...authHeaders,
            'X-OpenHIM-ClientID': this.config.openhim.clientId || this.config.source.id,
            'X-Forwarded-For': 'neotree-adapter',
          },
        }
      );

      if (response.data.type === 'transaction-response' && response.data.entry) {
        const failedEntries = response.data.entry.filter(
          (entry) => entry.response?.status && !entry.response.status.startsWith('2')
        );

        if (failedEntries.length > 0) {
          logger.error({ failedCount: failedEntries.length }, 'Bundle entries failed');
        }

        if (response.data.entry.length === 0) {
          throw new OpenHIMError('Empty response', response.status, {
            responseData: response.data,
          });
        }
      }

      return response.data;
    } catch (error) {
      logger.error('Bundle send failed');
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
