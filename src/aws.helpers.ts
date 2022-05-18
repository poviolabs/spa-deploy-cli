import {
  DeleteObjectCommand,
  paginateListObjectsV2,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { fromEnv } from "@aws-sdk/credential-provider-env";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { lookup } from "mime-types";
import { isMatch } from "micromatch";
import fs from "fs";
import {
  LocalFile,
  scanLocal,
  ScanLocalOptions,
  SyncAction,
  SyncActionColors,
} from "./sync.helper";
import {chk, info} from "./cli.helper";

function getCredentials() {
  if (process.env.AWS_PROFILE) {
    return fromIni();
  }
  return fromEnv();
}

export async function getAwsIdentity(options: { region: string }) {
  const stsClient = new STSClient({
    credentials: getCredentials(),
    region: options.region,
  });
  return await stsClient.send(new GetCallerIdentityCommand({}));
}

export function getS3ClientInstance(options: {
  region: string;
  endpoint?: string;
}) {
  return new S3Client({
    credentials: getCredentials(),
    region: options.region,
    ...(options.endpoint
      ? { forcePathStyle: true, endpoint: options.endpoint }
      : {}),
  });
}

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
  lastModified: Date;
  eTag: string;
  size: number;
}

export async function* scanS3Files(
  client: S3Client,
  options: {
    bucket: string;
    prefix: string;
  }
) {
  for await (const data of paginateListObjectsV2(
    {
      client,
    },
    { Bucket: options.bucket, Prefix: options.prefix }
  )) {
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

export interface S3SyncPlanItem {
  local?: LocalFile;
  remote?: S3File;
  action?: SyncAction;
  acl?: string;
  cacheControl?: string;
  contentDisposition?: string;
  contentType?: string;
  invalidate?: boolean;
  cache?: boolean;
  transformers?: Array<(text: string) => string>;
}

export type S3SyncPlan = Record<string, S3SyncPlanItem>;

export function printS3SyncPlan(
  plan: S3SyncPlan,
  print = true,
  verbose = false
) {
  const output = [];
  for (const [key, item] of Object.entries(plan)) {
    if (!verbose) {
      if (item.action == SyncAction.unchanged) {
        continue;
      }
    }

    const line = [
      SyncActionColors[item.action](item.action.padEnd(9, " ")),
      [
        item.invalidate ? chk.magenta("Invalidate") : "          ",
        item.cache
          ? item.action == SyncAction.unchanged
            ? "Cached"
            : "Cache"
          : "     ",
        item.transformers?.length > 0 ? "Transf." : "       ",
      ].join("\t"),
      ` ${key} `,
      item.local ? `(${item.local.size}b ${item.contentType ?? ""})` : "",
    ];

    output.push(line.join(""));
  }
  if (print) {
    console.log(output.join("\n"));
  }
  return output.join("\n");
}
export async function prepareS3SyncPlan(
  localOptions: ScanLocalOptions,
  s3Options: SyncS3Options
): Promise<S3SyncPlan> {
  const plan: S3SyncPlan = {};

  // find local files
  for await (const file of scanLocal(localOptions)) {
    const planItem = {
      local: file,
      contentDisposition: "inline",
      contentType: lookup(file.path) || "application/octet-stream",
      action: SyncAction.create,
      acl: s3Options.acl,
    };

    if (
      s3Options.invalidateGlob &&
      isMatch(file.key, s3Options.invalidateGlob)
    ) {
      plan[file.key] = {
        ...planItem,
        cacheControl: "public, must-revalidate",
        invalidate: false,
        cache: false,
        ...(plan[file.key] ? plan[file.key] : {}),
      };
    } else {
      plan[file.key] = {
        ...planItem,
        cacheControl: "max-age=2628000, public",
        invalidate: false,
        cache: true,
        ...(plan[file.key] ? plan[file.key] : {}),
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
    let action = s3Options.purge ? SyncAction.delete : SyncAction.unknown;

    if (localOptions.ignoreGlob && isMatch(file.Key, localOptions.ignoreGlob)) {
      action = SyncAction.ignore;
    }

    plan[file.Key] = {
      remote: {
        key: file.Key,
        lastModified: file.LastModified,
        eTag: file.ETag,
        size: file.Size,
      },
      action,
      ...(plan[file.Key] ? plan[file.Key] : {}),
    };

    if (plan[file.Key].action === SyncAction.create) {
      if (
        !s3Options.force &&
        plan[file.Key].local.size === plan[file.Key].remote.size &&
        plan[file.Key].local.hash === plan[file.Key].remote.eTag
      ) {
        // unchanged!
        plan[file.Key].action = SyncAction.unchanged;
      } else {
        // update
        plan[file.Key].invalidate = true;
        plan[file.Key].action = SyncAction.update;
      }
    }
  }

  return plan;
}

export async function executeS3SyncPlan(
  plan: S3SyncPlan,
  s3Options: SyncS3Options
) {
  const client = getS3ClientInstance({
    region: s3Options.region,
    endpoint: s3Options.endpoint,
  });

  // todo order of importance / cache / index files
  // todo multi-threaded
  for (const [key, item] of Object.entries(plan)) {
    switch (item.action) {
      case SyncAction.create:
      case SyncAction.update: {
        info(`Uploading ${key}`);
        await client.send(
          new PutObjectCommand({
            Bucket: s3Options.bucket,
            Key: key,
            ACL: item.acl,
            CacheControl: item.cacheControl,
            ContentType: item.contentType,
            ContentDisposition: item.contentDisposition,
            Body: item.transformers
              ? item.transformers.reduce((acc, cur) => {
                  return cur(acc);
                }, fs.readFileSync(item.local.path, "utf8"))
              : fs.readFileSync(item.local.path),
          })
        );
        break;
      }
      case SyncAction.delete: {
        info(`Deleting ${key}`);
        await client.send(
          new DeleteObjectCommand({
            Bucket: s3Options.bucket,
            Key: key,
          })
        );
        break;
      }
      default: {
        break;
      }
    }
  }
}

export function prepareCloudfrontInvalidation(
  plan: S3SyncPlan,
  invalidatePaths: string[]
): string[] {
  return [
    ...Object.entries(plan).reduce((acc, [k, v]) => {
      if (v.invalidate) {
        acc.push(k);
      }
      return acc;
    }, []),
    ...invalidatePaths,
  ];
}

export async function executeCloudfrontInvalidation(
  invalidations: string[],
  distributionsId: string[],
  region: string
) {
  // get cf client
  // get all file invalidation
  // append folder invalidation
  // do the invalidation
  /*
  const response = await cf
      .createInvalidation({
        DistributionId,
        InvalidationBatch: {
          CallerReference: new Date().toISOString(),
          Paths: {
            Quantity: items.length,
            Items: items,
          },
        },
      })
      .promise();
  */
}
