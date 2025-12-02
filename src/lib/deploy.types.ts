import picomatch from "picomatch";
import * as z from "zod";


export enum SyncAction {
    ignored = "Ignored",
    unchanged = "Unchanged",
    delete = "Delete",
    update = "Update",
    create = "Create",
}

export interface DeployFile {
    key: string;
    localPath?: string;
    localHash?: string;
    localSize?: number;
    remoteHash?: string;
    remoteSize?: number;
    cacheControl?: string;
    contentType?: string;
    contentDisposition?: string;
    acl?: string;
    invalidate?: boolean;
    action: SyncAction;
    priority: number;
}

export const contextConfig = z.object({
    region: z.string().optional(),
    accountId: z.string().optional(),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    endpoint: z.string().optional(),
});
export type ContextConfig = z.output<typeof contextConfig>;

export const fileConfig = z.object({
    includeGlob: z.union([z.string(), z.array(z.string())]),
    cacheControl: z.string().optional(),
    skipUnchanged: z.boolean().optional(),
    purge: z.boolean().optional(),
    invalidate: z.boolean().optional(),
    contentType: z.string().optional(),
    contentDisposition: z.string().optional(),
    acl: z.string().optional(),
    priority: z.number().optional()
}).transform((i) => ({
    ...i,
    includeGlob: (Array.isArray(i.includeGlob) ? i.includeGlob : [i.includeGlob]).map(glob => picomatch(glob)),
}));

export type FileConfig = z.output<typeof fileConfig>;

export const s3Config = z.object({
    bucket: z.string(),
    prefix: z.string().optional(),
    scan: z.boolean().optional(),
    stateFile: z.union([z.boolean(), z.string()]).optional(),
    skipUnchanged: z.boolean().optional(),
    purge: z.boolean().optional(),
    context: contextConfig.optional(),
    acl: z.string().optional(),
});
export type S3Config = z.output<typeof s3Config>;

export const cloudfrontConfig = z.object({
    distributionId: z.string(),
    invalidatePaths: z.array(z.string()).optional().nullable(),
    context: contextConfig.optional(),
});
export type CloudfrontConfig = z.output<typeof cloudfrontConfig>;

export const deployConfig = z.object({
    prefix: z.string(),
    files: z.array(fileConfig),
    s3: s3Config,
    cloudfront: z.array(cloudfrontConfig).optional(),
    context: contextConfig.optional(),
});
export type DeployConfig = z.input<typeof deployConfig>;

export const CloudfrontConfigSchema = cloudfrontConfig;