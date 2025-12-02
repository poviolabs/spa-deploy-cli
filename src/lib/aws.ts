import { fromNodeProviderChain } from "@aws-sdk/credential-providers";


export interface AwsContext {
    region?: string;
    accountId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    endpoint?: string;
}

export function getCredentials(context: AwsContext) {
    if (!context.region) {
        throw new Error("AWS Region is required for credentials");
    }

    // If explicit credentials are provided, use them
    if (context.accessKeyId && context.secretAccessKey) {
        return {
            accessKeyId: context.accessKeyId,
            secretAccessKey: context.secretAccessKey,
            region: context.region,
        };
    }

    // Otherwise, use the default provider chain
    return fromNodeProviderChain({
        clientConfig: { region: context.region },
    });
}

