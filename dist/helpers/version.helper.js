"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVersion = void 0;
const path_1 = __importDefault(require("path"));
const node_stage_1 = require("node-stage");
/**
 * Fetch the version from package.json
 */
function getVersion() {
    return (0, node_stage_1.getVersion)(path_1.default.join(__dirname, "..", ".."));
}
exports.getVersion = getVersion;
//# sourceMappingURL=version.helper.js.map