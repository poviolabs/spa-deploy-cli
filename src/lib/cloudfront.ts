import {
    CloudFrontClient,
    CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";

import { Logger } from "../helpers/logger";
import { type AwsContext, getCredentials } from "./aws";
import type { ContextConfig, DeployFile } from "./deploy.types";

export function getCloudfrontClientInstance(context: AwsContext): CloudFrontClient {
    if (!context.region) {
        throw new Error("AWS Region is required for CloudFront client");
    }
    const endpoint = context.endpoint || process.env.AWS_CLOUDFRONT_ENDPOINT;
    return new CloudFrontClient({
        credentials: getCredentials(context),
        region: context.region,
        endpoint,
    });
}

function normalizePath(path: string): string {
    return path.startsWith("/") ? path : `/${path}`;
}

function encodeInvalidationPath(path: string): string {
    return path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

export async function invalidateCloudFront(
    files: DeployFile[],
    additionalPaths: string[] | null,
    distributionId: string,
    context: ContextConfig,
    logger: Logger = new Logger(false),
    getCloudfrontClient: typeof getCloudfrontClientInstance = getCloudfrontClientInstance,
): Promise<string | null> {

    const pathsToInvalidate = new Set<string>();

    for (const file of files) {
        if (file.invalidate) {
            pathsToInvalidate.add(encodeInvalidationPath(normalizePath(file.key)));
        }
    }

    for (const path of additionalPaths || []) {
        pathsToInvalidate.add(encodeInvalidationPath(normalizePath(path)));
    }

    if (pathsToInvalidate.size === 0) {
        logger.info("No paths to invalidate");
        return null;
    }

    const pathsArray = Array.from(pathsToInvalidate);

    if (!context.region) {
        throw new Error("AWS Region is required for CloudFront invalidation");
    }

    const client = getCloudfrontClient(context);

    for (const path of pathsArray) {
        logger.info(`>> ${path}`);
    }

    const response = await client.send(
        new CreateInvalidationCommand({
            DistributionId: distributionId,
            InvalidationBatch: {
                CallerReference: new Date().toISOString(),
                Paths: {
                    Quantity: pathsArray.length,
                    Items: pathsArray,
                },
            },
        }),
    );
    if (response.Invalidation?.Id) {
        logger.info(
            `Created invalidation ${response.Invalidation.Id} for distribution ${distributionId}`,
        );
        return response.Invalidation.Id;
    }
    return null;
}
