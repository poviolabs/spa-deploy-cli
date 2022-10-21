"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeCloudfrontInvalidation = exports.prepareCloudfrontInvalidation = exports.executeS3SyncPlan = exports.prepareS3SyncPlan = exports.printS3SyncPlan = exports.scanS3Files = exports.getCloudfrontClientInstance = exports.getS3ClientInstance = exports.getAwsIdentity = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_cloudfront_1 = require("@aws-sdk/client-cloudfront");
const credential_provider_ini_1 = require("@aws-sdk/credential-provider-ini");
const credential_provider_env_1 = require("@aws-sdk/credential-provider-env");
const client_sts_1 = require("@aws-sdk/client-sts");
const mime_types_1 = require("mime-types");
const micromatch_1 = require("micromatch");
const fs_1 = __importDefault(require("fs"));
const sync_helper_1 = require("./sync.helper");
const node_stage_1 = require("@povio/node-stage");
function getCredentials() {
    if (process.env.AWS_PROFILE) {
        return (0, credential_provider_ini_1.fromIni)();
    }
    return (0, credential_provider_env_1.fromEnv)();
}
async function getAwsIdentity(options) {
    const stsClient = new client_sts_1.STSClient({
        credentials: getCredentials(),
        region: options.region,
    });
    return await stsClient.send(new client_sts_1.GetCallerIdentityCommand({}));
}
exports.getAwsIdentity = getAwsIdentity;
function getS3ClientInstance(options) {
    return new client_s3_1.S3Client({
        credentials: getCredentials(),
        region: options.region,
        ...(options.endpoint
            ? { forcePathStyle: true, endpoint: options.endpoint }
            : {}),
    });
}
exports.getS3ClientInstance = getS3ClientInstance;
function getCloudfrontClientInstance(options) {
    return new client_cloudfront_1.CloudFrontClient({
        credentials: getCredentials(),
        region: options.region,
    });
}
exports.getCloudfrontClientInstance = getCloudfrontClientInstance;
async function* scanS3Files(client, options) {
    for await (const data of (0, client_s3_1.paginateListObjectsV2)({
        client,
    }, { Bucket: options.bucket, Prefix: options.prefix })) {
        if (data.Contents) {
            for (const x of data.Contents) {
                yield {
                    Key: x.Key,
                    LastModified: x.LastModified,
                    ETag: x.ETag,
                    Size: x.Size,
                };
            }
        }
    }
}
exports.scanS3Files = scanS3Files;
function printS3SyncPlan(plan, print = true, verbose = false) {
    const output = [];
    for (const item of plan.items) {
        const { key, action, invalidate, cache, local, contentType, data, remote } = item;
        if (!verbose) {
            if (action == sync_helper_1.SyncAction.unchanged) {
                continue;
            }
        }
        if (!action) {
            throw new Error(`Action not defined for ${key}`);
        }
        const line = [
            sync_helper_1.SyncActionColors[action](action.padEnd(9, " ")),
            [
                invalidate ? node_stage_1.chk.magenta("Invalidate") : "          ",
                cache ? (action == sync_helper_1.SyncAction.unchanged ? "Cached" : "Cache") : "     ",
                data !== undefined ? "DATA  " : "      ",
                // local?.hash,
                // remote?.eTag,
            ].join("\t"),
            ` ${key} `,
            local ? `(${local.size}b ${contentType ?? ""})` : "",
        ];
        output.push(line.join(""));
    }
    if (print) {
        console.log(output.join("\n"));
    }
    return output.join("\n");
}
exports.printS3SyncPlan = printS3SyncPlan;
async function prepareS3SyncPlan(localOptions, s3Options) {
    const itemsDict = {};
    // find local files
    for await (const file of (0, sync_helper_1.scanLocal)(localOptions)) {
        const planItem = {
            local: file,
            contentDisposition: "inline",
            contentType: (0, mime_types_1.lookup)(file.path) || "application/octet-stream",
            action: sync_helper_1.SyncAction.create,
            acl: s3Options.acl,
        };
        if (s3Options.invalidateGlob &&
            (0, micromatch_1.isMatch)(file.key, s3Options.invalidateGlob)) {
            itemsDict[file.key] = {
                key: file.key,
                ...planItem,
                cacheControl: "public, must-revalidate",
                invalidate: false,
                cache: false,
                ...(itemsDict[file.key] ? itemsDict[file.key] : {}),
            };
        }
        else {
            itemsDict[file.key] = {
                key: file.key,
                ...planItem,
                cacheControl: "max-age=2628000, public",
                invalidate: false,
                cache: true,
                ...(itemsDict[file.key] ? itemsDict[file.key] : {}),
            };
        }
    }
    const client = getS3ClientInstance({
        region: s3Options.region,
        endpoint: s3Options.endpoint,
    });
    for await (const file of scanS3Files(client, {
        bucket: s3Options.bucket,
        prefix: s3Options.prefix,
    })) {
        const action = s3Options.purge ? sync_helper_1.SyncAction.delete : sync_helper_1.SyncAction.unknown;
        //if (localOptions.ignoreGlob && isMatch(key, localOptions.ignoreGlob)) {
        //  action = SyncAction.ignore;
        //}
        if (!file.Key) {
            throw new Error(`File Key not defined for ${JSON.stringify(file)}`);
        }
        const key = file.Key;
        if (!file.ETag) {
            throw new Error(`File Etag not defined for ${JSON.stringify(file)}`);
        }
        itemsDict[key] = {
            key: key,
            remote: {
                key: key,
                lastModified: file.LastModified,
                eTag: file.ETag.replace(/"/g, ""),
                size: file.Size,
            },
            action,
            ...(itemsDict[key] ? itemsDict[key] : {}),
        };
        if (itemsDict[key].local) {
            if (!s3Options.force &&
                itemsDict[key].local?.hash === itemsDict[key].remote?.eTag) {
                // unchanged!
                itemsDict[key].action = sync_helper_1.SyncAction.unchanged;
            }
            else {
                // update
                itemsDict[key].invalidate = true;
                itemsDict[key].action = sync_helper_1.SyncAction.update;
            }
        }
    }
    return {
        items: Object.values(itemsDict),
        region: s3Options.region,
        bucket: s3Options.bucket,
        endpoint: s3Options.endpoint,
    };
}
exports.prepareS3SyncPlan = prepareS3SyncPlan;
async function executeS3SyncPlan(plan) {
    const { items, region, endpoint, bucket } = plan;
    const client = getS3ClientInstance({
        region,
        endpoint,
    });
    // todo multi-threaded
    for (const item of items) {
        const { key, action, acl, cacheControl, contentType, contentDisposition, local, data, } = item;
        switch (action) {
            case sync_helper_1.SyncAction.create:
            case sync_helper_1.SyncAction.update: {
                (0, node_stage_1.logInfo)(`Uploading ${key}`);
                await client.send(new client_s3_1.PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    ACL: acl,
                    CacheControl: cacheControl,
                    ContentType: contentType,
                    ContentDisposition: contentDisposition,
                    Body: data !== undefined ? data : fs_1.default.readFileSync(local.path),
                }));
                break;
            }
            case sync_helper_1.SyncAction.delete: {
                (0, node_stage_1.logInfo)(`Deleting ${key}`);
                await client.send(new client_s3_1.DeleteObjectCommand({
                    Bucket: bucket,
                    Key: key,
                }));
                break;
            }
            default: {
                break;
            }
        }
    }
}
exports.executeS3SyncPlan = executeS3SyncPlan;
function prepareCloudfrontInvalidation(plan, invalidatePaths) {
    const { items } = plan;
    return [
        ...items.reduce((acc, item) => {
            if (item.invalidate) {
                acc.push(`/${item.remote.key}`);
            }
            return acc;
        }, []),
        ...invalidatePaths,
    ];
}
exports.prepareCloudfrontInvalidation = prepareCloudfrontInvalidation;
async function executeCloudfrontInvalidation(invalidations, distributionsId, region) {
    for (const DistributionId of distributionsId) {
        const client = getCloudfrontClientInstance({ region });
        (0, node_stage_1.logInfo)(`Invalidating ${DistributionId}`);
        await client.send(new client_cloudfront_1.CreateInvalidationCommand({
            DistributionId,
            InvalidationBatch: {
                CallerReference: new Date().toISOString(),
                Paths: {
                    Quantity: invalidations.length,
                    Items: invalidations,
                },
            },
        }));
    }
}
exports.executeCloudfrontInvalidation = executeCloudfrontInvalidation;
//# sourceMappingURL=aws.helpers.js.map