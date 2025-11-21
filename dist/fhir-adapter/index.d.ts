/**
 * FHIR Adapter Entry Point
 * CDC-based polling system for processing sessions table
 */
declare class FHIRAdapterAPI {
    private app;
    private adapterService;
    private cdcService;
    private openhimClient;
    private config;
    private port;
    constructor();
    /**
     * Setup Express middleware
     */
    private setupMiddleware;
    /**
     * Setup API routes
     */
    private setupRoutes;
    /**
     * Setup error handler
     */
    private setupErrorHandler;
    /**
     * Start the API server and CDC polling
     */
    start(): Promise<void>;
    /**
     * Stop the adapter gracefully
     */
    stop(): Promise<void>;
}
export { FHIRAdapterAPI };
//# sourceMappingURL=index.d.ts.map