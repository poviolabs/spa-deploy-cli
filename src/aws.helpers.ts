import {
  DeleteObjectCommand,
  paginateListObjectsV2,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
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
import { chk, info } from "./cli.helper";

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

export function getCloudfrontClientInstance(options: { region: string }) {
  return new CloudFrontClient({
    credentials: getCredentials(),
    region: options.region,
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
  transformers?: Array<(text: string) => string>;
}

export type S3SyncPlan = {
  items: S3SyncPlanItem[];
  region: string;
  bucket: string;
  endpoint?: string;
};

export function printS3SyncPlan(
  plan: S3SyncPlan,
  print = true,
  verbose = false
) {
  const output = [];
  for (const item of plan.items) {
    const { key, action, invalidate, cache, transformers, local, contentType } =
      item;
    if (!verbose) {
      if (action == SyncAction.unchanged) {
        continue;
      }
    }

    const line = [
      SyncActionColors[action](action.padEnd(9, " ")),
      [
        invalidate ? chk.magenta("Invalidate") : "          ",
        cache ? (action == SyncAction.unchanged ? "Cached" : "Cache") : "     ",
        transformers?.length > 0 ? "Transf." : "       ",
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
export async function prepareS3SyncPlan(
  localOptions: ScanLocalOptions,
  s3Options: SyncS3Options
): Promise<S3SyncPlan> {
  const itemsDict: Record<string, S3SyncPlanItem> = {};

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
      itemsDict[file.key] = {
        key: file.key,
        ...planItem,
        cacheControl: "public, must-revalidate",
        invalidate: false,
        cache: false,
        ...(itemsDict[file.key] ? itemsDict[file.key] : {}),
      };
    } else {
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
    let action = s3Options.purge ? SyncAction.delete : SyncAction.unknown;

    if (localOptions.ignoreGlob && isMatch(file.Key, localOptions.ignoreGlob)) {
      action = SyncAction.ignore;
    }

    itemsDict[file.Key] = {
      key: file.Key,
      remote: {
        key: file.Key,
        lastModified: file.LastModified,
        eTag: file.ETag,
        size: file.Size,
      },
      action,
      ...(itemsDict[file.Key] ? itemsDict[file.Key] : {}),
    };

    if (itemsDict[file.Key].action === SyncAction.create) {
      if (
        !s3Options.force &&
        itemsDict[file.Key].local.size === itemsDict[file.Key].remote.size &&
        itemsDict[file.Key].local.hash === itemsDict[file.Key].remote.eTag
      ) {
        // unchanged!
        itemsDict[file.Key].action = SyncAction.unchanged;
      } else {
        // update
        itemsDict[file.Key].invalidate = true;
        itemsDict[file.Key].action = SyncAction.update;
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

export async function executeS3SyncPlan(plan: S3SyncPlan) {
  const { items, region, endpoint, bucket } = plan;

  const client = getS3ClientInstance({
    region,
    endpoint,
  });

  // todo order of importance / cache / index files
  // todo multi-threaded
  for (const item of items) {
    const {
      key,
      action,
      acl,
      cacheControl,
      contentType,
      contentDisposition,
      local,
      transformers,
    } = item;
    switch (action) {
      case SyncAction.create:
      case SyncAction.update: {
        info(`Uploading ${key}`);
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ACL: acl,
            CacheControl: cacheControl,
            ContentType: contentType,
            ContentDisposition: contentDisposition,
            Body: transformers
              ? transformers.reduce((acc, cur) => {
                  return cur(acc);
                }, fs.readFileSync(local.path, "utf8"))
              : fs.readFileSync(local.path),
          })
        );
        break;
      }
      case SyncAction.delete: {
        info(`Deleting ${key}`);
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
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
  const { items } = plan;
  return [
    ...items.reduce((acc, item) => {
      if (item.invalidate) {
        acc.push(item.remote.key);
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
  for (const DistributionId of distributionsId) {
    const client = getCloudfrontClientInstance({ region });
    info(`Invalidating ${DistributionId}`);
    await client.send(
      new CreateInvalidationCommand({
        DistributionId,
        InvalidationBatch: {
          CallerReference: new Date().toISOString(),
          Paths: {
            Quantity: invalidations.length,
            Items: invalidations,
          },
        },
      })
    );
  }
}
