import { z } from "zod";
import merge from "lodash.merge";
import { cosmiconfigSync } from "cosmiconfig";

import { logError, logVerbose } from "./cli.helper";
import { getSSMParameter } from "./aws-ssm.helper";

export const ZeConfigItemValue = z
  .object({
    name: z.string(),
    treeFrom: z.string().optional(),
    valueFrom: z.string().optional(),
    objectFrom: z.string().optional(),
    configFrom: z.string().optional(),
    config: z.any().optional(),
    value: z.string().optional(),
  })
  .refine(
    (val) =>
      [
        //val.treeFrom,
        val.valueFrom,
        val.value,
        val.configFrom,
        val.config,
        val.objectFrom,
      ].filter((x) => x !== undefined).length === 1,
    {
      message: "Exactly one of treeFrom, valueFrom, or value must be specified",
    },
  );
export const ZeConfigItemValues = z.array(ZeConfigItemValue);
export const ZeConfigItem = z.object({
  name: z.string().optional(),
  destination: z.string(),
  source: z.string().optional(),
  values: ZeConfigItemValues,
});
export type ZeConfigItemValuesDto = z.output<typeof ZeConfigItemValues>;
export type ZeConfigItemDto = z.output<typeof ZeConfigItem>;

export const ZeConfigs = z
  .union([
    ZeConfigItem.extend({ name: z.string().optional() }),
    ZeConfigItem.array(),
  ])
  .transform((val) =>
    Array.isArray(val) ? val : [{ name: "default", ...val }],
  );
export type ZeConfigsDto = z.output<typeof ZeConfigs>;

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
  optional: boolean = true,
): Promise<z.output<T>> {
  const config = await loadConfig(moduleName, cwd, stage, optional);
  const result = type.safeParse(config);
  if (!result.success) {
    for (const error of result.error.errors) {
      if (error.code === "invalid_union") {
        for (const error2 of error.unionErrors) {
          const unionErrors: string[] = [];
          for (const error3 of error2.issues) {
            unionErrors.push(`'${error3.path.join(".")}' => ${error3.message}`);
          }
          logError(`Config conditional error: ${unionErrors.join(" & ")}`);
        }
      } else {
        logError(`Config error at '${error.path.join(".")}': ${error.message}`);
      }
    }
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
    `${moduleName}`,
    `${stage}.${moduleName}`,
    `${stage}.${moduleName}.local`,
  ]) {
    const { search } = cosmiconfigSync(moduleName, {
      // default cosmiconfig searchPlaces
      searchPlaces: [".json", ".yaml", ".yml", ".js", ".ts", ".cjs"].map(
        (x) => `${name}${x}`,
      ),
      stopDir: cwd,
    });

    let result;
    try {
      result = search(`${cwd}/.config`);
    } catch (e) {
      console.error(e);
    }

    if (result && !result.isEmpty) {
      logVerbose(`Loaded ${result.filepath}`);
      config = merge(config, result.config);
      found = true;
    }
  }
  if (!found && !optional) {
    throw new Error(`Could not find config '${moduleName}' for stage ${stage}`);
  }
  return config;
}

export async function resolveZeConfigItem(
  { values }: { values: ZeConfigItemValuesDto },
  options: { awsRegion?: string; release?: string },
  cwd: string,
  stage: string,
) {
  let tree: any = {};
  for (const {
    name,
    treeFrom,
    valueFrom,
    configFrom,
    config,
    objectFrom,
    value,
  } of values) {
    let edge = tree;
    let resolvedValue: any;
    if (value) {
      resolvedValue = value;
    } else if (valueFrom) {
      // resolve the value
      resolvedValue = await resolveResource(valueFrom, {
        ...options,
        stage,
        cwd,
      });
    } else if (objectFrom) {
      // resolve the object and merge
      resolvedValue = await resolveResource(objectFrom, {
        ...options,
        stage,
        cwd,
      });
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
      resolvedValue = await resolveConfig(unresolvedValue, {
        ...options,
        stage,
        cwd,
      });
    } else if (options) {
      // get the template and resolve the values
      resolvedValue = await resolveConfig(config, {
        ...options,
        stage,
        cwd,
      });
    } else {
      // zod should prevent this
      throw new Error(
        `Exactly one of valueFrom, configFrom, objectFrom, config, or value must be specified`,
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
  config: {
    awsRegion?: string;
    release?: string;
    stage?: string;
    cwd?: string;
  },
  key: string = "@",
): Promise<any> {
  if (value.startsWith("arn:aws:ssm")) {
    if (!config.awsRegion) {
      throw new Error(
        `Cannot resolve resource ${value} at ${key} without awsRegion`,
      );
    }
    return await getSSMParameter({ region: config.awsRegion, name: value });
  }
  if (value.startsWith("env:")) {
    return process.env[value.slice(4)];
  }
  if (value.startsWith("func:")) {
    switch (value.slice(5)) {
      case "timestamp":
        return new Date().toISOString();
      case "stage":
        return config.stage;
      case "release":
        return config.release;
      default:
        throw new Error(`Unknown function '${value}' at '${key}'`);
    }
  }
  if (value.startsWith("config:")) {
    if (!config.cwd) {
      throw new Error("cwd not provided");
    }
    if (!config.stage) {
      throw new Error("stage not provided");
    }
    return loadConfig(value.slice(7), config.cwd, config.stage, false);
  }
  throw new Error(`Cannot resolve resource '${value}' at '${key}'`);
}

/**
 * Traverse the config and resolve any ${} values
 */
export async function resolveConfig(
  value: any,
  config: { awsRegion?: string; stage?: string; cwd?: string },
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
