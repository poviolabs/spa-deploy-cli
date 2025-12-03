import { join } from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { Logger } from "../src/helpers/logger";
import { SyncAction } from "../src/lib/deploy.types";
import {
    getS3ClientInstance,
    purgeFromS3,
    scanS3Files,
    uploadToS3,
} from "../src/lib/s3";
import {
    TEST_BUCKET,
    cleanupS3Bucket,
    getTestAwsContext,
} from "./s3.helpers";

const __dirname = new URL(".", import.meta.url).pathname;
const testDir = join(__dirname, "app");

describe("s3.ts", () => {
    let s3Client: ReturnType<typeof getS3ClientInstance>;
    const logger = new Logger(false);

    const s3Prefix = `s3-test-${(new Date()).getTime()}/`;
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

    describe("uploadToS3", () => {
        test("should upload file to S3", async () => {
            const testFile = join(testDir, "index.html");

            const files = [
                {
                    key: "index.html",
                    localPath: testFile,
                    action: SyncAction.create,
                    contentType: "text/html",
                    priority: 0,
                },
            ];

            await uploadToS3(
                files,
                s3Config,
                logger
            );

            // Verify file was uploaded
            const response = await s3Client.send(
                new GetObjectCommand({
                    Bucket: TEST_BUCKET,
                    Key: `${s3Prefix}index.html`,
                })
            );

            const body = await response.Body?.transformToString();
            expect(body).toBeDefined();
            expect(body).toContain("<html>");
        });

        test("should upload file with prefix", async () => {
            const testFile = join(testDir, "global.css");

            const files = [
                {
                    key: "global.css",
                    localPath: testFile,
                    action: SyncAction.create,
                    contentType: "text/css",
                    priority: 0,
                },
            ];

            await uploadToS3(
                files,
                { ...s3Config, concurrency: 5 },
                logger
            );

            // Verify file was uploaded with prefix
            const response = await s3Client.send(
                new GetObjectCommand({
                    Bucket: TEST_BUCKET,
                    Key: `${s3Prefix}global.css`,
                })
            );

            const body = await response.Body?.transformToString();
            expect(body).toBeDefined();
            expect(body).toContain("body");
        });

        test("should upload file with metadata", async () => {
            const testFile = join(testDir, "index.html");

            const files = [
                {
                    key: "index.html",
                    localPath: testFile,
                    action: SyncAction.create,
                    contentType: "text/html",
                    cacheControl: "max-age=3600",
                    contentDisposition: "inline",
                    acl: "public-read",
                    priority: 0,
                },
            ];

            await uploadToS3(
                files,
                s3Config,
                logger
            );

            // Verify file was uploaded
            const { CacheControl, ContentDisposition } = await s3Client.send(
                new GetObjectCommand({
                    Bucket: TEST_BUCKET,
                    Key: `${s3Prefix}index.html`,
                })
            );

            expect(CacheControl).toBe("max-age=3600");
            expect(ContentDisposition).toBe("inline");
        });

        test("should skip files that are not create or update", async () => {
            const testFile = join(testDir, "index.html");

            const files = [
                {
                    key: "skip.html",
                    localPath: testFile,
                    action: SyncAction.unchanged,
                    contentType: "text/html",
                    priority: 0,
                },
            ];

            await uploadToS3(
                files,
                s3Config,
                logger
            );

            // Verify file was NOT uploaded
            try {
                await s3Client.send(
                    new GetObjectCommand({
                        Bucket: TEST_BUCKET,
                        Key: `${s3Prefix}skip.html`,
                    })
                );
                expect.fail("File should not exist");
            } catch (error: any) {
                expect(error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404).toBe(true);
            }
        });

        test("should handle empty files array", async () => {


            await uploadToS3(
                [],
                s3Config,
                logger
            );

            // Should not throw
            expect(true).toBe(true);
        });
    });

    describe("scanS3Files", () => {
        test("should scan S3 bucket and match with local files", async () => {
            // Upload a file first
            const testFile = join(testDir, "index.html");

            await uploadToS3(
                [
                    {
                        key: "index.html",
                        localPath: testFile,
                        action: SyncAction.create,
                        contentType: "text/html",
                        priority: 0,
                    },
                ],
                s3Config,
                logger
            );

            // Now scan
            const localFiles = new Map([
                [
                    "index.html",
                    {
                        key: "index.html",
                        localPath: testFile,
                        action: SyncAction.create,
                        priority: 0,
                    },
                ],
            ]);

            const scannedFiles = await scanS3Files(
                localFiles,
                [],
                { ...s3Config, purge: false },
                logger
            );

            const file = scannedFiles.get("index.html");
            expect(file).toBeDefined();
            expect(file!.remoteHash).toBeDefined();
            expect(file!.remoteSize).toBeDefined();
        });

        test("should mark remote-only files for deletion when purge is true", async () => {
            // Upload a file
            const testFile = join(testDir, "global.css");
            await uploadToS3(
                [
                    {
                        key: "remote-only.css",
                        localPath: testFile,
                        action: SyncAction.create,
                        contentType: "text/css",
                        priority: 0,
                    },
                ],
                s3Config,
                logger
            );

            // Scan without the file in local files
            const localFiles = new Map();
            const scannedFiles = await scanS3Files(
                localFiles,
                [],
                { ...s3Config, purge: true },
                logger
            );

            const file = scannedFiles.get("remote-only.css");
            expect(file).toBeDefined();
            expect(file!.action).toBe(SyncAction.delete);
        });

        test("should handle prefix correctly", async () => {
            const testFile = join(testDir, "index.html");

            await uploadToS3(
                [
                    {
                        key: "index.html",
                        localPath: testFile,
                        action: SyncAction.create,
                        contentType: "text/html",
                        priority: 0,
                    },
                ],
                s3Config,
                logger
            );

            const localFiles = new Map([
                [
                    "index.html",
                    {
                        key: "index.html",
                        localPath: testFile,
                        action: SyncAction.create,
                        priority: 0,
                    },
                ],
            ]);

            const scannedFiles = await scanS3Files(
                localFiles,
                [],
                { ...s3Config, purge: false },
                logger
            );

            const file = scannedFiles.get("index.html");
            expect(file).toBeDefined();
            expect(file!.remoteHash).toBeDefined();
        });
    });

    describe("purgeFromS3", () => {
        test("should delete files marked for deletion", async () => {
            const testFile = join(testDir, "index.html");

            // Upload file first
            await uploadToS3(
                [
                    {
                        key: "to-delete.html",
                        localPath: testFile,
                        action: SyncAction.create,
                        contentType: "text/html",
                        priority: 0,
                    },
                ],
                s3Config,
                logger
            );

            // Verify it exists
            const before = await s3Client.send(
                new GetObjectCommand({
                    Bucket: TEST_BUCKET,
                    Key: `${s3Prefix}to-delete.html`,
                })
            );
            expect(before).toBeDefined();

            // Delete it
            await purgeFromS3(
                [
                    {
                        key: "to-delete.html",
                        action: SyncAction.delete,
                        priority: 0,
                    },
                ],
                s3Config,
                logger
            );

            // Verify it's gone
            try {
                await s3Client.send(
                    new GetObjectCommand({
                        Bucket: TEST_BUCKET,
                        Key: "to-delete.html",
                    })
                );
                expect.fail("File should be deleted");
            } catch (error: any) {
                expect(error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404).toBe(true);
            }
        });

        test("should skip files not marked for deletion", async () => {
            const context = getTestAwsContext();
            const testFile = join(testDir, "global.css");

            // Upload file
            await uploadToS3(
                [
                    {
                        key: "keep-me.css",
                        localPath: testFile,
                        action: SyncAction.create,
                        contentType: "text/css",
                        priority: 0,
                    },
                ],
                { bucket: TEST_BUCKET, prefix: "", context, concurrency: 5 },
                logger
            );

            // Try to purge with wrong action
            await purgeFromS3(
                [
                    {
                        key: "keep-me.css",
                        action: SyncAction.unchanged,
                        priority: 0,
                    },
                ],
                { bucket: TEST_BUCKET, prefix: "", context, concurrency: 5 },
                logger
            );

            // Verify it still exists
            const response = await s3Client.send(
                new GetObjectCommand({
                    Bucket: TEST_BUCKET,
                    Key: "keep-me.css",
                })
            );
            expect(response).toBeDefined();
        });

        test("should handle prefix in purge", async () => {
            const context = getTestAwsContext();
            const testFile = join(testDir, "index.html");

            // Upload with prefix
            await uploadToS3(
                [
                    {
                        key: "index.html",
                        localPath: testFile,
                        action: SyncAction.create,
                        contentType: "text/html",
                        priority: 0,
                    },
                ],
                { bucket: TEST_BUCKET, prefix: "app/", context, concurrency: 5 },
                logger
            );

            // Delete with prefix
            await purgeFromS3(
                [
                    {
                        key: "index.html",
                        action: SyncAction.delete,
                        priority: 0,
                    },
                ],
                { bucket: TEST_BUCKET, prefix: "app/", context, concurrency: 5 },
                logger
            );

            // Verify it's gone
            try {
                await s3Client.send(
                    new GetObjectCommand({
                        Bucket: TEST_BUCKET,
                        Key: "app/index.html",
                    })
                );
                expect.fail("File should be deleted");
            } catch (error: any) {
                expect(error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404).toBe(true);
            }
        });
    });
});
