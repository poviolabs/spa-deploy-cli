"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVersion = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
/**
 * Fetch the version from package.json
 */
function getVersion(root = path_1.default.join(__dirname, "..", "..")) {
    const packageJsonPath = path_1.default.join(root, "package.json");
    if (fs_1.default.existsSync(packageJsonPath)) {
        try {
            const packageJson = JSON.parse(fs_1.default.readFileSync(packageJsonPath, "utf8"));
            return packageJson.version;
        }
        catch (e) {
            console.error(`[ERROR] ${e.toString()}`);
        }
    }
    return undefined;
}
exports.getVersion = getVersion;
//# sourceMappingURL=version.helper.js.map