import {
  DeleteObjectCommand,
  paginateListObjectsV2,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { lookup } from "mime-types";
import mm from "micromatch";
import fs from "fs";

import {
  LocalFile,
  scanLocal,
  ScanLocalOptions,
  SyncAction,
  SyncActionColors,
} from "./sync.helper";
import { chk } from "./chalk.helper";
import { logInfo } from "./cli.helper";
import { getCredentials } from "./aws.helper";

export function getS3ClientInstance(options: {
  region: string;
  endpoint?: string;
}) {
  return new S3Client({
    credentials: getCredentials({ region: options.region }),
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
  lastModified: Date | undefined;
  eTag: string;
  size: number | undefined;
}

export async function* scanS3Files(
  client: S3Client,
  options: {
    bucket: string;
    prefix: string | undefined;
  },
) {
  for await (const data of paginateListObjectsV2(
    {
      client,
    },
    { Bucket: options.bucket, Prefix: options.prefix },
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
  data?: string | Buffer;
  dataHash?: string;
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
  verbose = false,
) {
  const output: string[] = [];
  for (const item of plan.items) {
    const { key, action, invalidate, cache, local, contentType, data } = item;
    if (!verbose) {
      if (action == SyncAction.unchanged) {
        continue;
      }
    }

    if (!action) {
      throw new Error(`Action not defined for ${key}`);
    }

    const line = [
      SyncActionColors[action](action.padEnd(9, " ")),
      [
        invalidate ? chk.magenta("Invalidate") : "          ",
        cache ? (action == SyncAction.unchanged ? "Cached" : "Cache") : "     ",
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
export async function prepareS3SyncPlan(
  localOptions: ScanLocalOptions,
  s3Options: SyncS3Options,
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
      mm.isMatch(file.key, s3Options.invalidateGlob)
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
    const action = s3Options.purge ? SyncAction.delete : SyncAction.unknown;

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
      if (
        !s3Options.force &&
        itemsDict[key].local?.hash === itemsDict[key].remote?.eTag
      ) {
        // unchanged!
        itemsDict[key].action = SyncAction.unchanged;
      } else {
        // update
        itemsDict[key].invalidate = true;
        itemsDict[key].action = SyncAction.update;
      }
    }
  }

  const sortAction: Record<SyncAction, number> = {
    [SyncAction.unknown]: 0,
    [SyncAction.ignore]: 1,
    [SyncAction.unchanged]: 2,
    [SyncAction.create]: 3,
    [SyncAction.update]: 4,
    [SyncAction.delete]: 5,
  };

  const items = Object.values(itemsDict);

  // sort deploy
  items.sort((a, b) => {
    // > 0	 sort b before a
    // < 0	 sort a before b
    // === 0	 keep original order of a and b

    // sort by action
    if (sortAction[a.action!] > sortAction[b.action!]) return 1;
    if (sortAction[a.action!] < sortAction[b.action!]) return -1;

    // cached items go first
    if (a.cache && !b.cache) return -1;
    if (!a.cache && b.cache) return 1;

    return 0;
  });

  return {
    items,
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

  // todo multi-threaded
  for (const item of items) {
    const {
      key,
      action,
      // acl,
      cacheControl,
      contentType,
      contentDisposition,
      local,
      data,
    } = item;
    switch (action) {
      case SyncAction.create:
      case SyncAction.update: {
        logInfo(`Uploading ${key}`);
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            //ACL: acl, todo
            CacheControl: cacheControl,
            ContentType: contentType,
            ContentDisposition: contentDisposition,
            Body: data !== undefined ? data : fs.readFileSync(local!.path),
          }),
        );
        break;
      }
      case SyncAction.delete: {
        logInfo(`Deleting ${key}`);
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        );
        break;
      }
      default: {
        break;
      }
    }
  }
}
