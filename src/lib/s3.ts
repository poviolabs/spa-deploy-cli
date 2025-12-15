import { readFileSync } from "node:fs";
import { DeleteObjectCommand, PutObjectCommand, S3Client, paginateListObjectsV2 } from "@aws-sdk/client-s3";

import { Logger } from "../helpers/logger";
import { type AwsContext, getCredentials } from "./aws";
import { type ContextConfig, type DeployFile, type FileConfig, SyncAction } from "./deploy.types";

export function getS3ClientInstance(context: AwsContext): S3Client {
    if (!context.region) {
        throw new Error("AWS Region is required for S3 client");
    }
    const endpoint = context.endpoint || process.env.AWS_S3_ENDPOINT;

    return new S3Client({
        credentials: getCredentials(context),
        region: context.region,
        ...(endpoint ? { forcePathStyle: true, endpoint } : {}),
    });
}

export async function purgeFromS3(
    files: DeployFile[],
    options: {
        bucket: string;
        prefix?: string;
        concurrency?: number;
        context: ContextConfig;
    },
    logger: Logger = new Logger(false),
): Promise<void> {
    const { bucket, prefix, context } = options;
    const concurrency = options.concurrency || 5;

    if (!context?.region) {
        throw new Error("AWS Region is required for S3 purge");
    }
    const client = getS3ClientInstance(context);

    const filesToDelete = files.filter(file => [SyncAction.delete].includes(file.action));

    if (filesToDelete.length === 0) {
        logger.info("> No files to purge");
        return;
    }

    for (let i = 0; i < filesToDelete.length; i += concurrency) {
        const batch = filesToDelete.slice(i, i + concurrency);
        await Promise.all(
            batch.map(async (file) => {
                await deleteFileFromS3(file, client, { bucket, prefix }, logger);
            }),
        );
    }

    logger.info("> Completed purging files");
}

export async function deleteFileFromS3(
    file: DeployFile,
    client: S3Client,
    options: {
        bucket: string;
        prefix?: string;
    },
    logger: Logger = new Logger(false),
): Promise<void> {
    const { bucket, prefix } = options;
    const s3Key = prefix ? `${prefix}${file.key}` : file.key;
    try {
        await client.send(
            new DeleteObjectCommand({
                Bucket: bucket,
                Key: s3Key,
            }),
        );

        logger.debug(`>> ${s3Key}`);
    } catch (error) {
        logger.error(`Failed to delete ${s3Key}: ${error}`);
    }
}

export async function scanS3Files(
    fileMap: Map<string, DeployFile>,
    fileConfigs: FileConfig[],
    options: {
        bucket: string;
        prefix?: string;
        purge: boolean;
        context: ContextConfig,
    },
    logger: Logger = new Logger(false),
): Promise<Map<string, DeployFile>> {
    const { bucket, prefix, purge, context } = options;

    if (!context?.region) {
        throw new Error("AWS Region is required for S3 scanning");
    }
    const client = getS3ClientInstance(context);

    // fist version is the oldest version of the files in the map minus 5 seconds
    // this is used to migrate to the state file format
    const firstVersion = new Date(Math.min(new Date().getTime(), ...Object.values(fileMap).map(file => new Date(file.updatedAt).getTime())) - 5000).toISOString();

    try {
        for await (const data of paginateListObjectsV2(
            {
                client,
            },
            { Bucket: bucket, Prefix: prefix },
        )) {
            if (!data.Contents) continue;

            for (const item of data.Contents) {
                if (!item.Key) continue;

                const key = prefix && item.Key.startsWith(prefix)
                    ? item.Key.substring(prefix.length)
                    : item.Key;

                let file = fileMap.get(key);
                let remoteHash = item.ETag?.replace(/"/g, "") || undefined;
                let remoteSize = item.Size;

                if (file) {
                    file.remoteHash = remoteHash;
                    file.remoteSize = remoteSize;

                    if (!file.updatedAt) {
                        file.updatedAt = firstVersion;
                    }

                    if (file.action === SyncAction.ignored) {
                        // should not happen but just in case
                        continue;
                    }

                    if (file.action == SyncAction.create) {
                        // file is to be created but update was not forced, check if its needed
                        if (file.localHash !== remoteHash || file.localSize !== remoteSize) {
                            file.action = SyncAction.update;
                        } else {
                            file.action = SyncAction.unchanged;
                        }
                    }
                } else {
                    // no local file exists
                    let action = purge ? SyncAction.delete : SyncAction.defunct;
                    const matchingFile = fileConfigs.find(file => file.includeGlob.some(glob => glob(key)));
                    if (matchingFile) {
                        if (matchingFile.ignore) {
                            // dont even record ignored files
                            continue;
                        }
                        if (purge || matchingFile.purge === true) {
                            action = SyncAction.delete;
                        } else {
                            // file is still present on S3, mark as defunct
                            action = SyncAction.defunct;
                        }
                    }
                    fileMap.set(key, {
                        key,
                        priority: 1,
                        action,
                        remoteHash,
                        remoteSize,
                        updatedAt: firstVersion
                    });
                }
                logger.debug(`>> ${key} (hash: ${remoteHash}, size: ${remoteSize})`);
            }
        }
    } catch (error) {
        logger.error(`Failed to scan S3 bucket: ${error}`);
        throw error;
    }

    // all unknown files are no longer on s3 or local, remove them from the stage
    fileMap.forEach((file, key) => {
        if (file.action === SyncAction.unknown) {
            fileMap.delete(key);
        }
    });

    return fileMap;
}

export async function uploadToS3(
    files: DeployFile[],
    options: {
        bucket: string;
        prefix?: string;
        concurrency?: number;
        context: ContextConfig,
    },
    logger: Logger = new Logger(false),
): Promise<void> {
    const { bucket, prefix, context } = options;
    const concurrency = options.concurrency || 5;

    if (files.length === 0) {
        logger.info("> No files to upload");
        return;
    }

    if (!context?.region) {
        throw new Error("AWS Region is required for S3 upload");
    }

    const client = getS3ClientInstance(context);

    for (let i = 0; i < files.length; i += concurrency) {
        const batch = files.slice(i, i + concurrency);
        await Promise.all(
            batch.map(async (file) => {
                if (![SyncAction.create, SyncAction.update].includes(file.action)) {
                    return;
                }
                if (!file.localPath) {
                    throw new Error(`Local path not set for file ${file.key}`);
                }
                await uploadFileToS3(file, client, { bucket, prefix }, logger);
            }),
        );
    }
}

export async function uploadFileToS3(
    file: DeployFile,
    client: S3Client,
    options: {
        bucket: string;
        prefix?: string;
    },
    logger: Logger = new Logger(false),
): Promise<void> {
    const { bucket, prefix } = options;
    const s3Key = prefix ? `${prefix}${file.key}` : file.key;
    if (!file.localPath) {
        throw new Error(`Local path not set for file ${file.key}`);
    }
    try {
        const commandInput: any = {
            Bucket: bucket,
            Key: s3Key,
            Body: readFileSync(file.localPath),
            ContentType: file.contentType,
            CacheControl: file.cacheControl,
            ContentDisposition: file.contentDisposition,
        };
        if (file.acl) commandInput.ACL = file.acl;
        await client.send(new PutObjectCommand(commandInput));

        logger.debug(`>> ${s3Key}`);
    } catch (error) {
        logger.error(`Failed to upload ${s3Key}: ${error}`);
        throw error;
    }
}