import { test } from "node:test";
import { inject } from "../src/commands/inject";
import fs from "fs";
import path from "path";
import assert from "assert";

const __dirname = new URL(".", import.meta.url).pathname;

process.env.APP_VERSION = "0.0.1";

test.skip("inject from config", async () => {
  await inject({
    verbose: true,
    pwd: new URL(".", import.meta.url).pathname,
    stage: "myapp-dev",
    release: "xxxxxxxxx",
  });

  const output = fs.readFileSync(
    path.join(__dirname, ".test-example.env"),
    "utf-8",
  );
  fs.unlinkSync(path.join(__dirname, ".test-example.env"));
  assert.equal(
    output,
    `APP_RELEASE=xxxxxxxxx
APP_STAGE=nextjs
APP_VERSION=0.0.1
STATIC_URL=https://static.example.com
NEXT_PUBLIC_SENTRY_CDN=https://public@sentry.example.com/1`,
  );
});

test.skip("inject from html", async () => {
  await inject({
    verbose: true,
    pwd: new URL(".", import.meta.url).pathname,
    stage: "myapp-stg",
    release: "xxxxxxxxx",
  });
  fs.unlinkSync(path.join(__dirname, "test-example.html"));
});
