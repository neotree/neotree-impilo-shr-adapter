/**
 * OpenHIM Client
 * Handles communication with OpenHIM including authentication
 */
import { FHIRBundle, FHIRResource, FHIRPatient } from '../../shared/types/fhir.types';
export declare class OpenHIMClient {
    private config;
    private client;
    constructor();
    /**
     * Generate OpenHIM authentication headers
     * Supports both Basic Auth and OpenHIM's custom token-based auth
     */
    private generateAuthHeaders;
    sendBundle(bundle: FHIRBundle): Promise<FHIRBundle>;
    sendResource(resource: FHIRResource): Promise<{
        resource: FHIRResource;
        status: number;
    }>;
    queryPatient(identifierSystem: string, identifierValue: string): Promise<FHIRPatient | null>;
    searchPatients(searchParams: Record<string, string>): Promise<FHIRBundle>;
    updatePatient(patient: FHIRPatient): Promise<FHIRPatient>;
    testConnection(): Promise<boolean>;
    private handleError;
}
//# sourceMappingURL=openhim-client.d.ts.map