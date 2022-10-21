"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileMd5 = exports.scanLocal = exports.SyncActionColors = exports.SyncAction = void 0;
const fast_glob_1 = require("fast-glob");
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = require("@povio/node-stage/chalk");
var SyncAction;
(function (SyncAction) {
    SyncAction["unknown"] = "Unknown";
    SyncAction["unchanged"] = "Unchanged";
    SyncAction["ignore"] = "Ignore";
    SyncAction["delete"] = "Delete";
    SyncAction["update"] = "Update";
    SyncAction["create"] = "Create";
})(SyncAction = exports.SyncAction || (exports.SyncAction = {}));
exports.SyncActionColors = {
    [SyncAction.unknown]: chalk_1.chk.yellow,
    [SyncAction.unchanged]: chalk_1.chk.reset,
    [SyncAction.ignore]: chalk_1.chk.reset,
    [SyncAction.delete]: chalk_1.chk.red,
    [SyncAction.update]: chalk_1.chk.magenta,
    [SyncAction.create]: chalk_1.chk.magenta,
};
async function* scanLocal(options) {
    for await (const entry of (0, fast_glob_1.sync)(options.includeGlob || ["**"], {
        onlyFiles: true,
        ignore: options.ignoreGlob,
        cwd: options.path,
        unique: true,
    })) {
        const absPath = path_1.default.join(options.path, entry);
        yield {
            path: absPath,
            key: entry,
            size: fs_1.default.statSync(absPath).size,
            hash: await fileMd5(absPath),
        };
    }
}
exports.scanLocal = scanLocal;
async function fileMd5(path) {
    return new Promise((resolve, reject) => {
        const hash = (0, crypto_1.createHash)("md5");
        const stream = fs_1.default.createReadStream(path);
        stream.on("error", (err) => reject(err));
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}
exports.fileMd5 = fileMd5;
//# sourceMappingURL=sync.helper.js.map