/**
 * Logging Utility
 * Production-grade logger using Pino
 */

import pino from 'pino';
import { getConfig } from '../config';

let logger: pino.Logger | null = null;

export function getLogger(name?: string): pino.Logger {
  if (!logger) {
    const config = getConfig();

    logger = pino({
      name: name || 'neotree-adapter',
      level: config.logging.level,
      ...(config.nodeEnv === 'development' && {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }),
    });
  }

  return name ? logger.child({ component: name }) : logger;
}
