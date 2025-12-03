import picomatch from "picomatch";

import { Logger } from "../helpers/logger";
import { invalidateCloudFront } from "./cloudfront";
import { type DeployConfig, type DeployFile, SyncAction, deployConfig } from "./deploy.types";
import { scanLocalFiles } from "./local";
import { getS3ClientInstance, purgeFromS3, scanS3Files, uploadToS3 } from "./s3";
import { getState, saveState } from "./state";

/**
 * Execute the deployment pipeline with priority-based execution
 * Main planner function that collects files, orders them, and passes to functions
 */
export async function executeDeploy(
    config: DeployConfig,
    options: {
        apply?: boolean;
        force?: boolean;
        scan?: boolean;
        purge?: boolean;
        concurrency?: number;
    },
    logger: Logger = new Logger(false),
): Promise<{
    files: Map<string, DeployFile>;
    invalidationIds: string[];
    result: "success" | "failed" | "no-changes" | "canceled";
}> {
    const deploy = deployConfig.parse(config);
    const { apply, force } = options;

    const scan = options.scan || deploy.s3.scan || false;
    const bucket = deploy.s3.bucket;
    const purge = options.purge || deploy.s3.purge || false;

    let fileConfigs = deploy.files.map(file => ({
        ...file,
        skipUnchanged: force ? false : file.skipUnchanged ?? deploy.s3.skipUnchanged,
    }));

    const stateFile = !deploy.s3.stateFile ? false : typeof deploy.s3.stateFile === 'string' ? deploy.s3.stateFile : `.spa-deploy/files.json`;

    logger.info("> Starting deployment ...");

    let fileMap = new Map<string, DeployFile>();


    if (stateFile) {
        logger.info(`\n> Fetching state file from ${stateFile}`);
        fileMap = await getState(stateFile, getS3ClientInstance({
            ...deploy.context,
            ...deploy.s3.context,
        }), { bucket, prefix: deploy.s3.prefix }, logger);
        fileConfigs = [{ includeGlob: [picomatch(stateFile)], ignore: true, skipUnchanged: false }, ...fileConfigs];
    }

    logger.info("\n> Scanning local files...");
    await scanLocalFiles(fileMap, fileConfigs, { prefix: deploy.prefix }, logger);

    if (scan) {
        logger.info("\n> Scanning S3 files...");
        await scanS3Files(
            fileMap,
            fileConfigs,
            {
                bucket,
                prefix: deploy.s3.prefix,
                purge,
                context: {
                    ...deploy.context,
                    ...deploy.s3.context,
                },
            },
            logger,
        );
    } else {
        logger.info("\n> Skipping S3 Scan");

    }

    logger.info("\n--------------------------------");
    logger.info("Action\t\tKey");

    for (const { key, action, invalidate } of fileMap.values()) {
        if (action === SyncAction.ignored) {
            logger.debug(`${action}\t${invalidate ? 'I' : ''}\t${key}`);
        } else {
            logger.info(`${action}\t${invalidate ? 'I' : ''}\t${key}`);
        }
    }

    logger.info("--------------------------------");

    if (!apply) {
        return {
            files: fileMap,
            invalidationIds: [],
            result: "no-changes",
        };
    }

    const toUpload = new Map<number, DeployFile[]>();
    const toDelete = new Map<number, DeployFile[]>();
    for (const file of fileMap.values()) {
        const priority = file.priority ?? 0;
        if ([SyncAction.create, SyncAction.update].includes(file.action)) {
            if (!toUpload.has(priority)) {
                toUpload.set(priority, []);
            }
            toUpload.get(priority)!.push(file);
        } else if (file.action === SyncAction.delete) {
            if (!toDelete.has(priority)) {
                toDelete.set(priority, []);
            }
            toDelete.get(priority)!.push(file);
        }
    }

    if (toUpload.size > 0) {
        logger.info("\n> Uploading files...");
        for (const priority of Array.from(toUpload.keys()).sort((a, b) => a - b)) {
            // logger.debug(`> Uploading files with priority ${priority}...`);
            await uploadToS3(toUpload.get(priority)!, {
                bucket,
                prefix: deploy.s3.prefix,
                context: {
                    ...deploy.s3.context,
                    ...deploy.context,
                },
                concurrency: options.concurrency || 5,
            }, logger);
            toUpload.delete(priority);
        }
    } else {
        logger.info("\n> Skipping upload - no files to upload");
    }

    let invalidationIds: string[] = [];
    if (deploy.cloudfront) {
        try {
            logger.info("\n> Invalidating CloudFront...");
            const filesNeedingInvalidation = Array.from(fileMap.values()).filter(
                (file) => file.invalidate,
            );
            let invalidationIds: string[] = [];
            for (const cf of deploy.cloudfront) {
                const context = {
                    ...deploy.context,
                    ...cf.context,
                }
                if (!context.region) {
                    logger.warn(`Skipping CloudFront distribution ${cf.distributionId}: missing region`);
                    continue;
                }
                try {
                    let invalidationId = await invalidateCloudFront(
                        filesNeedingInvalidation,
                        cf.invalidatePaths || null,
                        cf.distributionId,
                        context,
                        logger,
                    )
                    if (invalidationId) {
                        invalidationIds.push(invalidationId);
                    }
                } catch (error) {
                    logger.error(
                        `Failed to create invalidation for distribution ${cf.distributionId}`,
                        '$response' in (error as any) ? (error as any).$response : error as Error
                    );
                    throw error;
                }
                invalidationIds.push();
            }
        } catch (error) {
            logger.error("Failed to invalidate CloudFront", error as Error);
        }
    } else {
        logger.info("\n> Skipping invalidation - no files to invalidate");
    }

    if (toDelete.size > 0) {
        logger.info("\n> Purging files...");
        for (const priority of Array.from(toDelete.keys()).sort((a, b) => a - b)) {
            //logger.debug(`> Purging files with priority ${priority}...`);
            await purgeFromS3(toDelete.get(priority)!, {
                bucket,
                prefix: deploy.s3.prefix,
                context: {
                    ...deploy.context,
                    ...deploy.s3.context,
                },
                concurrency: options.concurrency || 5,
            }, logger);
            toDelete.delete(priority);
        }
    }

    if (stateFile) {
        logger.info("\n> Saving state file...");
        await saveState(fileMap, getS3ClientInstance({
            ...deploy.context,
            ...deploy.s3.context,
        }), { bucket, stateFile, prefix: deploy.s3.prefix }, logger);
    }

    logger.info("\n> Deployment pipeline completed successfully");

    return {
        files: fileMap,
        invalidationIds,
        result: "success",
    };
}
