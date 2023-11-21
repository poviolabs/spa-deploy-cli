import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

export function getCredentials(options: { region: string }) {
  return fromNodeProviderChain({
    //...any input of fromEnv(), fromSSO(), fromTokenFile(), fromIni(),
    // fromProcess(), fromInstanceMetadata(), fromContainerMetadata()
    // Optional. Custom STS client configurations overriding the default ones.
    clientConfig: { region: options.region },
  });
}
