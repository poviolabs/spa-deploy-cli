import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import { Logger } from "../helpers/logger";
import { type DeployFile, type StateFileEntry, SyncAction, stateFileEntry } from "./deploy.types";


export async function getState(stateFile: string, client: S3Client, options: {
    bucket: string;
    prefix?: string;
}, logger: Logger = new Logger(false)): Promise<Map<string, DeployFile>> {
    const { bucket, prefix } = options;
    const s3Key = prefix ? `${prefix}${stateFile}` : stateFile;

    let response;
    try {
        response = await client.send(
            new GetObjectCommand({
                Bucket: bucket,
                Key: s3Key,
            }),
        );
    } catch (error: any) {
        // If file doesn't exist, return empty map
        if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
            logger.debug(`>> State file ${s3Key} not found, returning empty state`);
            return new Map();
        }
        logger.error(`Failed to get state file from S3 ${s3Key}: ${error}`);
        throw error;
    }

    if (!response.Body) {
        logger.debug(`State file ${s3Key} exists but has no body, returning empty state`);
        return new Map();
    }

    let fileContents: Buffer;
    try {
        const body = await response.Body.transformToByteArray();
        fileContents = Buffer.from(body);
        logger.debug(`>> ${s3Key}`);
    } catch (error) {
        logger.error(`Failed to read response body from ${s3Key}: ${error}`);
        throw error;
    }

    let fileJson;
    try {
        fileJson = JSON.parse(fileContents.toString());
    } catch (error) {
        logger.error(`Failed to parse state file JSON from ${s3Key}: ${error}`);
        throw error;
    }

    // Convert StateFileEntry to DeployFile
    const stateMap = new Map<string, DeployFile>();
    try {
        for (const value of fileJson) {
            const file = stateFileEntry.parse(value);
            stateMap.set(file.key, {
                key: file.key,
                remoteHash: file.remoteHash,
                remoteSize: file.remoteSize,
                cacheControl: file.cacheControl,
                contentType: file.contentType,
                contentDisposition: file.contentDisposition,
                acl: file.acl,
                updatedAt: file.updatedAt,
                action: SyncAction.unknown,
            });
        }
    } catch (error) {
        logger.error(`Failed to parse state file entries from ${s3Key}: ${error}`);
        throw error;
    }

    return stateMap;
}

export async function saveState(state: Map<string, DeployFile>, client: S3Client, options: {
    stateFile: string;
    bucket: string;
    prefix?: string;
}, logger: Logger = new Logger(false)): Promise<void> {
    const { bucket, prefix, stateFile } = options;

    // Convert state to a simplified format for storage
    const stateEntries: StateFileEntry[] = [];
    for (const file of state.values()) {
        if (![SyncAction.create, SyncAction.update, SyncAction.unchanged, SyncAction.defunct].includes(file.action)) {
            // state should only contain the needed files
            continue;
        }
        stateEntries.push({
            key: file.key,
            remoteHash: file.remoteHash || file.localHash,
            remoteSize: file.remoteSize || file.localSize,
            cacheControl: file.cacheControl,
            contentType: file.contentType,
            contentDisposition: file.contentDisposition,
            acl: file.acl,
            updatedAt: file.updatedAt
        });
    }

    const s3Key = prefix ? `${prefix}${stateFile}` : stateFile;

    logger.debug(`>> Saving state file to ${s3Key}`);

    try {
        await client.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: s3Key,
                Body: JSON.stringify(stateEntries),
                ContentType: "application/json",
            }),
        );
    } catch (error) {
        logger.error(`Failed to save state file to ${s3Key}: ${error}`);
        throw error;
    }
}
