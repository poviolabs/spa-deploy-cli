import { test } from "node:test";
import { generateIni } from "./inject";
import assert from "assert";
import { resolveZeConfigItem } from "../helpers/ze-config";

const __dirname = new URL(".", import.meta.url).pathname;

process.env.APP_VERSION = "0.0.1";

test("inject env", async () => {
  const destination = "./.test-example.env";

  const data = await resolveZeConfigItem(
    {
      name: "test",
      destination,
      values: [
        {
          name: "@",
          config: {
            APP_RELEASE: "${func:release}",
            APP_STAGE: "${func:stage}",
            APP_VERSION: "${env:APP_VERSION}",
            STATIC_URL: "https://static.example.com",
            NEXT_PUBLIC_SENTRY_CDN: "https://public@sentry.example.com/1",
          },
        },
      ],
    },
    {
      awsRegion: "us-east-1",
      release: "xxxxxxxxx",
    },
    __dirname,
    "myapp-dev",
  );

  assert.equal(
    generateIni(data),
    `APP_RELEASE=xxxxxxxxx
APP_STAGE=myapp-dev
APP_VERSION=0.0.1
STATIC_URL=https://static.example.com
NEXT_PUBLIC_SENTRY_CDN=https://public@sentry.example.com/1`,
  );
});
