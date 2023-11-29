import { z } from "zod";

const toArray = function (input: string | string[] | undefined | null) {
  if (input === undefined || input === null) {
    return [];
  }
  if (Array.isArray(input)) {
    return input;
  }
  return [input];
};

export const CloudfrontConfig = z.object({
  region: z.string().optional(),
  invalidatePaths: z
    .union([z.string(), z.string().array()])
    .optional()
    .transform(toArray),
  distributionId: z
    .union([z.string(), z.string().array()])
    .optional()
    .transform(toArray),
});
