import { glob, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "crypto";
import { lookup } from "mime-types";

import { Logger } from "../helpers/logger";
import { type DeployFile, type FileConfig, SyncAction } from "./deploy.types";

const WHITELISTED_DOT_DIRECTORY_GLOBS = [
    // Android App Links and Apple Universal Links association manifests.
    ".well-known/**/*",
];

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
    const updatedAt = new Date().toISOString();

    for await (const relativePath of glob(["**/*", ...WHITELISTED_DOT_DIRECTORY_GLOBS], { cwd: absPrefix })) {

        const matchingSource = fileConfigs.find(f => f.includeGlob.some(glob => glob(relativePath)));
        if (!matchingSource) {
            // logger.debug(`>> ${relativePath} (no matching source)`);
            continue;
        }

        if (matchingSource.ignore) {
            continue;
        }

        const localPath = join(absPrefix, relativePath);
        const stats = await stat(localPath);
        if (!stats.isFile()) {
            continue;
        }

        const forceUpload = matchingSource?.skipUnchanged !== true

        const localHash = await fileMd5(localPath);
        const localSize = stats.size;
        const priority = matchingSource.priority ?? 0;
        const contentType = matchingSource.contentType || lookup(localPath) || "application/octet-stream";
        const contentDisposition = matchingSource.contentDisposition || "inline";
        const cacheControl = matchingSource.cacheControl;
        const acl = matchingSource.acl;
        const invalidate = matchingSource.invalidate;


        let deployFile: DeployFile;
        if (fileMap.has(relativePath)) {
            deployFile = fileMap.get(relativePath)!;
            deployFile.action = SyncAction.unchanged;

            if (
                forceUpload ||
                localHash !== deployFile.remoteHash ||
                localSize !== deployFile.remoteSize ||
                contentType !== deployFile.contentType ||
                contentDisposition !== deployFile.contentDisposition ||
                cacheControl !== deployFile.cacheControl ||
                acl !== deployFile.acl) {
                deployFile.action = SyncAction.update;
                deployFile.localHash = localHash;
                deployFile.localSize = localSize;
                deployFile.contentType = contentType;
                deployFile.contentDisposition = contentDisposition;
                deployFile.cacheControl = cacheControl;
                deployFile.acl = acl;
            }

            deployFile.localPath = localPath;
            deployFile.invalidate = invalidate;
            deployFile.priority = priority;
            deployFile.updatedAt = updatedAt;

        } else {
            deployFile = {
                key: relativePath,
                localPath,
                localSize,
                localHash,
                action: forceUpload ? SyncAction.update : SyncAction.create,
                priority,
                contentType,
                contentDisposition,
                cacheControl,
                acl,
                invalidate,
                updatedAt,
            };
        }

        logger.debug(
            `>> ${relativePath} (priority: ${priority}, hash: ${deployFile.localHash}, size: ${deployFile.localSize})`,
        );
        fileMap.set(relativePath, deployFile);
    }

    return fileMap;
}
