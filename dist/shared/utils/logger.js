"use strict";
/**
 * Logging Utility
 * Production-grade logger using Pino
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLogger = getLogger;
const pino_1 = __importDefault(require("pino"));
const config_1 = require("../config");
let logger = null;
function getLogger(name) {
    if (!logger) {
        const config = (0, config_1.getConfig)();
        logger = (0, pino_1.default)({
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
//# sourceMappingURL=logger.js.map