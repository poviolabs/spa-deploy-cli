import { join } from "node:path";
import picomatch from "picomatch";
import { describe, expect, test } from "vitest";

import { Logger } from "../src/helpers/logger";
import { SyncAction } from "../src/lib/deploy.types";
import { scanLocalFiles } from "../src/lib/local";

const __dirname = new URL(".", import.meta.url).pathname;
const testDir = join(__dirname, "app");

describe("local.ts - scanLocalFiles", () => {
    const logger = new Logger(false);

    test("should scan files and set correct properties with glob patterns", async () => {
        const sourceDir = testDir;

        // Test single glob pattern
        const singleGlobFiles = await scanLocalFiles(
            new Map(),
            [
                {
                    includeGlob: [picomatch("**/*.html")],
                    skipUnchanged: true,
                },
            ],
            { prefix: sourceDir },
            logger
        );

        expect(singleGlobFiles.get("index.html")).toMatchObject({
            key: "index.html",
            action: SyncAction.create,
            priority: 0,
            localPath: expect.any(String),
            localSize: expect.any(Number),
            contentType: expect.any(String),
            localHash: expect.any(String),
        });

        // Test multiple glob patterns in separate configs
        const multiConfigFiles = await scanLocalFiles(
            new Map(),
            [
                {
                    includeGlob: [picomatch("**/*.html")],
                },
                {
                    includeGlob: [picomatch("**/*.css")],
                },
            ],
            { prefix: sourceDir },
            logger
        );

        expect(multiConfigFiles.size).toEqual(2);
        expect(multiConfigFiles.has("index.html")).toBe(true);
        expect(multiConfigFiles.has("global.css")).toBe(true);

        // Test multiple glob patterns in single config
        const singleConfigFiles = await scanLocalFiles(
            new Map(),
            [
                {
                    includeGlob: [picomatch("**/*.html"), picomatch("**/*.css")],
                },
            ],
            { prefix: sourceDir },
            logger
        );

        expect(singleConfigFiles.size).toEqual(2);
        expect(singleConfigFiles.has("index.html")).toBe(true);
        expect(singleConfigFiles.has("global.css")).toBe(true);
    });

    test("should scan files in dot-directories when explicitly included", async () => {
        const files = await scanLocalFiles(
            new Map(),
            [
                {
                    includeGlob: [picomatch(".well-known/apple-app-site-association")],
                    contentType: "application/json",
                },
                {
                    includeGlob: [picomatch(".well-known/assetlinks.json")],
                    contentType: "application/json",
                },
            ],
            { prefix: testDir },
            logger,
        );

        expect(Array.from(files.keys()).sort()).toEqual([
            ".well-known/apple-app-site-association",
            ".well-known/assetlinks.json",
        ]);
        expect(files.get(".well-known/apple-app-site-association")).toMatchObject({
            contentType: "application/json",
        });
        expect(files.get(".well-known/assetlinks.json")).toMatchObject({
            contentType: "application/json",
        });
    });

    test("should handle force flags and compute hash for update actions", async () => {
        const sourceDir = testDir;

        // Test global force flag
        const globalForceFiles = await scanLocalFiles(
            new Map(),
            [
                {
                    includeGlob: [picomatch("**/*.html")],
                },
            ],
            { prefix: sourceDir },
            logger
        );

        const globalForceFile = globalForceFiles.get("index.html");
        expect(globalForceFile).toBeDefined();
        expect(globalForceFile!.action).toBe(SyncAction.update);

        // Test source-level force flag
        const sourceForceFiles = await scanLocalFiles(
            new Map(),
            [
                {
                    includeGlob: [picomatch("**/*.css")],
                    skipUnchanged: false,
                },
            ],
            { prefix: sourceDir },
            logger
        );

        expect(sourceForceFiles.get("global.css")).toMatchObject({
            action: SyncAction.update,
        });
    });

    test("should handle metadata flags and priority", async () => {
        const sourceDir = testDir;

        // Test cache control and content disposition
        const metadataFiles = await scanLocalFiles(
            new Map(),
            [
                {
                    includeGlob: [picomatch("**/*.html")],
                    cacheControl: "max-age=3600",
                    contentDisposition: "attachment",
                    invalidate: true,
                    priority: 10,
                },
                {
                    includeGlob: [picomatch("**/*.css")],
                    priority: 20,
                },
            ],
            { prefix: sourceDir },
            logger
        );

        expect(metadataFiles.get("index.html")).toMatchObject({
            cacheControl: "max-age=3600",
            contentDisposition: "attachment",
            invalidate: true,
            priority: 10,
        });
        expect(metadataFiles.get("global.css")).toMatchObject({ priority: 20 });
    });

    test("should handle empty glob pattern", async () => {
        const sourceDir = testDir;

        const files = await scanLocalFiles(
            new Map(),
            [
                {
                    includeGlob: [picomatch("**/*.nonexistent")],
                },
            ],
            { prefix: sourceDir },
            logger
        );

        expect(files.size).toBe(0);
    });
});
