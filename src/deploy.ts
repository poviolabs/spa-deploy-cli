/**
 * PovioLabs SPA Deploy Script
 *
 * To add a env variable to production, add it as prefixed with
 *  `STAGE_[stage]_` to the build env.
 *
 * Is is generally not recommended to change this script,
 *  if there are issues or missing features, consort the
 *  maintainer at https://github.com/poviolabs/terraform-template
 *
 * @version 1.2
 */

import * as yargs from "yargs";
import * as path from "path";
import * as fs from "fs";
import * as fg from "fast-glob";
import { CloudFront, S3 } from "aws-sdk";
import { lookup } from "mime-types";
import Prompt from "prompt-sync";
import { resolveRef, statusMatrix } from "isomorphic-git";

import { parseDotEnv } from "./helpers";

const prompt = Prompt({ sigint: true });
const cwd = process.cwd();

const args = yargs
  .option("stage", {
    default: process.env.STAGE,
    type: "string",
  })
  .option("version", {
    type: "string",
  }).argv;

(async () => {
  /**
   * Set up env
   *  - the env names have the stage in them to allow for easy CI variable setting
   */

  const stage: string = (args as any).stage;
  if (!stage) {
    console.error("No STAGE set");
    process.exit(1);
  }

  console.info(`Stage: ${stage}`);
  console.info(`Workdir: ${cwd}`);

  const prodEnv: Record<string, any> = {};
  const deployEnv: Record<string, any> = {
    AWS_REGION: undefined,
    AWS_ACCESS_KEY_ID: undefined,
    AWS_SECRET_ACCESS_KEY: undefined,

    DEPLOY_BUCKET: undefined,
    DISTRIBUTION_ID: false, // not required

    BUILD_PATH: path.resolve("build"),
    INDEX_FILES: "index.html",
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
    console.warn(`[DANGER] .env.${stage}.secrets found in CI`);
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
      console.error(`Env ${key} not set`);
      process.exit(1);
    }
  }

  console.info(`Region: ${deployEnv.AWS_REGION}`);
  console.info(`Bucket: ${deployEnv.DEPLOY_BUCKET}`);
  console.info(`Build path: ${deployEnv.BUILD_PATH}`);

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
    } else if (fs.existsSync(".git")) {
      const ref = await resolveRef({ fs, dir: cwd, ref: "HEAD" });
      const sM = (await statusMatrix({ fs, dir: cwd, ref })).filter(
        (row) => row[2] !== row[3]
      );
      if (sM.length > 0) {
        RELEASE = `${RELEASE}-dev`;
        console.log(`WARNING: Uncommitted changes`);
        if (!process.env.IGNORE_GIT_CHANGES) {
          console.error(
            "Can not deploy if changed are in git (IGNORE_GIT_CHANGES not set)"
          );
          process.exit(1);
        }
      } else {
        RELEASE = ref;
      }
    }
  }

  // get version
  let VERSION = (args as any).version || process.env.VERSION || "";
  if (!VERSION) {
    if (process.env.CIRCLE_TAG) {
      VERSION = process.env.CIRCLE_TAG;
    } else if (process.env.BITBUCKET_TAG) {
      VERSION = process.env.BITBUCKET_TAG;
    } else {
      VERSION = "untagged";
      // todo, get tag from git
    }
  }

  prodEnv["APP_VERSION"] = VERSION;
  prodEnv["APP_RELEASE"] = RELEASE;

  const envData = Object.entries(prodEnv)
    .map(([k, v]) => {
      return `window.${k}='${v}'`;
    })
    .join(";");

  console.info(`Variables:`);

  console.log(
    Object.entries(prodEnv)
      .map(([key, value]) => {
        return `${key}=${value}`;
      })
      .join("\n")
  );

  if (!process.env.CI && !process.env.FORCE_DEPLOY) {
    const yes = prompt('Enter "yes" to deploy: ');
    if (yes !== "yes") {
      console.log("Stopping deploy");
      process.exit();
    }
  }

  for (const fileName of deployEnv.INDEX_FILES.split(",")) {
    const filePath = path.resolve(deployEnv.BUILD_PATH, fileName);

    fs.writeFileSync(
      filePath,
      fs
        .readFileSync(filePath, "utf8")
        .replace(
          /<script id="env-data">[^<]*<\/script>/,
          `<script id="env-data">${envData}</script>`
        ),
      "utf8"
    );
  }

  /**
   * All files are cache-busted by the build scripts,
   *  but not these. The deploy process will upload all other files,
   *  set their CACHE_CONTROL and if all went well, deploy these files
   *  last, then invalidate the cloudfront cache.
   */
  const importantFiles: string[] = [
    "asset-manifest.json",
    "favicon.ico",
    "manifest.json",
    "robots.txt",
    "service-worker.js",
    ...deployEnv.INDEX_FILES.split(","),
  ];

  const cachedFiles = fg.sync(`**`, {
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
  };
  const s3 = new S3({ ...awsOptions, apiVersion: "2006-03-01" });
  const cf = new CloudFront(awsOptions);

  /**
   * Sync cachedFiles files to s3
   */
  await Promise.all(
    cachedFiles.map(async (fileName) => {
      const filePath = path.resolve(deployEnv.BUILD_PATH, fileName);
      await s3
        .putObject({
          Bucket: deployEnv.DEPLOY_BUCKET,
          Key: fileName,
          Body: fs.readFileSync(filePath),
          ACL: "public-read",
          ContentDisposition: "inline",
          CacheControl: "max-age=2628000", // makes the browser cache this file
          ContentType: lookup(filePath) || "application/octet-stream",
        })
        .promise();
      console.info(`Uploaded s3://${deployEnv.DEPLOY_BUCKET}/${fileName}`);
    })
  );

  /**
   * Sync importantFiles files to s3
   */
  await Promise.all(
    importantFiles.map(async (fileName) => {
      const filePath = path.resolve(deployEnv.BUILD_PATH, fileName);
      if (fs.existsSync(filePath)) {
        await s3
          .putObject({
            Bucket: deployEnv.DEPLOY_BUCKET,
            Key: fileName,
            Body: fs.readFileSync(filePath),
            ACL: "public-read",
            ContentDisposition: "inline",
            // CacheControl: '',  by default, the browser will re-fetch and CF will give a 403 response
            ContentType: lookup(filePath) || "application/octet-stream",
          })
          .promise();
        console.info(`Uploaded s3://${deployEnv.DEPLOY_BUCKET}/${fileName}`);
      }
    })
  );

  if (deployEnv.DISTRIBUTION_ID) {
    /**
     * Invalidate cache for importantFiles
     */
    const response = await cf
      .createInvalidation({
        DistributionId: deployEnv.DISTRIBUTION_ID || "",
        InvalidationBatch: {
          CallerReference: new Date().toISOString(),
          Paths: {
            Quantity: importantFiles.length,
            Items: importantFiles.map((x) => `/${x}`),
          },
        },
      })
      .promise();
    console.info(
      `CloudFormation Invalidation: ${
        response?.Invalidation?.Status || "Unknown"
      }`
    );
  }
})();
