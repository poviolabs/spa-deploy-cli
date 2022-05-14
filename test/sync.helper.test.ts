import path from "node:path";

import { scanLocal } from "../src/sync.helper";
import {
  executeS3SyncPlan,
  prepareS3SyncPlan,
  printS3SyncPlan,
} from "../src/aws.helpers";

process.env.AWS_ACCESS_KEY_ID = "foobar";
process.env.AWS_SECRET_ACCESS_KEY = "foobar";

describe("config", () => {
  const appRoot = path.join(__dirname, "./app");

  const config = {
    region: "eu-west-1",
    bucket: "deploy-bucket",
    endpoint: "http://localhost:9090",
    //purge: true,
    //force: true,
    invalidate_glob: ["index.html"],
  };

  test("it should scan local files", async () => {
    const files = [];
    for await (const file of scanLocal({ path: appRoot })) {
      files.push(file.key);
    }
    expect(files).toContain("index.html");
  });

  test("it should scan s3 files", async () => {
    const plan = await prepareS3SyncPlan({ path: appRoot }, config);

    printS3SyncPlan(plan);

    //await executeS3SyncPlan(plan, config);
  });
});
