import { join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { Logger } from "../src/helpers/logger";
import { executeDeploy } from "../src/lib/deploy";
import { SyncAction } from "../src/lib/deploy.types";
import { getS3ClientInstance, uploadFileToS3 } from "../src/lib/s3";
import { getState } from "../src/lib/state";
import {
    TEST_BUCKET,
    cleanupS3Bucket,
    getTestAwsContext,
} from "./s3.helpers";

const testDir = join(__dirname, "app");

describe("deploy.ts - executeDeploy", () => {
    const logger = new Logger(true);
    let s3Client: S3Client;


    const s3Prefix = `deploy-test-${(new Date()).getTime()}/`;
    const s3Config = {
        bucket: TEST_BUCKET,
        context: getTestAwsContext(),
        prefix: s3Prefix
    };

    beforeAll(async () => {
        s3Client = getS3ClientInstance(getTestAwsContext());
    });

    afterEach(async () => {
        await cleanupS3Bucket(s3Client, TEST_BUCKET);
    });

    test("should execute full deployment pipeline with metadata and options", async () => {

        // Test basic deployment with metadata (cache control, invalidate)
        const result1 = await executeDeploy(
            {
                prefix: testDir,
                files: [
                    {
                        includeGlob: ["**/*.html"],
                        cacheControl: "no-cache",
                        invalidate: true,
                    },
                    {
                        includeGlob: ["**/*.css"],
                        cacheControl: "max-age=3600",
                    },
                ],
                s3: {
                    ...s3Config,
                },
            },
            {
                apply: true
            },
            logger
        );

        expect(result1).toEqual(
            expect.objectContaining({
                result: "success",
                invalidationIds: [],
                files: expect.any(Map),
            })
        );
        const fileKeys = Array.from(result1.files.keys());
        expect(fileKeys).toEqual(expect.arrayContaining(["index.html", "global.css"]));
        expect(result1.files.size).toBeGreaterThanOrEqual(2);

        // Test priority-based upload
        const result2 = await executeDeploy(
            {
                prefix: testDir,
                files: [
                    {
                        includeGlob: ["**/*.html"],
                        priority: 1,
                    },
                    {
                        includeGlob: ["**/*.css"],
                        priority: 2,
                    },
                ],
                s3: s3Config,
            },
            {
                apply: true
            },
            logger
        );

        expect(result2.result).toBe("success");
        const priorities = ["index.html", "global.css"].map(key => result2.files.get(key)?.priority);
        expect(priorities).toEqual([1, 2]);

        // Test S3 prefix
        const result3 = await executeDeploy(
            {
                prefix: testDir,
                files: [
                    {
                        includeGlob: ["**/*.html"],
                    },
                ],
                s3: {
                    ...s3Config,
                    prefix: "app/",
                },
            },
            {
                apply: true
            },
            logger
        );

        expect(result3.result).toBe("success");
        expect(result3.files.has("index.html")).toBe(true);
    });

    test("should handle force flag and update actions", async () => {
        const result = await executeDeploy(
            {
                prefix: testDir,
                files: [
                    {
                        includeGlob: ["**/*.html"],
                    },
                ],
                s3: s3Config,
            },
            {
                apply: true,
                force: true
            },
            logger
        );

        expect(result).toMatchObject({
            result: "success",
        });
        expect(result.files.get("index.html")).toMatchObject({
            action: SyncAction.update,
        });
    });

    test("should not apply changes when apply is false", async () => {
        const result = await executeDeploy(
            {
                prefix: testDir,
                files: [
                    {
                        includeGlob: ["**/*.html"],
                    },
                ],
                s3: s3Config,
            },
            {},
            logger
        );
        expect(result).toMatchObject({
            result: "no-changes",
            files: expect.any(Map),
        });
    });

    test("should handle global purge flags", async () => {

        const dummyKey = `dummy-${(new Date()).getTime()}.html`;

        // upload dummy file
        await uploadFileToS3({
            key: dummyKey,
            localPath: join(testDir, "index.html"),
            action: SyncAction.create,
            contentType: "text/html",
            priority: 0,
        }, s3Client, { bucket: s3Config.bucket, prefix: s3Prefix }, logger);

        const deployResult = await executeDeploy(
            {
                prefix: testDir,
                files: [
                    {
                        includeGlob: ["**/*.css"],
                    },
                ],
                s3: s3Config,
            },
            {
                scan: true,
                apply: true,
                purge: true,
            },
            logger
        );

        expect(deployResult.result).toBe("success");
        expect(deployResult.files.get(dummyKey)!.action).toBe(SyncAction.delete);
    });

    test("should handle source-level purge flags", async () => {
        const dummyKey = `dummy-${(new Date()).getTime()}.html`;

        // upload dummy file
        await uploadFileToS3({
            key: dummyKey,
            localPath: join(testDir, "index.html"),
            action: SyncAction.create,
            contentType: "text/html",
            priority: 0,
        }, s3Client, { bucket: s3Config.bucket, prefix: s3Prefix }, logger);

        const deployResult = await executeDeploy(
            {
                prefix: testDir,
                files: [
                    {
                        includeGlob: ["**/*.css"],
                        purge: true,
                    },
                ],
                s3: s3Config,
            },
            {
                scan: true,
                apply: true,
            },
            logger
        );

        // should be unknown, only css files should be purged
        expect(deployResult.files.get(dummyKey)!.action).toBe(SyncAction.unknown);


        const deployResult2 = await executeDeploy(
            {
                prefix: testDir,
                files: [
                    {
                        includeGlob: ["**/*.html"],
                        purge: true,
                    },
                ],
                s3: s3Config,
            },
            {
                scan: true,
                apply: true,
            },
            logger
        );

        // should be deleted, html files should be purged
        expect(deployResult2.files.get(dummyKey)!.action).toBe(SyncAction.delete);
    });

    test("should handle state file", async () => {

        let stateFile = "files.json";
        const deploy = async () => executeDeploy(
            {
                prefix: testDir,
                files: [
                    {
                        includeGlob: ["**/*.html"],
                        cacheControl: "no-cache",
                        skipUnchanged: true,
                    },
                ],
                s3: {
                    ...s3Config,
                    stateFile,
                },
            },
            {
                apply: true,
            },
            logger
        );

        const deployResult = await deploy();

        // file should be created
        expect(deployResult.result).toBe("success");
        const deployedIndexHtml = deployResult.files.get("index.html")!;
        expect(deployedIndexHtml).toMatchObject({
            action: SyncAction.create,
            key: "index.html",
            cacheControl: "no-cache",
            contentType: "text/html",
            contentDisposition: 'inline',
            acl: undefined,
            updatedAt: expect.any(String),
        });

        const state1 = await getState(stateFile, s3Client, { bucket: s3Config.bucket, prefix: s3Prefix }, logger);

        expect(state1.size).toBe(1);
        expect(state1.get("index.html")).toMatchObject({
            key: "index.html",
            cacheControl: deployedIndexHtml.cacheControl,
            contentType: deployedIndexHtml.contentType,
            contentDisposition: deployedIndexHtml.contentDisposition,
            acl: deployedIndexHtml.acl,
            updatedAt: deployedIndexHtml.updatedAt,
        });

        // file should be unchanged but the updatedAt should be new
        const deployResult2 = await deploy();

        expect(deployResult2.result).toBe("success");
        expect(deployResult2.files.get("index.html")).toMatchObject({
            action: SyncAction.unchanged,
            key: "index.html",
            cacheControl: "no-cache",
            contentType: "text/html",
            contentDisposition: 'inline',
            acl: undefined,
            updatedAt: expect.any(String),
        });

        const deployedIndexHtml2 = deployResult2.files.get("index.html")!;

        const state2 = await getState(stateFile, s3Client, { bucket: s3Config.bucket, prefix: s3Prefix }, logger);

        expect(state2.size).toBe(1);
        expect(state2.get("index.html")).toMatchObject({
            key: "index.html",
            cacheControl: deployedIndexHtml.cacheControl,
            contentType: deployedIndexHtml.contentType,
            contentDisposition: deployedIndexHtml.contentDisposition,
            acl: deployedIndexHtml.acl,
            // updatedAt should be new
            updatedAt: deployedIndexHtml2.updatedAt,
        });
    });
});