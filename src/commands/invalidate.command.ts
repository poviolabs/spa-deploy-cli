/*
  Invalidate CloudFront distribution
 */

import yargs from "yargs";
import path from "path";
import fs from "fs";
import micromatch from "micromatch";
import { createHash } from "crypto";

import process from "process";
import {
  executeCloudfrontInvalidation,
  executeS3SyncPlan,
  prepareCloudfrontInvalidation,
  prepareS3SyncPlan,
  printS3SyncPlan,
} from "../helpers/aws.helpers";
import { SyncAction } from "../helpers/sync.helper";
import {
  ReleaseStrategy,
  Option,
  getYargsOptions,
  logWarning,
  logError,
  loadYargsConfig,
  logInfo,
  Config,
  logVariable,
  logBanner,
  getToolEnvironment,
  YargsOptions,
  getGitChanges,
  confirm,
} from "node-stage";

import { getVersion } from "../helpers/version.helper";

class SpaBuildOptions implements YargsOptions {
  @Option({ envAlias: "PWD", demandOption: true })
  pwd!: string;

  @Option({ envAlias: "STAGE", demandOption: true })
  stage!: string;

  @Option({
    envAlias: "RELEASE",
    envAliases: ["CIRCLE_SHA1", "BITBUCKET_COMMIT", "GITHUB_SHA"],
    demandOption: true,
  })
  release!: string;

  @Option({
    envAlias: "APP_VERSION",
    envAliases: ["CIRCLE_TAG", "BITBUCKET_TAG"],
    type: "string",
    alias: "ecsVersion",
  })
  appVersion!: string;

  @Option({
    default: "gitsha",
    choices: ["gitsha", "gitsha-stage"],
    type: "string",
  })
  releaseStrategy!: ReleaseStrategy;

  @Option({ envAlias: "IGNORE_GIT_CHANGES" })
  ignoreGitChanges!: boolean;

  @Option({ describe: "Remove all undefined files from S3" })
  purge!: boolean;

  @Option({ describe: "Replace all files even if not changed" })
  force!: boolean;

  @Option({ envAlias: "VERBOSE", default: false })
  verbose!: boolean;

  @Option({ envAlias: "CI" })
  ci!: boolean;

  config!: Config;
}

export const command: yargs.CommandModule = {
  command: "invalidate",
  describe: "Invalidate CloudFront distribution for SPA app",
  builder: async (y) => {
    return y
      .options(getYargsOptions(SpaBuildOptions))
      .middleware(async (_argv) => {
        return (await loadYargsConfig(
          SpaBuildOptions,
          _argv as any,
          "spaDeploy"
        )) as any;
      }, true);
  },
  handler: async (_argv) => {
    const argv = (await _argv) as unknown as SpaBuildOptions;

    const { spaDeploy } = argv.config;

    const awsRegion = spaDeploy?.aws?.region;
    if (!awsRegion) {
      logError(`AWS Region is not set`);
      return process.exit(1);
    }
    logVariable("app__aws__region", awsRegion);

    // cloudfront plan
    const cloudfrontInvalidations = parseArray<string>(
      spaDeploy?.cloudfront?.invalidatePaths
    );

    const cloudfrontId = parseArray<string>(
      spaDeploy?.cloudfront?.distributionId
    );

    if (cloudfrontInvalidations.length < 1) {
      logInfo("No validations set. Invalidate everything");
      cloudfrontInvalidations.push("/*");
    }

    logBanner(`CloudFront invalidations`);

    for (const i of cloudfrontInvalidations) {
      logInfo(i);
    }

    // deploy
    logBanner(`Deploy`);
    if (cloudfrontId.length < 1 && cloudfrontInvalidations.length > 0) {
      logWarning("No cloudfront set - will not invalidate cache!");
      return;
    }

    if (!argv.ci) {
      if (!(await confirm("Press enter to deploy..."))) {
        logInfo("Canceled");
        return;
      }
    }

    if (cloudfrontInvalidations.length > 0 && cloudfrontId.length > 0) {
      await executeCloudfrontInvalidation(
        cloudfrontInvalidations,
        cloudfrontId,
        awsRegion
      );
    }

    logInfo("Done!");
  },
};

export function parseArray<T>(input: any): T[] {
  if (input === undefined || input === null) {
    return [];
  }
  if (Array.isArray(input)) {
    return input;
  }
  return [input];
}
