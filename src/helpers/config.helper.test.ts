import { test } from "node:test";
import { resolveBootstrapConfigItem } from "./config.helper";
import assert from "assert";

test("config.helper", async () => {
  process.env.MYAPP_RECORD1 = "value 1";
  process.env.MYAPP_RECORD2 = "value 2";
  process.env.MYAPP_RECORD3 = "value 3";

  const config = await resolveBootstrapConfigItem(
    {
      name: "test",
      destination: "./.config/myapp-dev.backend.yml",
      values: [
        { name: "database__name", value: "test" },
        { name: "database__username2", value: "test" },
        { name: "database__password", valueFrom: "env:MYAPP_RECORD3" },
        {
          name: "@",
          configFrom: "backend.template",
        },
        //{
        //  name: "@",
        //  treeFrom: "arn:aws:ssm:::parameter/myapp-dev/",
        //},
      ],
    },
    {
      accountId: "000000000000",
      region: "us-east-1",
    },
    "./test",
    "myapp-dev",
  );

  assert.deepStrictEqual(config, {
    database: {
      name: "test",
      username2: "test",
      password: "value 3",
      username: "myapp2",
      from_env: "value 1",
      items: [
        {
          object1: {
            record: "value 2",
          },
        },
        "value 3",
      ],
    },
  });
});
