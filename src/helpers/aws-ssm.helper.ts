import merge from "lodash.merge";
import {
  GetParameterCommand,
  GetParametersByPathCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";
import { getCredentials } from "./aws.helper";

export function getSSMInstance(options: { region: string }) {
  return new SSMClient({
    credentials: getCredentials(options),
    region: options.region,
  });
}

const SSMRegEx =
  /arn:aws:ssm:(?<region>[^:]+)?:(?<accountId>\d+)?:parameter\/(?<path>.*)/;

export function resolveSSMPath(options: {
  accountId: string;
  region: string;
  arn: string;
}) {
  if (!options.arn.startsWith("arn:aws:ssm:")) {
    // todo check secret manager
    return options.arn;
  }
  const match = options.arn.match(SSMRegEx);
  if (!match?.groups?.path) {
    throw new Error("Could not parse parameter arn");
  }
  return `arn:aws:ssm:${match.groups.region || options.region}:${
    match.groups.accountId || options.accountId
  }:parameter/${match.groups.path}`;
}

export async function getSSMParameter(options: {
  region: string;
  name: string;
}) {
  const match = options.name.match(SSMRegEx);
  if (!match?.groups?.path) {
    throw new Error("Could not parse parameter arn");
  }
  let response;
  const ssm = getSSMInstance({ region: options.region });
  try {
    response = await ssm.send(
      new GetParameterCommand({
        Name: `/${match.groups.path}`,
        WithDecryption: true,
      }),
    );
  } catch (e) {
    throw new Error(`Could not get parameter ${options.name}`, { cause: e });
  }
  if (!response.Parameter?.Value) {
    throw new Error("Could not get parameter");
  }
  return response.Parameter.Value;
}

export async function getSSMParametersByPath(options: {
  region: string;
  name: string;
}) {
  const match = options.name.match(SSMRegEx);
  if (!match?.groups?.path) {
    throw new Error(`Could not parse parameter arn ${options.name}`);
  }

  const ssm = getSSMInstance({ region: options.region });
  let parameters = {};
  try {
    let nextToken: string | undefined = undefined;
    do {
      const response = await ssm.send(
        new GetParametersByPathCommand({
          Path: `/${match.groups.path}`,
          WithDecryption: true,
          Recursive: true,
          NextToken: nextToken,
          MaxResults: 10,
        }),
      );
      parameters = merge(parameters, response.Parameters);

      // consume all parameters
      nextToken = response.NextToken;
    } while (nextToken);
  } catch (e) {
    throw new Error(`Could not get parameters ${options.name}`, { cause: e });
  }
  return parameters;
}
