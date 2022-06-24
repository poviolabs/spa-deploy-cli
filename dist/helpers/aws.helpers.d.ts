/// <reference types="node" />
import { S3Client } from "@aws-sdk/client-s3";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { LocalFile, ScanLocalOptions, SyncAction } from "./sync.helper";
export declare function getAwsIdentity(options: {
    region: string;
}): Promise<import("@aws-sdk/client-sts").GetCallerIdentityCommandOutput>;
export declare function getS3ClientInstance(options: {
    region: string;
    endpoint?: string;
}): S3Client;
export declare function getCloudfrontClientInstance(options: {
    region: string;
}): CloudFrontClient;
export interface SyncS3Options {
    region: string;
    bucket: string;
    endpoint?: string;
    prefix?: string;
    /**
     * Remove all unknown files
     */
    purge?: boolean;
    /**
     * Force replace files even if equal
     */
    force?: boolean;
    /**
     * Matched files are not cached and are invalidated on deploy
     */
    invalidateGlob?: string[];
    acl?: string;
}
export interface S3File {
    key: string;
    lastModified: Date | undefined;
    eTag: string;
    size: number | undefined;
}
export declare function scanS3Files(client: S3Client, options: {
    bucket: string;
    prefix: string | undefined;
}): AsyncGenerator<{
    Key: string | undefined;
    LastModified: Date | undefined;
    ETag: string | undefined;
    Size: number | undefined;
}, void, unknown>;
export interface S3SyncPlanItem {
    key: string;
    local?: LocalFile;
    remote?: S3File;
    action?: SyncAction;
    acl?: string;
    cacheControl?: string;
    contentDisposition?: string;
    contentType?: string;
    invalidate?: boolean;
    cache?: boolean;
    data?: string | Buffer;
    dataHash?: string;
}
export declare type S3SyncPlan = {
    items: S3SyncPlanItem[];
    region: string;
    bucket: string;
    endpoint?: string;
};
export declare function printS3SyncPlan(plan: S3SyncPlan, print?: boolean, verbose?: boolean): string;
export declare function prepareS3SyncPlan(localOptions: ScanLocalOptions, s3Options: SyncS3Options): Promise<S3SyncPlan>;
export declare function executeS3SyncPlan(plan: S3SyncPlan): Promise<void>;
export declare function prepareCloudfrontInvalidation(plan: S3SyncPlan, invalidatePaths: string[]): string[];
export declare function executeCloudfrontInvalidation(invalidations: string[], distributionsId: string[], region: string): Promise<void>;
