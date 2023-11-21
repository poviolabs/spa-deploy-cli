import { z } from "zod";

export const BaseConfig = z.object({
  accountId: z.string(),
  region: z.string(),
});

export type BaseConfigDto = z.output<typeof BaseConfig>;

export const BootstrapConfigItemValue = z
  .object({
    name: z.string(),
    treeFrom: z.string().optional(),
    valueFrom: z.string().optional(),
    objectFrom: z.string().optional(),
    configFrom: z.string().optional(),
    value: z.string().optional(),
  })
  .refine(
    (val) =>
      [
        val.treeFrom,
        val.valueFrom,
        val.value,
        val.configFrom,
        val.objectFrom,
      ].filter((x) => x !== undefined).length === 1,
    {
      message: "Exactly one of treeFrom, valueFrom, or value must be specified",
    },
  );
export const BootstrapConfigItem = z.object({
  name: z.string(),
  destination: z.string(),
  values: z.array(BootstrapConfigItemValue),
});
export type BootstrapConfigItemDto = z.output<typeof BootstrapConfigItem>;
export const BootstrapConfig = BaseConfig.extend({
  configs: z.array(BootstrapConfigItem),
});
export type BootstrapConfigDto = z.output<typeof BootstrapConfig>;
