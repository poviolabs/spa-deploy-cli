import {
    CloudFrontClient,
    type CreateInvalidationCommand,
    type CreateInvalidationCommandOutput,
} from "@aws-sdk/client-cloudfront";
import { describe, expect, test } from "vitest";

import { Logger } from "../src/helpers/logger";
import type { AwsContext } from "../src/lib/aws";
import { invalidateCloudFront } from "../src/lib/cloudfront";
import type { DeployFile } from "../src/lib/deploy.types";
import { SyncAction } from "../src/lib/deploy.types";

// Mock CloudFront client
class MockCloudFrontClient extends CloudFrontClient {
    private mockInvalidationId: string | null = null;
    private lastCommand: CreateInvalidationCommand | null = null;
    private callCount = 0;

    setMockInvalidationId(id: string | null) {
        this.mockInvalidationId = id;
    }

    getLastCommand(): CreateInvalidationCommand | null {
        return this.lastCommand;
    }

    getCallCount(): number {
        return this.callCount;
    }

    reset() {
        this.callCount = 0;
        this.lastCommand = null;
        this.mockInvalidationId = null;
    }

    async send(command: CreateInvalidationCommand): Promise<CreateInvalidationCommandOutput> {
        this.callCount++;
        this.lastCommand = command;

        return {
            Invalidation: this.mockInvalidationId
                ? {
                    Id: this.mockInvalidationId,
                    Status: "InProgress",
                    CreateTime: new Date(),
                }
                : undefined,
            $metadata: {
                httpStatusCode: 201,
                requestId: "mock-request-id",
            },
        } as CreateInvalidationCommandOutput;
    }
}

// Mock provider function
function createMockCloudFrontProvider(mockClient: MockCloudFrontClient) {
    return (_context: AwsContext) => {
        return mockClient;
    };
}

// Helper to create test file objects
function createTestFile(key: string, invalidate: boolean = false): DeployFile {
    return {
        key,
        action: SyncAction.create,
        invalidate,
        priority: 0,
    };
}

// Helper to create mock client with invalidation ID
function createMockClient(invalidationId: string | null = "INVALIDATION-123"): MockCloudFrontClient {
    const client = new MockCloudFrontClient({ region: "us-east-1" });
    client.setMockInvalidationId(invalidationId);
    return client;
}

describe("cloudfront.ts - invalidateCloudFront", () => {
    const logger = new Logger(false);
    const distributionId = "E1234567890ABC";

    test("should create invalidation for files with invalidate flag", async () => {
        const mockClient = createMockClient("INVALIDATION-123");
        const files = [
            createTestFile("index.html", true),
            { ...createTestFile("app.js", true), action: SyncAction.update },
            createTestFile("style.css", false),
        ];

        const invalidationId = await invalidateCloudFront(
            files,
            null,
            distributionId,
            { region: "us-east-1" },
            logger,
            createMockCloudFrontProvider(mockClient)
        );

        expect(invalidationId).toBe("INVALIDATION-123");
        expect(mockClient.getCallCount()).toBe(1);

        const input = mockClient.getLastCommand()!.input;
        expect(input.DistributionId).toBe(distributionId);
        expect(input.InvalidationBatch?.Paths?.Quantity).toBe(2);
        const items = input.InvalidationBatch?.Paths?.Items || [];
        expect(items.includes("/index.html")).toBe(true);
        expect(items.includes("/app.js")).toBe(true);
        expect(items.includes("/style.css")).toBe(false);
    });

    test("should handle additional paths", async () => {
        const mockClient = createMockClient("INVALIDATION-456");
        const files = [createTestFile("index.html", true)];
        const additionalPaths = ["/*", "/api/*"];

        const invalidationId = await invalidateCloudFront(
            files,
            additionalPaths,
            distributionId,
            { region: "us-east-1" },
            logger,
            createMockCloudFrontProvider(mockClient)
        );

        expect(invalidationId).toBe("INVALIDATION-456");
        expect(mockClient.getCallCount()).toBe(1);

        const input = mockClient.getLastCommand()!.input;
        const items = input.InvalidationBatch?.Paths?.Items || [];
        expect(input.InvalidationBatch?.Paths?.Quantity).toBe(3);
        expect(items.includes("/index.html")).toBe(true);
        expect(items.includes("/*")).toBe(true);
        expect(items.includes("/api/*")).toBe(true);
    });

    test("should return null when no paths to invalidate", async () => {
        const mockClient = createMockClient();
        const files = [createTestFile("style.css", false)];

        const invalidationId = await invalidateCloudFront(
            files,
            null,
            distributionId,
            { region: "us-east-1" },
            logger,
            createMockCloudFrontProvider(mockClient)
        );

        expect(invalidationId).toBeNull();
        expect(mockClient.getCallCount()).toBe(0);
    });

    test("should normalize and encode paths correctly", async () => {
        const mockClient = createMockClient("INVALIDATION-789");
        const files = [
            createTestFile("app file.html", true), // No leading slash, has space
            { ...createTestFile("/folder/file name.js", true), action: SyncAction.update }, // Has leading slash, has space
        ];

        const invalidationId = await invalidateCloudFront(
            files,
            null,
            distributionId,
            { region: "us-east-1" },
            logger,
            createMockCloudFrontProvider(mockClient)
        );

        expect(invalidationId).toBe("INVALIDATION-789");

        const paths = mockClient.getLastCommand()!.input.InvalidationBatch?.Paths?.Items || [];
        expect(paths.includes("/app%20file.html")).toBe(true);
        expect(paths.includes("/folder/file%20name.js")).toBe(true);
    });

});
