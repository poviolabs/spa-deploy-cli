import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { getCredentials } from "./aws.helper";
import { logInfo } from "./cli.helper";
import { S3SyncPlan } from "./aws-s3.helper";

export function getCloudfrontClientInstance(options: { region: string }) {
  return new CloudFrontClient({
    credentials: getCredentials({ region: options.region }),
    region: options.region,
  });
}

export function prepareCloudfrontInvalidation(
  plan: S3SyncPlan,
  invalidatePaths: string[],
): string[] {
  const { items } = plan;
  return [
    ...items.reduce((acc, item) => {
      if (item.invalidate) {
        acc.push(`/${item.remote!.key}`);
      }
      return acc;
    }, [] as string[]),
    ...invalidatePaths,
  ];
}

export async function executeCloudfrontInvalidation(
  invalidations: string[],
  distributionsId: string[],
  region: string,
) {
  for (const DistributionId of distributionsId) {
    const client = getCloudfrontClientInstance({ region });
    logInfo(`Invalidating ${DistributionId}`);
    await client.send(
      new CreateInvalidationCommand({
        DistributionId,
        InvalidationBatch: {
          CallerReference: new Date().toISOString(),
          Paths: {
            Quantity: invalidations.length,
            Items: invalidations,
          },
        },
      }),
    );
  }
}
