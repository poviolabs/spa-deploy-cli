/**
 * PovioLabs SPA Deploy Script
 *
 * To add a env variable to production, add it as prefixed with
 *  `STAGE_[stage]_` to the build env.
 *
 * @version 1.2
 */

import * as path from "path";
import * as fs from "fs";
import { sync as fgSync } from "fast-glob";
import { CloudFront, S3 } from "aws-sdk";
import { lookup } from "mime-types";
import Prompt from "prompt-sync";
import { resolveRef, statusMatrix } from "isomorphic-git";

import { fileHash, parseDotEnv } from "./helpers";

const cwd = process.cwd();

(async () => {
  /**
   * Set up env
   *  - the env names have the stage in them to allow for easy CI variable setting
   */

  const stage: string = process.env.STAGE;
  if (!stage) {
    console.error("FATAL\t No STAGE set");
    process.exit(1);
  }

  console.info(`INFO\t STAGE: ${stage}`);
  console.info(`INFO\t CWD: ${cwd}`);

  const prodEnv: Record<string, any> = {};
  const deployEnv: Record<string, any> = {
    AWS_REGION: undefined,
    AWS_ACCESS_KEY_ID: undefined,
    AWS_SECRET_ACCESS_KEY: undefined,
    AWS_ENDPOINT: false, // only for testing

    DEPLOY_BUCKET: undefined,
    DISTRIBUTION_ID: false, // not required

    BUILD_PATH: path.resolve("build"),
    DEPLOY_PATH: false,
    INDEX_FILES: "index.html", // "false" to disable
    // files to invalidate, defaults to common React files
    INVALIDATE_FILES:
      "asset-manifest.json,favicon.ico,manifest.json,robots.txt,service-worker.js",
    // extra paths to invalidate, they do not need to exist
    INVALIDATE_PATHS: false,

    // if old files stored on S3 should be removed
    // this is generally to be avoided
    PURGE: false,
    // ignore these prefixes while purging
    IGNORE_PATHS: false,

    VERBOSE: false,
  };

  const origEnv = parseDotEnv(
    [path.join(cwd, `.env.${stage}`), path.join(cwd, `.env.${stage}.secrets`)],
    stage
  );

  if (
    process.env.CI &&
    fs.existsSync(path.join(cwd, `.env.${stage}.secrets`))
  ) {
    // this should file not be committed to git
    console.warn(`DANGER\t .env.${stage}.secrets found in CI`);
  }

  for (const [key, value] of Object.entries(origEnv)) {
    if (key in deployEnv) {
      // take keys defined in deployEnv
      deployEnv[key] = value;
    } else if (key.startsWith("APP_")) {
      // take keys starting with APP_
      prodEnv[key] = value;
    }
  }

  for (const [key, value] of Object.entries(deployEnv)) {
    if (value === undefined) {
      console.error(`FATAL\t Environment variable ${key} is required`);
      process.exit(1);
    }
    if (value === "false") {
      deployEnv[key] = false;
    }
  }

  console.info(`INFO\t AWS_REGION: ${deployEnv.AWS_REGION}`);
  console.info(`INFO\t DEPLOY_BUCKET: ${deployEnv.DEPLOY_BUCKET}`);
  console.info(`INFO\t BUILD_PATH: ${deployEnv.BUILD_PATH}`);
  if (deployEnv.DEPLOY_PATH) {
    console.info(`INFO\t DEPLOY_PATH: ${deployEnv.DEPLOY_PATH}`);
  }

  /**
   * Patch index.html with release/version
   */

  // get git sha
  let RELEASE = process.env.RELEASE;
  if (!RELEASE) {
    if (process.env.CIRCLE_SHA1) {
      RELEASE = process.env.CIRCLE_SHA1;
    } else if (process.env.BITBUCKET_COMMIT) {
      RELEASE = process.env.BITBUCKET_COMMIT;
    } else {
      try {
        const ref = await resolveRef({ fs, dir: cwd, ref: "HEAD" });
        const sM = (await statusMatrix({ fs, dir: cwd, ref })).filter(
          (row) => row[2] !== row[3]
        );
        if (sM.length > 0) {
          RELEASE = `${ref}-dev`;
          if (!process.env.IGNORE_GIT_CHANGES) {
            console.error(
              "ERROR\t Can not deploy if changed are in git (IGNORE_GIT_CHANGES not set)"
            );
            process.exit(1);
          } else {
            console.log(`WARNING\t Uncommitted changes`);
          }
        } else {
          RELEASE = ref;
        }
      } catch (e) {
        console.log(`WARNING\t ${e.toString()}`);
        RELEASE = "undefined";
      }
    }
  }

  // get version
  let VERSION = process.env.VERSION || "";
  if (!VERSION) {
    if (process.env.CIRCLE_TAG) {
      VERSION = process.env.CIRCLE_TAG;
    } else if (process.env.BITBUCKET_TAG) {
      VERSION = process.env.BITBUCKET_TAG;
    } else {
      VERSION = RELEASE;
      // todo, get tag from git
    }
  }

  prodEnv["APP_STAGE"] = stage;
  prodEnv["APP_VERSION"] = VERSION;
  prodEnv["APP_RELEASE"] = RELEASE;

  const envData = Object.entries(prodEnv)
    .map(([k, v]) => {
      return `window.${k}='${v}'`;
    })
    .join(";");

  console.log(
    Object.entries(prodEnv)
      .map(([key, value]) => {
        return `INFO\t ${key}: ${value}`;
      })
      .join("\n")
  );

  if (deployEnv.INDEX_FILES !== false && deployEnv.INDEX_FILES !== "") {
    for (const fileName of deployEnv.INDEX_FILES.split(",")) {
      const filePath = path.resolve(deployEnv.BUILD_PATH, fileName);

      const fileContents = fs.readFileSync(filePath, "utf8");

      if (!fileContents.includes('<script id="env-data">')) {
        console.log(`WARNING\t ${fileName} does not contain env-data`);
      } else {
        console.log(`INFO\t Writing env-data into ${fileName}`);
        fs.writeFileSync(
          filePath,
          fileContents.replace(
            /<script id="env-data">[^<]*<\/script>/,
            `<script id="env-data">${envData}</script>`
          ),
          "utf8"
        );
      }
    }
  }

  if (process.env.CI || process.env.FORCE_DEPLOY) {
    console.log("INFO\t Deploying...");
  } else {
    const prompt = Prompt({ sigint: true });
    const yes = prompt('\nEnter "yes" to deploy: ');
    if (yes !== "yes") {
      console.log("FATAL\tStopping deploy");
      process.exit();
    }
  }

  /**
   * All files are cache-busted by the build scripts,
   *  but not these. The deploy process will upload all other files,
   *  set their CACHE_CONTROL and if all went well, deploy these files
   *  last, then invalidate the cloudfront cache.
   */
  const importantFiles: string[] = [];

  if (deployEnv.INVALIDATE_FILES) {
    for (const maybeGlob of deployEnv.INVALIDATE_FILES.split(",")) {
      if (maybeGlob.includes("*")) {
        fgSync(maybeGlob, {
          ignore: importantFiles, // do not duplicate
          cwd: deployEnv.BUILD_PATH,
        }).forEach((x) => {
          importantFiles.push(x);
        });
      } else {
        if (fs.existsSync(path.resolve(deployEnv.BUILD_PATH, maybeGlob))) {
          importantFiles.push(maybeGlob);
        }
      }
    }
  }

  if (deployEnv.INDEX_FILES !== false && deployEnv.INDEX_FILES !== "") {
    deployEnv.INDEX_FILES.split(",")
      .filter((x) => fs.existsSync(path.resolve(deployEnv.BUILD_PATH, x)))
      .forEach((x) => importantFiles.push(x));
  }

  const cachedFiles = fgSync(`**`, {
    ignore: importantFiles,
    cwd: deployEnv.BUILD_PATH,
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
      `${a.padEnd(8, " ")} ${b.padEnd(10, " ")} ${c.padEnd(10, " ")} ${d.padEnd(
        32,
        " "
      )} s3://${deployEnv.DEPLOY_BUCKET}/${fileName}`
    );
  }

  /**
   * Sync cachedFiles files to s3
   */
  await Promise.all(
    cachedFiles.map(async (fileName) => {
      const remoteFileName = `${deployEnv.DEPLOY_PATH || ""}${fileName}`;
      const filePath = path.resolve(deployEnv.BUILD_PATH, fileName);
      const fileMeta = (filesMeta[remoteFileName] = {
        remote: filesMeta[remoteFileName]?.remote,
        local: await fileHash(filePath),
      });
      if (fileMeta.remote) {
        if (fileMeta.remote === fileMeta.local) {
          printStatus("INFO", "SKIP", "CACHED", fileMeta.local, remoteFileName);
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
        printStatus("INFO", "UPLOAD", "CACHED", fileMeta.local, remoteFileName);
      }
      await s3
        .putObject({
          Bucket: deployEnv.DEPLOY_BUCKET,
          Key: remoteFileName,
          Body: fs.readFileSync(filePath),
          ACL: "public-read",
          ContentDisposition: "inline",
          CacheControl: "max-age=2628000, public", // makes the browser cache this file
          ContentType: lookup(filePath) || "application/octet-stream",
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
      const filePath = path.resolve(deployEnv.BUILD_PATH, fileName);
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
          ACL: "public-read",
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
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
