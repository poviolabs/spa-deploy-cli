import { z } from "zod";
import path from "path";
import fs from "fs";

import { safeLoadConfig } from "../helpers/ze-config";
import {
  executeCloudfrontInvalidation,
  prepareCloudfrontInvalidation,
} from "../helpers/aws-cloudfront.helper";
import { SyncAction } from "../helpers/sync.helper";
import {
  confirm,
  logBanner,
  logError,
  logInfo,
  logVariable,
  logWarning,
} from "../helpers/cli.helper";
import {
  executeS3SyncPlan,
  prepareS3SyncPlan,
  printS3SyncPlan,
  S3SyncPlan,
} from "../helpers/aws-s3.helper";

import { CloudfrontConfig } from "./invalidate";

const toArray = function (input: string | string[] | undefined | null) {
  if (input === undefined || input === null) {
    return [];
  }
  if (Array.isArray(input)) {
    return input;
  }
  return [input];
};

const DeployConfigItem = z.object({
  name: z.string(),
  buildPath: z
    .string()
    .optional()
    .default("dist")
    .describe("Path to SPA build"),

  includeGlob: z
    .union([z.string(), z.string().array()])
    .transform(toArray)
    .describe("Include only these files, defaults to all files in buildPath")
    .optional(),

  ignoreGlob: z
    .union([z.string(), z.string().array()])
    .transform(toArray)
    .describe("Ignore these files, has priority over include")
    .optional(),

  s3: z
    .object({
      region: z.string().optional(),
      bucket: z.string(),
      prefix: z.string().describe("Prefix path used on S3").optional(),
      endpoint: z.string().describe("AWS services endpoint").optional(),
      force: z
        .boolean()
        .describe("Replace all files unconditionally")
        .optional(),
      purge: z
        .boolean()
        .describe("Remove all unknown files from S3")
        .optional(),

      invalidateGlob: z
        .union([z.string(), z.string().array()])
        .transform(toArray)
        .describe("Do not cache these files and invalidate them on deploy")
        .optional(),

      acl: z.string().optional(),
    })
    .optional(),

  cloudfront: CloudfrontConfig.optional(),
});
const DeployConfigs = z
  .union([
    DeployConfigItem.extend({ name: z.string().optional() }),
    DeployConfigItem.array(),
  ])
  .transform((val) => (Array.isArray(val) ? val : [val]));

export async function deploy(argv: {
  pwd: string;
  stage: string;
  release: string;
  target?: string;
  verbose?: boolean;
  purge?: boolean;
  force?: boolean;
  ci?: boolean;
}): Promise<void> {
  const config = await safeLoadConfig(
    "spa-deploy",
    argv.pwd,
    argv.stage,
    z.object({
      deploy: DeployConfigs,
      region: z.string().optional().describe("AWS Region"),
      accountId: z.string().optional().describe("AWS Account ID"),
      endpoint: z.string().optional().describe("AWS services endpoint"),
    }),
    false,
  );

  for (const d of config.deploy) {
    if (argv.target && d.name !== argv.target) {
      continue;
    }

    logInfo(`Deploying ${d.name || ""}...`);

    const buildPath = path.join(argv.pwd, d.buildPath);
    logVariable("deploy__buildPath", buildPath);

    if (!fs.lstatSync(buildPath).isDirectory()) {
      logError(`Build path ${buildPath} is not a directory.`);
      process.exit(1);
    }

    let s3SyncPlan: S3SyncPlan | undefined = undefined;

    if (d.s3) {
      const endpoint = d.s3.endpoint || config.endpoint;
      if (endpoint) {
        logVariable("deploy__s3__endpoint", endpoint);
      }

      const region = d.s3.region || config.region;
      logVariable("deploy__s3__region", region);
      if (!region) {
        logError("AWS Region is not set");
        process.exit(1);
      }

      const bucket = d.s3.bucket;
      logVariable("deploy__s3__bucket", bucket);

      if (!bucket) {
        logError(`S3 Deploy Bucket is not set`);
        process.exit(1);
      }

      const prefix = d.s3.prefix;

      if (prefix) {
        logVariable("deploy__s3__prefix", prefix);
      }

      s3SyncPlan = await prepareS3SyncPlan(
        {
          path: buildPath,
          includeGlob: d.includeGlob,
          ignoreGlob: d.ignoreGlob,
        },
        {
          region,
          bucket: d.s3.bucket,
          endpoint,
          prefix: d.s3.prefix,
          force: d.s3.force || argv.force,
          purge: d.s3.purge || argv.purge,
          invalidateGlob: d.s3.invalidateGlob,
          acl: d.s3.acl,
        },
      );

      logBanner(`S3 Sync Plan`);
      printS3SyncPlan(s3SyncPlan, true, !!argv.verbose);
    }

    if (
      !s3SyncPlan ||
      !s3SyncPlan.items.some((x) =>
        [SyncAction.create, SyncAction.update, SyncAction.delete].includes(
          x.action!,
        ),
      )
    ) {
      logInfo(`No files to deploy`);
      continue;
    }

    let cloudfrontInvalidations: string[] = [];

    const cloudfrontIds = d.cloudfront?.distributionId || [];
    if (d.cloudfront && s3SyncPlan) {
      cloudfrontInvalidations = prepareCloudfrontInvalidation(s3SyncPlan);
    }

    if (d.cloudfront?.invalidatePaths?.length) {
      cloudfrontInvalidations = [
        ...cloudfrontInvalidations,
        ...d.cloudfront.invalidatePaths,
      ];
    }

    if (cloudfrontInvalidations.length > 0) {
      logBanner(`Cloudfront invalidations`);
      for (const i of cloudfrontInvalidations) {
        console.log(i);
      }
      if (cloudfrontIds.length < 1) {
        logWarning(`Cloudfront distributionId is not set`);
      }
    }

    if (!argv.ci) {
      if (!(await confirm("Press enter to deploy..."))) {
        logInfo("Canceled");
        return;
      }
    }

    await executeS3SyncPlan(s3SyncPlan);

    if (d.cloudfront) {
      const region = d.cloudfront.region || config.region;
      logVariable("deploy__cloudfront__region", region);
      if (!region) {
        logWarning("AWS Region is not set");
        continue;
      }
      if (cloudfrontInvalidations.length > 0 && cloudfrontIds.length > 0) {
        await executeCloudfrontInvalidation(
          cloudfrontInvalidations,
          cloudfrontIds,
          region,
        );
      }
    }
  }
}
