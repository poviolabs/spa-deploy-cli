import { glob, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "crypto";
import { lookup } from "mime-types";

import { Logger } from "../helpers/logger";
import { type DeployFile, type FileConfig, SyncAction } from "./deploy.types";

async function fileMd5(path: string): Promise<string> {
    const fs = await import("node:fs");
    return new Promise((resolve, reject) => {
        const hash = createHash("md5");
        const stream = fs.createReadStream(path);
        stream.on("error", (err) => reject(err));
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}

export async function scanLocalFiles(
    fileMap: Map<string, DeployFile> = new Map(),
    fileConfigs: FileConfig[],
    options: {
        prefix: string,
    },
    logger: Logger = new Logger(false),
): Promise<Map<string, DeployFile>> {
    const absPrefix = resolve(options.prefix);

    // list all files in the prefix
    for await (const relativePath of glob("**/*", { cwd: absPrefix })) {

        const matchingSource = fileConfigs.find(f => f.includeGlob.some(glob => glob(relativePath)));
        if (!matchingSource) {
            // logger.debug(`>> ${relativePath} (no matching source)`);
            continue;
        }

        const absPath = join(absPrefix, relativePath);
        const stats = await stat(absPath);
        if (!stats.isFile()) {
            continue;
        }

        const forceUpload = matchingSource?.skipUnchanged !== true

        let action = forceUpload ? SyncAction.update : SyncAction.create;
        const priority = matchingSource.priority ?? 0;
        const contentType = matchingSource.contentType ||
            lookup(absPath) || "application/octet-stream";
        const localHash = await fileMd5(absPath);
        const localSize = stats.size;
        const contentDisposition = matchingSource.contentDisposition || "inline";
        const cacheControl = matchingSource.cacheControl;
        const acl = matchingSource.acl;


        const deployFile: DeployFile = fileMap.get(relativePath) || {
            key: relativePath,
            action: action,
            priority: priority,
        };

        if (
            deployFile.remoteSize && deployFile.remoteSize !== stats.size
            || deployFile.remoteHash && deployFile.remoteHash !== localHash
            || deployFile.remoteSize && deployFile.remoteSize !== localSize
            || acl && deployFile.acl && deployFile.acl !== acl
            || deployFile.contentType && deployFile.contentType !== contentType
            || deployFile.contentDisposition && deployFile.contentDisposition !== contentDisposition
            || deployFile.cacheControl && deployFile.cacheControl !== cacheControl
        ) {
            action = SyncAction.update;
        }

        deployFile.localPath = absPath;
        deployFile.localSize = localSize;
        deployFile.localHash = localHash;
        deployFile.contentType = contentType;
        deployFile.contentDisposition = contentDisposition;
        deployFile.cacheControl = cacheControl;
        deployFile.acl = acl;
        deployFile.invalidate = matchingSource.invalidate;
        deployFile.priority = priority;
        deployFile.action = action;

        logger.debug(
            `>> ${relativePath} (priority: ${priority}, hash: ${deployFile.localHash}, size: ${deployFile.localSize})`,
        );
        fileMap.set(relativePath, deployFile);
    }

    return fileMap;
}
