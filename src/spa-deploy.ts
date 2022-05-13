/*
 Build the Docker image and deploy it to ECR
  - Skip building if the release (git version) already exists
 */

import yargs from "yargs";
import path from "path";
import { sync as fgSync } from "fast-glob";

import cli, { banner, variable, warning, info } from "~cli.helper";
import { getGitChanges, getGitVersion, getRelease } from "~git.helper";
import {
  Option,
  getYargsOptions,
  loadYargsConfig,
  Config,
  YargsOptions,
} from "~yargs.helper";
import process from "process";
import fs from "fs";
import { fileHash } from "~helpers";

const { version: spaDeployVersion } = require("../package.json");

class SpaBuildOptions extends YargsOptions {
  @Option({ envAlias: "PWD", demandOption: true })
  pwd: string;

  @Option({ envAlias: "STAGE" })
  stage: string;

  @Option({ envAlias: "RELEASE", demandOption: true })
  release: string;

  @Option({
    envAlias: "RELEASE_STRATEGY",
    default: "gitsha",
    choices: ["gitsha", "gitsha-stage"],
    type: "string",
  })
  releaseStrategy: "gitsha" | "gitsha-stage";

  @Option({ envAlias: "APP_VERSION", demandOption: true })
  appVersion: string;

  @Option({ envAlias: "AWS_REGION", demandOption: true })
  awsRegion: string;

  @Option({ envAlias: "AWS_ACCOUNT_ID", demandOption: true })
  awsAccountId: string;

  @Option({ envAlias: "AWS_ENDPOINT", demandOption: true })
  awsEndpoint: string;

  @Option({ envAlias: "IGNORE_GIT_CHANGES" })
  ignoreGitChanges: boolean;

  @Option({ envAlias: "CI" })
  ci: boolean;

  @Option({ envAlias: "DEPLOY_BUCKET", demandOption: true })
  deployBucket: string;

  @Option({ envAlias: "DISTRIBUTION_ID" })
  distributionId: string;

  @Option({ envAlias: "BUILD_PATH", demandOption: true })
  buildPath: string;

  @Option({ envAlias: "DEPLOY_PATH" })
  deployPath: string;

  @Option({ envAlias: "INDEX_FILES", default: "index.html" })
  indexFiles: string;

  @Option({
    envAlias: "INVALIDATE_FILES",
    default:
      "asset-manifest.json,favicon.ico,manifest.json,robots.txt,service-worker.js",
  })
  invalidateFiles: string;

  @Option({ envAlias: "INVALIDATE_PATHS" })
  invalidatePaths: string;

  @Option({ envAlias: "IGNORE_PATHS" })
  ignorePaths: string;

  @Option({ envAlias: "ACL_HEADER" })
  aclHeader: string;

  @Option({ envAlias: "VERBOSE", default: false })
  verbose: boolean;

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
          "spa_deploy"
        );
        argv.release =
          argv.release || (await getRelease(argv.pwd, argv.releaseStrategy));

        return argv as any;
      }, true);
  },
  handler: async (_argv) => {
    const argv = (await _argv) as unknown as SpaBuildOptions;

    banner(`SPA Build ${spaDeployVersion}`);

    variable("PWD", argv.pwd);
    variable("NODE_VERSION", process.version);

    variable("GIT_CLI_VERSION", await getGitVersion(argv.pwd));

    if (argv.stage) {
      // get current STAGE if set
      // CI would not use this for builds
      variable("STAGE", argv.stage);
    }

    if (!argv.ci) {
      cli.info("Running Interactively");
    }

    const gitChanges = await getGitChanges(argv.pwd);
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
        process.exit(1);
      }
    }

    cli.banner("Build Environment");

    cli.variable("BUILD_PATH", argv.buildPath);
    cli.variable("RELEASE", argv.release);
    const buildPath = path.join(argv.pwd, argv.buildPath);
    cli.info(`Build path: ${buildPath}`);

    cli.banner("App Environment");

    const prodEnv: Record<string, string> = {
      ...(argv.config.spa_env ? argv.config.spa_env : {}),
      APP_STAGE: argv.stage,
      APP_VERSION: argv.appVersion,
      APP_RELEASE: argv.release,
    };

    for (const [k, v] of Object.entries(prodEnv)) {
      cli.variable(k, v);
    }

    if (argv.indexFiles) {
      cli.banner("Setting App Environment");

      for (const fileName of argv.indexFiles.split(",")) {
        const filePath = path.resolve(buildPath, fileName);

        const fileContents = fs.readFileSync(filePath, "utf8");

        if (!fileContents.includes('<script id="env-data">')) {
          warning(`${fileName} does not contain env-data`);
        } else {
          info(`Writing env-data into ${fileName}`);
          fs.writeFileSync(
            filePath,
            fileContents.replace(
              /<script id="env-data">[^<]*<\/script>/,
              `<script id="env-data">${Object.entries(prodEnv)
                .map(([k, v]) => {
                  return `window.${k}='${v}'`;
                })
                .join(";")}</script>`
            ),
            "utf8"
          );
        }
      }
    }

    cli.banner("Deploy Environment");
    cli.variable("AWS_REGION", argv.awsRegion);
    cli.variable("DEPLOY_BUCKET", argv.deployBucket);
    if (argv.deployPath) {
      cli.variable("DEPLOY_PATH", argv.deployPath);
    }
    if (argv.distributionId) {
      cli.variable("DISTRIBUTION_ID", argv.distributionId);
    }

    const defaultFileHeaders = {
      ACL: "public-read",
    };

    if (argv.aclHeader === "none") {
      delete defaultFileHeaders.ACL;
    } else if (typeof argv.aclHeader === "string") {
      defaultFileHeaders.ACL = argv.aclHeader;
    }

    if (!argv.ci) {
      if (!(await cli.confirm("Press enter to deploy..."))) {
        cli.info("Canceled");
        return;
      }
    }

    /**
     * All files are cache-busted by the build scripts,
     *  but not these. The deploy process will upload all other files,
     *  set their CACHE_CONTROL and if all went well, deploy these files
     *  last, then invalidate the cloudfront cache.
     */
    const importantFiles: string[] = [];

    if (argv.invalidateFiles) {
      for (const maybeGlob of argv.invalidateFiles.split(",")) {
        if (maybeGlob.includes("*")) {
          fgSync(maybeGlob, {
            ignore: importantFiles, // do not duplicate
            cwd: buildPath,
          }).forEach((x) => {
            importantFiles.push(x);
          });
        } else {
          if (fs.existsSync(path.resolve(buildPath, maybeGlob))) {
            importantFiles.push(maybeGlob);
          }
        }
      }
    }

    if (argv.indexFiles) {
      argv.indexFiles
        .split(",")
        .filter((x) => fs.existsSync(path.resolve(buildPath, x)))
        .forEach((x) => importantFiles.push(x));
    }

    const cachedFiles = fgSync(`**`, {
      ignore: importantFiles,
      cwd: buildPath,
    });

    /**
     * Set up AWS Client
     */
    const awsOptions = {
      credentials: {
        accessKeyId: deployEnv.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: deployEnv.AWS_SECRET_ACCESS_KEY || "",
      },
      region: deployEnv.AWS_REGION || "",
      endpoint: deployEnv.AWS_ENDPOINT ? deployEnv.AWS_ENDPOINT : undefined,
      s3ForcePathStyle: deployEnv.AWS_ENDPOINT ? true : undefined,
      signatureVersion: deployEnv.AWS_ENDPOINT ? "v3" : undefined,
    };

    const s3 = new S3({ ...awsOptions, apiVersion: "2006-03-01" });
    const cf = new CloudFront(awsOptions);

    /**
     * Make a list of existing files
     *  - todo only works up to 1000
     */
    const filesMeta: Record<string, { remote?: string; local?: string }> = {};

    if (deployEnv.PURGE) {
      const ignoredPaths = (deployEnv.IGNORE_PATHS || "")?.split(",") || [];
      // fetch remote files to purge
      (
        await s3
          .listObjects({
            Bucket: deployEnv.DEPLOY_BUCKET,
            Prefix: deployEnv.DEPLOY_PATH || undefined,
          })
          .promise()
      ).Contents.forEach(({ ETag, Key }) => {
        if (
          deployEnv.IGNORE_PATHS &&
          ignoredPaths.some((x) => Key.startsWith(x))
        ) {
          return;
        }
        filesMeta[Key] = { remote: ETag };
        if (deployEnv.VERBOSE) {
          printStatus("DEBUG", "FOUND", "", ETag, Key);
        }
      });
    }

    function printStatus(
      a: string,
      b: string,
      c: string,
      d: string,
      fileName: string
    ) {
      console.info(
        `${a.padEnd(8, " ")} ${b.padEnd(10, " ")} ${c.padEnd(
          10,
          " "
        )} ${d.padEnd(32, " ")} s3://${deployEnv.DEPLOY_BUCKET}/${fileName}`
      );
    }

    /**
     * Sync cachedFiles files to s3
     */
    await Promise.all(
      cachedFiles.map(async (fileName) => {
        const remoteFileName = `${deployEnv.DEPLOY_PATH || ""}${fileName}`;
        const filePath = path.resolve(buildPath, fileName);
        const fileMeta = (filesMeta[remoteFileName] = {
          remote: filesMeta[remoteFileName]?.remote,
          local: await fileHash(filePath),
        });
        if (fileMeta.remote) {
          if (fileMeta.remote === fileMeta.local) {
            printStatus(
              "INFO",
              "SKIP",
              "CACHED",
              fileMeta.local,
              remoteFileName
            );
            return Promise.resolve();
          } else {
            // this is a warning since this file is cached
            printStatus(
              "WARNING",
              "REPLACE",
              "CACHED",
              fileMeta.local,
              remoteFileName
            );
          }
        } else {
          printStatus(
            "INFO",
            "UPLOAD",
            "CACHED",
            fileMeta.local,
            remoteFileName
          );
        }
        await s3
          .putObject({
            Bucket: deployEnv.DEPLOY_BUCKET,
            Key: remoteFileName,
            Body: fs.readFileSync(filePath),
            ContentDisposition: "inline",
            CacheControl: "max-age=2628000, public", // makes the browser cache this file
            ContentType: lookup(filePath) || "application/octet-stream",
            ...defaultFileHeaders,
          })
          .promise();
      })
    );

    /**
     * Sync importantFiles files to s3
     */
    await Promise.all(
      importantFiles.map(async (fileName) => {
        const remoteFileName = `${deployEnv.DEPLOY_PATH || ""}${fileName}`;
        const filePath = path.resolve(buildPath, fileName);
        const fileMeta = (filesMeta[remoteFileName] = {
          remote: filesMeta[remoteFileName]?.remote,
          local: await fileHash(filePath),
        });
        if (fileMeta.remote) {
          if (fileMeta.remote === fileMeta.local) {
            printStatus(
              "INFO",
              "SKIP",
              "UNCACHED",
              fileMeta.local,
              remoteFileName
            );
            return Promise.resolve();
          } else {
            printStatus(
              "INFO",
              "REPLACE",
              "UNCACHED",
              fileMeta.local,
              remoteFileName
            );
          }
        } else {
          printStatus(
            "INFO",
            "UPLOAD",
            "UNCACHED",
            fileMeta.local,
            remoteFileName
          );
        }
        await s3
          .putObject({
            Bucket: deployEnv.DEPLOY_BUCKET,
            Key: remoteFileName,
            Body: fs.readFileSync(filePath),
            ContentDisposition: "inline",
            CacheControl: "public, must-revalidate", // force the browser and proxy to revalidate
            ContentType: lookup(filePath) || "application/octet-stream",
          })
          .promise();
      })
    );

    if (deployEnv.PURGE) {
      /**
       * Remove all files that were not found locally
       */
      for (const [fileName, fileMeta] of Object.entries(filesMeta).filter(
        ([, value]) => !value.local
      )) {
        printStatus("INFO", "REMOVE", "", fileMeta.remote, fileName);
        await s3
          .deleteObject({
            Bucket: deployEnv.DEPLOY_BUCKET,
            Key: fileName,
          })
          .promise();
      }
    }

    if (deployEnv.DISTRIBUTION_ID) {
      /**
       * Invalidate cache for importantFiles
       */

      const items = [
        ...importantFiles.map((x) => `/${x}`),
        ...(deployEnv.INVALIDATE_PATHS
          ? deployEnv.INVALIDATE_PATHS.split(",")
          : []),
      ];

      for (const line of items) {
        console.info(`INFO\t Invalidating ${line}`);
      }

      const distributions = deployEnv.DISTRIBUTION_ID.split(",");
      let isOk = true;
      for (const DistributionId of distributions) {
        try {
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
          console.info(
            `INFO\t CloudFormation Invalidation ${DistributionId}: ${
              response?.Invalidation?.Status || "Unknown"
            }`
          );
        } catch (e) {
          console.info(`ERROR\t CloudFormation Invalidation ${DistributionId}`);
          console.error(e);
          isOk = false;
        }
      }
      if (!isOk) {
        throw new Error("Error invalidating CloudFront Distributions");
      }
    } else {
      console.info(`INFO\t CloudFormation Invalidation SKIPPED`);
    }
  },
};
