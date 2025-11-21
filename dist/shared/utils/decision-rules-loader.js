"use strict";
/**
 * Decision Rules Loader
 * Loads and validates decision rules configuration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDecisionRules = loadDecisionRules;
const fs_1 = require("fs");
const path_1 = require("path");
let cachedRules = null;
function loadDecisionRules() {
    if (cachedRules)
        return cachedRules;
    const configPath = (0, path_1.join)(process.cwd(), 'config', 'decisionRules.neotree.json');
    const content = (0, fs_1.readFileSync)(configPath, 'utf-8');
    cachedRules = JSON.parse(content);
    return cachedRules;
}
//# sourceMappingURL=decision-rules-loader.js.map