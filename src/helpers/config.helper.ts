import merge from "lodash.merge";

import { cosmiconfigSync } from "cosmiconfig";
import { logError, logVerbose } from "./cli.helper";
import { z } from "zod";
import { BaseConfigDto, BootstrapConfigItemDto } from "../types/bootstrap.dto";
import { getSSMParameter } from "./aws-ssm.helper";

/**
 * Load config in order, one of
 *  .config/stage.moduleName.json
 *  .config/stage.moduleName.yml
 *
 * then one of
 *  .config/stage.local.moduleName.json
 *  .config/stage.local.moduleName.yml
 */
export async function safeLoadConfig<T extends z.ZodType<any, any, any>>(
  moduleName: string,
  cwd: string,
  stage: string,
  type: T,
): Promise<z.output<T>> {
  const config = await loadConfig(moduleName, cwd, stage);
  const result = type.safeParse(config);
  if (!result.success) {
    const errors: string[] = [];
    for (const error of result.error.errors) {
      errors.push(`${error.path.join(".")}: ${error.message}`);
    }
    logError(`Invalid config: ${errors.join(";")}`);
    process.exit(1);
  }
  return result.data;
}

export async function loadConfig(
  moduleName: string,
  cwd: string,
  stage: string,
  optional: boolean = true,
): Promise<any> {
  let config = {};
  let found = false;
  for (const name of [
    `${stage}.${moduleName}`,
    `${stage}.${moduleName}.local`,
  ]) {
    const { search } = cosmiconfigSync(moduleName, {
      searchPlaces: [`${name}.json`, `${name}.yml`],
      stopDir: cwd,
    });
    const result = search(`${cwd}/.config`);
    if (result && !result.isEmpty) {
      logVerbose(`Loaded ${result.filepath}`);
      config = merge(config, result.config);
      found = true;
    }
  }
  if (!found && !optional) {
    throw new Error(`Could not find config for stage ${stage}`);
  }
  return config;
}

export async function resolveBootstrapConfigItem(
  { values }: BootstrapConfigItemDto,
  config: BaseConfigDto,
  cwd: string,
  stage: string,
) {
  let tree: any = {};
  for (const {
    name,
    treeFrom,
    valueFrom,
    configFrom,
    objectFrom,
    value,
  } of values) {
    let edge = tree;
    let resolvedValue: any;
    if (value) {
      resolvedValue = value;
    } else if (valueFrom) {
      // resolve the value
      resolvedValue = await resolveResource(valueFrom, config);
    } else if (objectFrom) {
      // resolve the object and merge
      resolvedValue = await resolveResource(objectFrom, config);
      resolvedValue = JSON.parse(resolvedValue);
    } else if (treeFrom) {
      throw new Error(`treeFrom is not supported yet`);
      /*
        how should this work?

        # loads all parameters with the prefix into a tree
        # /myapp-dev/database/password -> database.password
        # /myapp-dev/database/user__password -> database.user.password
        # how do we know where the root is ?
        treeFrom: arn:aws:ssm:::parameter/myapp-dev/database

      if (treeFrom.startsWith("arn:aws:ssm")) {
        const parameters = await getSSMParametersByPath({
          region: config.region,
          name: treeFrom,
        });
        for (const {Value, Name} of parameters) {
          const key = Name.slice(treeFrom.length);
          edge[key] = Value;
        }
      } else {
        throw new Error(`Cannot resolve tree from ${treeFrom}`);
      }
       */
    } else if (configFrom) {
      // get the template and resolve the values
      const unresolvedValue = await loadConfig(configFrom, cwd, stage, false);
      resolvedValue = await resolveConfig(unresolvedValue, config);
    } else {
      // zod should prevent this
      throw new Error(
        `Exactly one of treeFrom, valueFrom, or value must be specified`,
      );
    }
    if (resolvedValue !== undefined) {
      if (name === "@") {
        if (typeof resolvedValue !== "object") {
          throw new Error(`Cannot set root value to "${resolvedValue}"`);
        }
        tree = merge(tree, resolvedValue);
      } else {
        // resolve __ name into tree path
        const segments = name.split("__");
        while (segments.length > 1) {
          const segment = segments.shift()!;
          if (!edge[segment]) {
            edge[segment] = {};
          }
          if (typeof edge[segment] !== "object") {
            throw new Error(`Cannot create tree path at ${name}`);
          }
          edge = edge[segment];
        }
        edge[segments[0]] = resolvedValue;
      }
    }
  }
  return tree;
}

/**
 * Resolve a remote resource from a string
 */
export async function resolveResource(
  value: string,
  config: BaseConfigDto,
  key: string = "@",
): Promise<any> {
  if (value.startsWith("arn:aws:ssm")) {
    return await getSSMParameter({ region: config.region, name: value });
  }
  if (value.startsWith("env:")) {
    return process.env[value.slice(4)];
  }
  if (value.startsWith("func:")) {
    switch (value.slice(5)) {
      case "timestamp":
        return new Date().toISOString();
      default:
        throw new Error(`Unknown function ${value} at ${key}`);
    }
  }
  throw new Error(`Cannot resolve resource ${value} at ${key}`);
}

/**
 * Traverse the config and resolve any ${} values
 */
export async function resolveConfig(
  value: any,
  config: BaseConfigDto,
  key?: string,
) {
  if (value !== null && value !== undefined) {
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        value[k] = await resolveConfig(v, config, `${key}.${k}`);
      }
    } else if (typeof value === "string") {
      if (value.startsWith("${") && value.endsWith("}")) {
        return await resolveResource(value.slice(2, -1), config);
      }
    }
  }
  return value;
}
