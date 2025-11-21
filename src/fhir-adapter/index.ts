/**
 * FHIR Adapter Entry Point
 * CDC-based polling system for processing sessions table
 */

import express, { Request, Response, NextFunction } from 'express';
import { AdapterService } from './services/adapter-service';
import { CDCService } from './services/cdc-service';
import { OpenHIMClient } from './clients/openhim-client';
import { getLogger } from '../shared/utils/logger';
import { getConfig } from '../shared/config';
import { AdapterError } from '../shared/utils/errors';
import { NeotreeEntry } from '../shared/types/neotree.types';
import { testConnection, closePool } from '../shared/database/pool';

const logger = getLogger('fhir-adapter-api');

class FHIRAdapterAPI {
  private app: express.Application;
  private adapterService: AdapterService;
  private cdcService: CDCService;
  private openhimClient: OpenHIMClient;
  private config = getConfig();
  private port = parseInt(process.env.ADAPTER_PORT || '3002', 10);

  constructor() {
    this.app = express();
    this.adapterService = new AdapterService();
    this.cdcService = new CDCService(this.adapterService);
    this.openhimClient = new OpenHIMClient();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandler();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(
        {
          method: req.method,
          path: req.path,
          ip: req.ip,
        },
        'Incoming request'
      );
      next();
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', async (req, res) => {
      try {
        const connections = await this.adapterService.testConnections();
        const dbHealthy = await testConnection();
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
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: String(error),
        });
      }
    });

    // Manual processing endpoint (for testing)
    this.app.post('/api/process', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const entry: NeotreeEntry = req.body;

        if (!entry || !entry.uid) {
          return res.status(400).json({
            error: 'Invalid request body',
            message: 'Expected Neotree entry with uid',
          });
        }

        logger.info(
          {
            uid: entry.uid,
          },
          'Manual processing request'
        );

        const result = await this.adapterService.processEntry(entry);

        res.status(200).json({
          success: true,
          uid: entry.uid,
          resourcesCreated: result.entry?.length || 0,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        next(error);
      }
    });

    // Query patient by identifier
    this.app.get('/api/patient/query', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { system, value } = req.query;

        if (!system || !value) {
          return res.status(400).json({
            error: 'Missing parameters',
            message: 'Both system and value are required',
          });
        }

        const patient = await this.openhimClient.queryPatient(
          system as string,
          value as string
        );

        if (!patient) {
          return res.status(404).json({
            error: 'Patient not found',
          });
        }

        res.status(200).json(patient);
      } catch (error) {
        next(error);
      }
    });

    // Search patients
    this.app.get('/api/patient/search', async (req: Request, res: Response, _next: NextFunction) => {
      try {
        const searchParams = req.query as Record<string, string>;

        const results = await this.openhimClient.searchPatients(searchParams);

        res.status(200).json(results);
      } catch (error) {
        _next(error);
      }
    });

    // Monitoring: Get CDC statistics
    this.app.get('/api/monitoring/stats', async (_req: Request, res: Response) => {
      try {
        const stats = await this.cdcService.getStats();
        res.json(stats);
      } catch {
        res.status(500).json({ error: 'Failed to get stats' });
      }
    });
  }

  /**
   * Setup error handler
   */
  private setupErrorHandler(): void {
    this.app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof AdapterError) {
        logger.error(
          {
            error: err.message,
            code: err.code,
            context: err.context,
          },
          'Adapter error'
        );

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
  async start(): Promise<void> {
    // Test database connection
    const dbHealthy = await testConnection();
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
  async stop(): Promise<void> {
    await this.cdcService.stop();
    await closePool();
    logger.info('FHIR Adapter stopped');
  }
}

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

export { FHIRAdapterAPI };
