import { beforeAll, describe, test, expect } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "fs";
import path from "path";

import { injectCommandHandler } from "../src/commands/inject.command";
import { Logger } from "../src/helpers/logger";

const __dirname = new URL(".", import.meta.url).pathname;

process.env.APP_VERSION = "0.0.1";

const tmpPath = path.join(__dirname, "..", ".tmp", 'inject');

describe("inject command", () => {
  beforeAll(() => {
    rmSync(tmpPath, { recursive: true, force: true });
    mkdirSync(tmpPath, { recursive: true });
  });
  test("inject into html", async () => {

    process.env.APP_RELEASE = "xxxxxxxxx";

    await injectCommandHandler(
      {
        verbose: true,
        cwd: __dirname,
        stage: "inject",
        module: "spa",
      },
      new Logger(true)
    );

    const output = readFileSync(path.join(tmpPath, "index.html"), "utf-8");
    const match = output.match(/<script id="env-data">window\.__ENV__ = ([^<]*)<\/script>/);
    expect(match).toBeTruthy();
    const data = JSON.parse(match![1]);

    expect(data).toEqual({
      APP_RELEASE: "xxxxxxxxx",
      APP_STAGE: "inject",
      APP_VERSION: "0.0.1",
      STATIC_URL: "https://static.example.com",
      NEXT_PUBLIC_SENTRY_CDN: "https://public@sentry.example.com/1",
    });

  });

});

