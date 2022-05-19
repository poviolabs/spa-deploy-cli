/*
  Deploy files to S3
 */

import yargs from "yargs";
import path from "path";
import fs from "fs";
import micromatch from "micromatch";

import cli, { banner, info, variable, warning } from "~cli.helper";
import { getGitChanges, getGitVersion, getRelease } from "~git.helper";
import {
  Option,
  getYargsOptions,
  loadYargsConfig,
  Config,
  YargsOptions,
} from "~yargs.helper";
import process from "process";
import {
  executeCloudfrontInvalidation,
  executeS3SyncPlan,
  prepareCloudfrontInvalidation,
  prepareS3SyncPlan,
  printS3SyncPlan,
} from "~aws.helpers";

const { version: spaDeployVersion } = require("../package.json");

class SpaBuildOptions extends YargsOptions {
  @Option({ envAlias: "PWD", demandOption: true })
  pwd: string;

  @Option({ envAlias: "STAGE", demandOption: true })
  stage: string;

  @Option({
    envAlias: "RELEASE",
    envAliases: ["CIRCLE_SHA1", "BITBUCKET_COMMIT", "GITHUB_SHA"],
    demandOption: true,
  })
  release: string;

  @Option({
    envAlias: "APP_VERSION",
    envAliases: ["CIRCLE_TAG", "BITBUCKET_TAG"],
    type: "string",
    alias: "ecsVersion",
  })
  appVersion: string;

  @Option({
    default: "gitsha",
    choices: ["gitsha", "gitsha-stage"],
    type: "string",
  })
  releaseStrategy: "gitsha" | "gitsha-stage";

  @Option({ envAlias: "IGNORE_GIT_CHANGES" })
  ignoreGitChanges: boolean;

  @Option({ describe: "Remove all undefined files from S3" })
  purge: boolean;

  @Option({ describe: "Replace all files even if not changed" })
  force: boolean;

  @Option({ envAlias: "VERBOSE", default: false })
  verbose: boolean;

  @Option({ envAlias: "CI" })
  ci: boolean;

  config: Config;
}

export const command: yargs.CommandModule = {
  command: "deploy",
  describe: "Deploy a SPA app",
  builder: async (y) => {
    return y
      .options(getYargsOptions(SpaBuildOptions))
      .middleware(async (_argv) => {
        const argv = loadYargsConfig(
          SpaBuildOptions,
          _argv as any,
          "spaDeploy"
        );
        argv.release =
          argv.release || (await getRelease(argv.pwd, argv.releaseStrategy));

        return argv as any;
      }, true);
  },
  handler: async (_argv) => {
    const argv = (await _argv) as unknown as SpaBuildOptions;

    banner(`SPA Build ${spaDeployVersion}`);

    const pwd = argv.pwd;
    variable("PWD", pwd);
    variable("NODE_VERSION", process.version);

    variable("GIT_CLI_VERSION", await getGitVersion(pwd));

    const stage = argv.stage;
    if (stage) {
      // get current STAGE if set
      // CI would not use this for builds
      variable("STAGE", argv.stage);
    }

    if (!argv.ci) {
      cli.info("Running Interactively");
    }

    const verbose = !!argv.verbose;

    const gitChanges = await getGitChanges(pwd);
    if (gitChanges !== "") {
      if (argv.ignoreGitChanges) {
        cli.warning("Changes detected in .git");
      } else {
        if (gitChanges === undefined) {
          cli.error("Error detecting Git");
        } else {
          cli.banner("Detected Changes in Git - Stage must be clean to build!");
          console.log(gitChanges);
        }
        return process.exit(1);
      }
    }

    cli.banner("Build Environment");

    const { spaDeploy, spaEnv, spaIndexGlob } = argv.config;

    const buildPath = path.join(pwd, spaDeploy?.buildPath || "dist");
    cli.variable("app__buildPath", buildPath);
    if (!fs.lstatSync(buildPath).isDirectory()) {
      cli.error(`Build path ${buildPath} is not a directory.`);
      return process.exit(1);
    }

    const release = argv.release;

    cli.banner("App Environment");

    let version = argv.appVersion;
    if (!version) {
      version = `${stage}-${release}`;
    } else if (/^[\d.]+$/.exec(version)) {
      // if just the semver is passed in, prefix it!
      version = `${stage}-${version}`;
    }

    const prodEnv: Record<string, string> = {
      ...(spaEnv ? spaEnv : {}),
      APP_STAGE: stage,
      APP_VERSION: version,
      APP_RELEASE: release,
    };

    for (const [k, v] of Object.entries(prodEnv)) {
      cli.variable(k, v);
    }

    cli.banner("Deploy Environment");

    const awsRegion = spaDeploy?.aws?.region;
    if (!awsRegion) {
      cli.error(`AWS Region is not set`);
      return process.exit(1);
    }
    cli.variable("app__aws__region", awsRegion);

    if (spaDeploy?.aws?.endpoint) {
      cli.variable("app__aws__endpoint", spaDeploy?.aws?.endpoint);
    }

    const deployBucket = spaDeploy?.s3?.bucket;
    if (!deployBucket) {
      cli.error(`S3 Deploy Bucket is not set`);
      return process.exit(1);
    } else {
      cli.variable("app__s3__bucket", spaDeploy?.s3?.bucket);
    }

    if (spaDeploy?.s3?.prefix) {
      cli.variable("app__s3__prefix", spaDeploy?.s3?.prefix);
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
      const injectedData = `<script id="env-data">\n${Object.entries(prodEnv)
        .map(([k, v]) => {
          return `window.${k}='${v}'`;
        })
        .join(";\n")}\n</script>`;

      if (verbose) {
        banner(`S3 Index Injection`);
        console.log(injectedData);
      }

      for (const item of indexFiles) {
        item.transformers = [
          ...(item.transformers || []),
          (fileContents) => {
            return fileContents.replace(
              /<script id="env-data">[^<]*<\/script>/,
              injectedData.replace("\n", "")
            );
          },
        ];
      }
    }

    // s3 sync plan
    banner(`S3 Sync Plan`);
    printS3SyncPlan(plan, true, verbose);

    // cloudfront plan
    const cloudfrontInvalidations = prepareCloudfrontInvalidation(
      plan,
      parseArray<string>(spaDeploy?.cloudfront?.invalidatePaths)
    );

    const cloudfrontId = parseArray<string>(spaDeploy?.cloudfrontId);
    if (cloudfrontInvalidations.length > 0) {
      banner(`Cloudfront invalidations`);

      for (const i of cloudfrontInvalidations) {
        console.log(i);
      }
    }

    // deploy
    banner(`Deploy`);
    if (cloudfrontId.length < 1 && cloudfrontInvalidations.length > 0) {
      warning("No cloudfront set - will not invalidate cache!");
    }

    if (!argv.ci) {
      if (!(await cli.confirm("Press enter to deploy S3..."))) {
        cli.info("Canceled");
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

    info("Done!");
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
