import { S3Client, paginateListObjectsV2 } from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { fromEnv } from "@aws-sdk/credential-provider-env";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

function getCredentials() {
  if (process.env.AWS_PROFILE) {
    return fromIni();
  }
  return fromEnv();
}

export async function getAwsIdentity(options: { region: string }) {
  const stsClient = new STSClient({
    credentials: getCredentials(),
    region: options.region,
  });
  return await stsClient.send(new GetCallerIdentityCommand({}));
}

function getS3ClientInstance(options: { region: string; endpoint?: string }) {
  return new S3Client({
    credentials: getCredentials(),
    region: options.region,
    ...(options.endpoint
      ? { forcePathStyle: true, endpoint: options.endpoint }
      : {}),
  });
}

enum S3FilePlan {
  ignore,
  delete,
  update,
  insert,
}

interface S3File {
  key: string;
  lastModified: Date;
  eTag: string;
  size: number;
  plan: S3FilePlan;
}

export async function listS3Files(options: {
  prefix?: string;
  region: string;
  bucket: string;
  endpoint?: string;
}): Promise<S3File[]> {
  const allFiles: S3File[] = [];
  const client = getS3ClientInstance(options);
  for await (const data of paginateListObjectsV2(
    {
      client,
    },
    { Bucket: options.bucket, Prefix: options.prefix }
  )) {
    if (data.Contents) {
      data.Contents.forEach((x) => {
        allFiles.push({
          key: x.Key,
          lastModified: x.LastModified,
          eTag: x.ETag,
          size: x.Size,
          plan: S3FilePlan.ignore,
        });
      });
    }
  }
  return allFiles;
}
