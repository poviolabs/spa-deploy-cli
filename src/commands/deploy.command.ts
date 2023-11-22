/*
  Deploy files to S3 and Invalidate CloudFront
 */

import yargs from "yargs";
import path from "path";
import fs from "fs";
import micromatch from "micromatch";
import { createHash } from "crypto";

import {
  executeS3SyncPlan,
  prepareS3SyncPlan,
  printS3SyncPlan,
} from "../helpers/aws-s3.helper";
import {
  executeCloudfrontInvalidation,
  prepareCloudfrontInvalidation,
} from "../helpers/aws-cloudfront.helper";
import { SyncAction } from "../helpers/sync.helper";
import { getVersion } from "../helpers/version.helper";
import {
  logBanner,
  logError,
  logInfo,
  logVariable,
  logWarning,
} from "../helpers/cli.helper";
import { getBuilder, YargOption, YargsOptions } from "../helpers/yargs.helper";
import { getGitChanges, getGitVersion } from "../helpers/git.helper";
import { BaseConfig } from "../helpers/ze-config.js";
import { z } from "zod";
import { safeLoadConfig } from "../helpers/config.helper";

export const DeployConfig = BaseConfig.extend({
  taskFamily: z.string(),
  serviceName: z.string(),
  clusterName: z.string(),
  build: z.array(
    z.object({
      name: z.string(),
      repoName: z.string(),
      context: z.string().optional(),
      dockerfile: z.string().optional(),
      platform: z.string().default("linux/amd64"),
      environment: z.record(z.string()).optional(),
    }),
  ),
});

class SpaBuildOptions implements YargsOptions {
  @YargOption({ envAlias: "PWD", demandOption: true })
  pwd!: string;

  @YargOption({ envAlias: "STAGE", demandOption: true })
  stage!: string;

  @YargOption({
    envAlias: "RELEASE",
    demandOption: true,
  })
  release!: string;

  @YargOption({ envAlias: "CI" })
  ci!: boolean;

  @YargOption({ envAlias: "VERSION", type: "string" })
  appVersion!: string;

  @YargOption({ envAlias: "IGNORE_GIT_CHANGES" })
  ignoreGitChanges!: boolean;

  @YargOption({ describe: "Remove all undefined files from S3" })
  purge!: boolean;

  @YargOption({ describe: "Replace all files even if not changed" })
  force!: boolean;

  @YargOption({ envAlias: "VERBOSE", default: false })
  verbose!: boolean;
}

export const command: yargs.CommandModule = {
  command: "deploy",
  describe: "Deploy an SPA app and purge CloudFront cache",
  builder: getBuilder(SpaBuildOptions),
  handler: async (_argv) => {
    const argv = (await _argv) as unknown as SpaBuildOptions;

    logBanner(`SpaDeploy ${getVersion()}`);
    logInfo(`NodeJS Version: ${process.version}`);

    if (!argv.ci) {
      // check for git changes
      if (fs.existsSync(path.join(argv.pwd, ".git"))) {
        logVariable("Git Bin Version", await getGitVersion(argv.pwd));
        const gitChanges = await getGitChanges(argv.pwd);
        if (gitChanges !== "") {
          if (argv.ignoreGitChanges) {
            logWarning("Changes detected in .git");
          } else {
            if (gitChanges === undefined) {
              logError("Error detecting Git");
            } else {
              logBanner(
                "Detected Changes in Git - Stage must be clean to build!",
              );
              console.log(gitChanges);
            }
            process.exit(1);
          }
        }
      }
    } else {
      logInfo("Running Non-Interactively");
    }

    logBanner("Build Environment");
    logVariable("pwd", argv.pwd);
    logVariable("release", argv.release);
    logVariable("stage", argv.stage);

    const config = await safeLoadConfig(
      "spa-deploy",
      argv.pwd,
      argv.stage,
      DeployConfig,
    );

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
      s3Options,
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
            injectedData,
          );
        } else if (data.match("</head>")) {
          logWarning(
            `Could not find <script id="env-data"> in ${item.key}. Injecting at end of HEAD.`,
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
    printS3SyncPlan(plan, true, !!argv.verbose);

    // cloudfront plan
    const cloudfrontInvalidations = prepareCloudfrontInvalidation(
      plan,
      parseArray<string>(spaDeploy?.cloudfront?.invalidatePaths),
    );

    const cloudfrontId = parseArray<string>(
      spaDeploy?.cloudfront?.distributionId,
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
          x.action!,
        ),
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
        awsRegion,
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
