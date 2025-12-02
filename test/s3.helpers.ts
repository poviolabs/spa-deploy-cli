
import { DeleteObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";

import type { AwsContext } from "../src/lib/aws";

const TEST_S3_ENDPOINT = "http://localhost:9090";
const TEST_REGION = "us-east-1";
const TEST_ACCESS_KEY = "test-access-key";
const TEST_SECRET_KEY = "test-secret-key";
export const TEST_BUCKET = "test-bucket";

export function getTestAwsContext(overrides?: Partial<AwsContext>): AwsContext {
    return {
        region: TEST_REGION,
        endpoint: TEST_S3_ENDPOINT,
        accessKeyId: TEST_ACCESS_KEY,
        secretAccessKey: TEST_SECRET_KEY,
        ...overrides,
    };
}

export async function cleanupS3Bucket(client: S3Client, bucketName: string): Promise<void> {
    try {
        // List all objects
        const listResponse = await client.send(
            new ListObjectsV2Command({ Bucket: bucketName })
        );

        if (listResponse.Contents) {
            // Delete all objects
            await Promise.all(
                listResponse.Contents.map((obj) =>
                    client.send(
                        new DeleteObjectCommand({
                            Bucket: bucketName,
                            Key: obj.Key!,
                        })
                    )
                )
            );
        }
    } catch (error) {
        // Ignore cleanup errors
        console.warn("Cleanup error:", error);
    }
}
