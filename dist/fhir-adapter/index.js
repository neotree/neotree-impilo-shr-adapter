"use strict";
/**
 * FHIR Adapter Entry Point
 * CDC-based polling system for processing sessions table
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FHIRAdapterAPI = void 0;
const express_1 = __importDefault(require("express"));
const adapter_service_1 = require("./services/adapter-service");
const cdc_service_1 = require("./services/cdc-service");
const openhim_client_1 = require("./clients/openhim-client");
const logger_1 = require("../shared/utils/logger");
const config_1 = require("../shared/config");
const errors_1 = require("../shared/utils/errors");
const pool_1 = require("../shared/database/pool");
const logger = (0, logger_1.getLogger)('fhir-adapter-api');
class FHIRAdapterAPI {
    constructor() {
        this.config = (0, config_1.getConfig)();
        this.port = parseInt(process.env.ADAPTER_PORT || '3002', 10);
        this.app = (0, express_1.default)();
        this.adapterService = new adapter_service_1.AdapterService();
        this.cdcService = new cdc_service_1.CDCService(this.adapterService);
        this.openhimClient = new openhim_client_1.OpenHIMClient();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandler();
    }
    /**
     * Setup Express middleware
     */
    setupMiddleware() {
        this.app.use(express_1.default.json({ limit: '10mb' }));
        this.app.use(express_1.default.urlencoded({ extended: true }));
        // Request logging
        this.app.use((req, res, next) => {
            logger.info({
                method: req.method,
                path: req.path,
                ip: req.ip,
            }, 'Incoming request');
            next();
        });
    }
    /**
     * Setup API routes
     */
    setupRoutes() {
        // Health check
        this.app.get('/health', async (req, res) => {
            try {
                const connections = await this.adapterService.testConnections();
                const dbHealthy = await (0, pool_1.testConnection)();
                const cdcStats = await this.cdcService.getStats();
                res.json({
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    connections: {
                        ...connections,
                        database: dbHealthy,
                    },
                    cdc: cdcStats,
                });
            }
            catch (error) {
                res.status(503).json({
                    status: 'unhealthy',
                    timestamp: new Date().toISOString(),
                    error: String(error),
                });
            }
        });
        // Manual processing endpoint (for testing)
        this.app.post('/api/process', async (req, res, next) => {
            try {
                const entry = req.body;
                if (!entry || !entry.uid) {
                    return res.status(400).json({
                        error: 'Invalid request body',
                        message: 'Expected Neotree entry with uid',
                    });
                }
                logger.info({
                    uid: entry.uid,
                }, 'Manual processing request');
                const result = await this.adapterService.processEntry(entry);
                res.status(200).json({
                    success: true,
                    uid: entry.uid,
                    resourcesCreated: result.entry?.length || 0,
                    timestamp: new Date().toISOString(),
                });
            }
            catch (error) {
                next(error);
            }
        });
        // Query patient by identifier
        this.app.get('/api/patient/query', async (req, res, next) => {
            try {
                const { system, value } = req.query;
                if (!system || !value) {
                    return res.status(400).json({
                        error: 'Missing parameters',
                        message: 'Both system and value are required',
                    });
                }
                const patient = await this.openhimClient.queryPatient(system, value);
                if (!patient) {
                    return res.status(404).json({
                        error: 'Patient not found',
                    });
                }
                res.status(200).json(patient);
            }
            catch (error) {
                next(error);
            }
        });
        // Search patients
        this.app.get('/api/patient/search', async (req, res, _next) => {
            try {
                const searchParams = req.query;
                const results = await this.openhimClient.searchPatients(searchParams);
                res.status(200).json(results);
            }
            catch (error) {
                _next(error);
            }
        });
        // Monitoring: Get CDC statistics
        this.app.get('/api/monitoring/stats', async (_req, res) => {
            try {
                const stats = await this.cdcService.getStats();
                res.json(stats);
            }
            catch {
                res.status(500).json({ error: 'Failed to get stats' });
            }
        });
    }
    /**
     * Setup error handler
     */
    setupErrorHandler() {
        this.app.use((err, req, res, _next) => {
            if (err instanceof errors_1.AdapterError) {
                logger.error({
                    error: err.message,
                    code: err.code,
                    context: err.context,
                }, 'Adapter error');
                return res.status(err.statusCode).json({
                    error: err.code,
                    message: err.message,
                    context: err.context,
                });
            }
            logger.error({ error: err }, 'Unexpected error');
            res.status(500).json({
                error: 'INTERNAL_ERROR',
                message: 'An unexpected error occurred',
            });
        });
    }
    /**
     * Start the API server and CDC polling
     */
    async start() {
        // Test database connection
        const dbHealthy = await (0, pool_1.testConnection)();
        if (!dbHealthy) {
            throw new Error('Database connection failed. Check your .pgpass file or DB_PASSWORD env var.');
        }
        // Start CDC service
        await this.cdcService.start();
        logger.info('CDC service started - polling for new sessions');
        // Start HTTP API
        return new Promise((resolve) => {
            this.app.listen(this.port, () => {
                logger.info({ port: this.port }, 'FHIR Adapter API started successfully');
                resolve();
            });
        });
    }
    /**
     * Stop the adapter gracefully
     */
    async stop() {
        await this.cdcService.stop();
        await (0, pool_1.closePool)();
        logger.info('FHIR Adapter stopped');
    }
}
exports.FHIRAdapterAPI = FHIRAdapterAPI;
// Main execution
if (require.main === module) {
    const api = new FHIRAdapterAPI();
    const shutdown = async () => {
        logger.info('Received shutdown signal');
        await api.stop();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    api.start().catch((error) => {
        logger.fatal({ error }, 'Failed to start FHIR Adapter API');
        process.exit(1);
    });
}
//# sourceMappingURL=index.js.map