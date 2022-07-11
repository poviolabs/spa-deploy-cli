/*
  Deploy files to S3
 */

import yargs from "yargs";
import path from "path";
import fs from "fs";
import micromatch from "micromatch";
import { createHash } from "crypto";
import process from "process";

import { ReleaseStrategy, Config } from "node-stage";
import {
  logWarning,
  logError,
  logInfo,
  logVariable,
  logBanner,
  getToolEnvironment,
  confirm,
} from "node-stage/cli";
import { getGitChanges } from "node-stage/git";
import {
  Option,
  getYargsOptions,
  loadYargsConfig,
  YargsOptions,
} from "node-stage/yargs";
import {
  loadColors
} from "node-stage/chalk";

import {
  executeCloudfrontInvalidation,
  executeS3SyncPlan,
  prepareCloudfrontInvalidation,
  prepareS3SyncPlan,
  printS3SyncPlan,
} from "../helpers/aws.helpers";
import { SyncAction } from "../helpers/sync.helper";

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
  command: "deploy",
  describe: "Deploy a SPA app",
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

    await loadColors();

    logBanner(`SPA Build ${getVersion()}`);

    const pwd = argv.pwd;

    for (const [k, v] of Object.entries(await getToolEnvironment(argv))) {
      logVariable(k, v);
    }

    const stage = argv.stage;
    if (stage) {
      // get current STAGE if set
      // CI would not use this for builds
      logVariable("STAGE", argv.stage);
    }

    if (!argv.ci) {
      logInfo("Running Interactively");
    }

    const verbose = !!argv.verbose;

    const gitChanges = await getGitChanges(pwd);
    if (gitChanges !== "") {
      if (argv.ignoreGitChanges) {
        logWarning("Changes detected in .git");
      } else {
        if (gitChanges === undefined) {
          logError("Error detecting Git");
        } else {
          logBanner("Detected Changes in Git - Stage must be clean to build!");
          console.log(gitChanges);
        }
        process.exit(1);
      }
    }

    logBanner("Build Environment");

    const { spaDeploy, spaGlobals, spaIndexGlob } = argv.config;

    const buildPath = path.join(pwd, spaDeploy?.buildPath || "dist");
    logVariable("app__buildPath", buildPath);
    if (!fs.lstatSync(buildPath).isDirectory()) {
      logError(`Build path ${buildPath} is not a directory.`);
      return process.exit(1);
    }

    const release = argv.release;

    logBanner("App Environment");

    let version = argv.appVersion;
    if (!version) {
      version = `${stage}-${release}`;
    } else if (/^[\d.]+$/.exec(version)) {
      // if just the semver is passed in, prefix it!
      version = `${stage}-${version}`;
    }

    const prodEnv: Record<string, string> = {
      ...(spaGlobals ? spaGlobals : {}),
      APP_STAGE: stage,
      APP_VERSION: version,
      APP_RELEASE: release,
    };

    for (const [k, v] of Object.entries(prodEnv)) {
      logVariable(k, v);
    }

    logBanner("Deploy Environment");

    const awsRegion = spaDeploy?.aws?.region;
    if (!awsRegion) {
      logError(`AWS Region is not set`);
      return process.exit(1);
    }
    logVariable("app__aws__region", awsRegion);

    if (spaDeploy?.aws?.endpoint) {
      logVariable("app__aws__endpoint", spaDeploy?.aws?.endpoint);
    }

    const deployBucket = spaDeploy?.s3?.bucket;
    if (!deployBucket) {
      logError(`S3 Deploy Bucket is not set`);
      return process.exit(1);
    } else {
      logVariable("app__s3__bucket", spaDeploy?.s3?.bucket);
    }

    if (spaDeploy?.s3?.prefix) {
      logVariable("app__s3__prefix", spaDeploy?.s3?.prefix);
    }

    const s3Options = {
      region: awsRegion,
      bucket: deployBucket,
      endpoint: spaDeploy?.aws?.endpoint,
      prefix: spaDeploy?.s3?.prefix,
      force: argv.force,
      purge: argv.purge,
      invalidateGlob: spaDeploy?.s3?.invalidateGlob,
      acl: spaDeploy?.s3?.acl,
    };

    // s3 sync plan
    const plan = await prepareS3SyncPlan(
      {
        path: buildPath,
        includeGlob: spaDeploy?.includeGlob,
        ignoreGlob: spaDeploy?.ignoreGlob,
      },
      s3Options
    );

    // inject globals into index files
    const indexFiles = spaIndexGlob
      ? plan.items.filter((x) => micromatch.isMatch(x.key, spaIndexGlob))
      : [];
    if (indexFiles.length > 0) {
      const injectedData = `<script id="env-data">${Object.entries(prodEnv)
        .map(([k, v]) => {
          return `window.${k}='${v}'`;
        })
        .join(";")}</script>`;

      for (const item of indexFiles) {
        item.cache = false;
        item.cacheControl = "public, must-revalidate";
        const data = fs.readFileSync(item.local!.path, "utf-8");

        if (data.match('<script id="env-data">')) {
          item.data = data.replace(
            /<script id="env-data">[^<]*<\/script>/,
            injectedData
          );
        } else if (data.match("</head>")) {
          logWarning(
            `Could not find <script id="env-data"> in ${item.key}. Injecting at end of HEAD.`
          );
          item.data = data.replace(/<\/head>/, injectedData + `</head>`);
        } else {
          logWarning(`Could not find injection point in ${item.key}`);
          continue;
        }
        item.dataHash = createHash("md5").update(item.data).digest("hex");
        if (
          !argv.force &&
          item.action === SyncAction.update &&
          item.remote?.eTag
        ) {
          if (item.remote?.eTag === item.dataHash) {
            item.action = SyncAction.unchanged;
            item.invalidate = false;
          }
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

    // sort deploy
    plan.items.sort((a, b) => {
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

    // s3 sync plan
    logBanner(`S3 Sync Plan`);
    printS3SyncPlan(plan, true, verbose);

    // cloudfront plan
    const cloudfrontInvalidations = prepareCloudfrontInvalidation(
      plan,
      parseArray<string>(spaDeploy?.cloudfront?.invalidatePaths)
    );

    const cloudfrontId = parseArray<string>(
      spaDeploy?.cloudfront?.distributionId
    );
    if (cloudfrontInvalidations.length > 0) {
      logBanner(`Cloudfront invalidations`);

      for (const i of cloudfrontInvalidations) {
        console.log(i);
      }
    }

    // deploy
    logBanner(`Deploy`);
    if (cloudfrontId.length < 1 && cloudfrontInvalidations.length > 0) {
      logWarning("No cloudfront set - will not invalidate cache!");
    }

    if (
      !plan.items.some((x) =>
        [SyncAction.create, SyncAction.update, SyncAction.delete].includes(
          x.action!
        )
      )
    ) {
      logInfo("Nothing to do!");
      return;
    }

    if (!argv.ci) {
      if (!(await confirm("Press enter to deploy..."))) {
        logInfo("Canceled");
        return;
      }
    }

    // execute file sync
    await executeS3SyncPlan(plan);

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
