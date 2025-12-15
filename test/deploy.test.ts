import { join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { Logger } from "../src/helpers/logger";
import { executeDeploy } from "../src/lib/deploy";
import { SyncAction } from "../src/lib/deploy.types";
import { getS3ClientInstance, uploadFileToS3 } from "../src/lib/s3";
import { getState, saveState } from "../src/lib/state";
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
        expect(deployResult.files.get(dummyKey)!.action).toBe(SyncAction.defunct);

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

    test("should keep versions based on keepDays and keepVersions", async () => {
        const stateFile = "files.json";
        const DAY_MS = 24 * 60 * 60 * 1000;

        // Create a state with files from different versions
        const insertHistory = async (days: number[]) => {
            const initialState = new Map<string, any>();
            for (const day of days) {
                const updatedAt = new Date(Date.now() - day * DAY_MS).toISOString();
                initialState.set(`file${day}.html`, {
                    key: `file${day}.html`,
                    remoteHash: 'random-hash',
                    remoteSize: 100,
                    updatedAt,
                    action: SyncAction.unchanged,
                });
            }
            await saveState(initialState, s3Client, {
                bucket: s3Config.bucket,
                prefix: s3Prefix,
                stateFile,
            }, logger);
        }

        await insertHistory([1, 4, 5, 6]);

        const createDeployConfig = (override: { purge?: { keepDays?: number; keepVersions?: number }, stateFile?: string | boolean }) => ({
            prefix: testDir,
            files: [{ includeGlob: ["**/*.html"], skipUnchanged: true }],
            s3: {
                ...s3Config,
                stateFile,
                ...override
            },
        });

        // Test 1: purge with keepDays: 2
        // Should keep files from 1 and 4 days ago (within 2 days, or at least one if none within)
        const deployResult1 = await executeDeploy(
            createDeployConfig({ purge: { keepDays: 2, keepVersions: 0 } }),
            { apply: false },
            logger
        );

        // Files from 1 and 4 days ago should be kept
        const keptInTest1 = ["file1.html", "file4.html"];
        for (const fileName of keptInTest1) {
            expect(deployResult1.files.get(fileName)?.action).not.toBe(SyncAction.delete);
        }
        // Files from 5 and 6 days ago should be deleted
        const deletedInTest1 = ["file5.html", "file6.html"];
        for (const fileName of deletedInTest1) {
            expect(deployResult1.files.get(fileName)?.action).toBe(SyncAction.delete);
        }

        // Test 2: purge with keepVersions: 3
        // Should keep files from 1, 4, and 5 days ago (3 most recent versions)
        await insertHistory([1, 4, 5, 6]);
        const deployResult2 = await executeDeploy(
            createDeployConfig({ purge: { keepVersions: 3, keepDays: 0 } }),
            { apply: false },
            logger
        );

        // Files from 1, 4, and 5 days ago should be kept (3 most recent versions)
        const keptInTest2 = ["file1.html", "file2.html", "file5.html"];
        for (const fileName of keptInTest2) {
            expect(deployResult2.files.get(fileName)?.action).not.toBe(SyncAction.delete);
        }
        // Files from 6 days ago should be deleted
        const deletedInTest2 = ["file6.html"];
        for (const fileName of deletedInTest2) {
            expect(deployResult2.files.get(fileName)?.action).toBe(SyncAction.delete);
        }

        // Test 3: purge with scan
        await insertHistory([1, 4, 5, 6]);
        const deployResult3 = await executeDeploy(
            createDeployConfig({ purge: { keepDays: 0, keepVersions: 0 } }),
            { apply: false, scan: true },
            logger
        );

        // All files should be gone
        expect(deployResult3.files.size).toBe(1);
        expect(deployResult3.files.get("index.html")?.action).toBe(SyncAction.create);

        // Test 4: override purge with scan
        await insertHistory([1, 4, 5, 6]);
        const deployResult4 = await executeDeploy(
            createDeployConfig({ purge: { keepDays: 5, keepVersions: 5 } }),
            { apply: false, scan: true, purge: true },
            logger
        );

        // All files should be gone
        expect(deployResult4.files.size).toBe(1);
        expect(deployResult4.files.get("index.html")?.action).toBe(SyncAction.create);

        // Test 5: keepDays and keepVersions should error out when state file is not present
        expect(
            async () => executeDeploy(
                createDeployConfig({ purge: { keepDays: 5, keepVersions: 5 }, stateFile: false }),
                { apply: false, scan: true },
                logger
            )
        ).rejects.toThrow("State file is required when using purge.keepDays or purge.keepVersions");

    });

    test("should migrate to state file", async () => {
        const stateFile = "files.json";
        const prefix = `${s3Prefix}/migration-test`;
        const existingFile1 = "existing-file-1.html";
        const existingFile2 = "existing-file-2.css";
        const s3Options = { bucket: s3Config.bucket, prefix };

        // Upload existing files to S3 in parallel
        await Promise.all([
            uploadFileToS3({
                key: existingFile1,
                localPath: join(testDir, "index.html"),
                action: SyncAction.create,
                contentType: "text/html",
                priority: 0,
            }, s3Client, s3Options, logger),
            uploadFileToS3({
                key: existingFile2,
                localPath: join(testDir, "global.css"),
                action: SyncAction.create,
                contentType: "text/css",
                priority: 0,
            }, s3Client, s3Options, logger),
        ]);

        const deployConfig: Parameters<typeof executeDeploy> = [
            {
                prefix: testDir,
                files: [
                    {
                        includeGlob: ["**/*.html"],
                        cacheControl: "no-cache",
                        skipUnchanged: true,
                    },
                    {
                        includeGlob: ["**/*.css"],
                        cacheControl: "max-age=3600",
                        skipUnchanged: true,
                        purge: { keepDays: 1, keepVersions: 1 },
                    },
                ],
                s3: {
                    ...s3Config,
                    prefix,
                    stateFile,
                },
            },
            {
                apply: true,
            },
            logger
        ];

        // Test 1: Migrate with state enabled but no state file exists (empty state)
        const migrateResult = await executeDeploy(
            ...deployConfig,
        );

        expect(migrateResult.result).toBe("success");
        expect(migrateResult.files.get(existingFile1)?.action).toEqual(SyncAction.defunct);
        expect(migrateResult.files.get(existingFile2)?.action).toEqual(SyncAction.defunct);
        expect(migrateResult.files.get(existingFile1)?.action).toEqual(SyncAction.defunct);
        expect(migrateResult.files.get(existingFile2)?.action).toEqual(SyncAction.defunct);

        const postMigrateState = await getState(stateFile, s3Client, { bucket: s3Config.bucket, prefix }, logger);
        expect(postMigrateState.size).toBe(4);
        expect(Array.from(postMigrateState.keys())).toEqual(expect.arrayContaining([existingFile1, existingFile2, "index.html", "global.css"]));

        // Test 2: Rerun should not change files, state should still contain all files, timestamps should be bew
        const nochangeResult = await executeDeploy(
            ...deployConfig,
        );

        expect(nochangeResult.result).toBe("success");
        expect(nochangeResult.files.get("index.html")).toEqual(expect.objectContaining({
            action: SyncAction.unchanged,
            updatedAt: expect.any(String),
        }));
        expect(nochangeResult.files.get("global.css")).toEqual(expect.objectContaining({
            action: SyncAction.unchanged,
            updatedAt: expect.any(String),
        }));
        expect(nochangeResult.files.get(existingFile1)).toEqual(expect.objectContaining({
            action: SyncAction.unknown, // file not local, we dont know if its still on s3
            updatedAt: expect.any(String),
        }));
        expect(nochangeResult.files.get(existingFile2)).toEqual(expect.objectContaining({
            action: SyncAction.unknown,
            updatedAt: expect.any(String),
        }));

        const postNochangeState = await getState(stateFile, s3Client, { bucket: s3Config.bucket, prefix }, logger);
        expect(postNochangeState.size).toBe(4);
        expect(Array.from(postNochangeState.keys())).toEqual(expect.arrayContaining([existingFile1, existingFile2, "index.html", "global.css"]));

        // Test 3: Force upload should update the file
        const forceUploadResult = await executeDeploy(
            deployConfig[0],
            { apply: true, force: true },
        );

        expect(forceUploadResult.result).toBe("success");
        expect(forceUploadResult.files.get("index.html")).toEqual(expect.objectContaining({
            action: SyncAction.update,
            updatedAt: expect.any(String),
        }));
        expect(forceUploadResult.files.get("global.css")).toEqual(expect.objectContaining({
            action: SyncAction.update,
            updatedAt: expect.any(String),
        }));
        expect(forceUploadResult.files.get(existingFile1)).toEqual(expect.objectContaining({
            action: SyncAction.unknown,
            updatedAt: expect.any(String),
        }));
        expect(forceUploadResult.files.get(existingFile2)).toEqual(expect.objectContaining({
            action: SyncAction.unknown,
            updatedAt: expect.any(String),
        }));

        const postForceUploadState = await getState(stateFile, s3Client, { bucket: s3Config.bucket, prefix }, logger);
        expect(postForceUploadState.size).toBe(4);
        expect(Array.from(postForceUploadState.keys())).toEqual(expect.arrayContaining([existingFile1, existingFile2, "index.html", "global.css"]));

        // Test 4: Purge should delete the files
        const purgeResult = await executeDeploy(
            deployConfig[0],
            { apply: true, purge: true },
        );

        expect(purgeResult.result).toBe("success");
        expect(purgeResult.files.get("index.html")?.action).toEqual(SyncAction.unchanged);
        expect(purgeResult.files.get("global.css")?.action).toEqual(SyncAction.unchanged);
        expect(purgeResult.files.get(existingFile1)?.action).toEqual(SyncAction.delete);
        expect(purgeResult.files.get(existingFile2)?.action).toEqual(SyncAction.delete);

        const postPurgeState = await getState(stateFile, s3Client, { bucket: s3Config.bucket, prefix }, logger);
        expect(postPurgeState.size).toBe(2);
        expect(Array.from(postPurgeState.keys())).toEqual(expect.arrayContaining(["index.html", "global.css"]));
    });
});