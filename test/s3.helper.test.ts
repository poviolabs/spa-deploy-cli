import { listS3Files } from "../src/s3.helper";

process.env.AWS_ACCESS_KEY_ID = "foobar";
process.env.AWS_SECRET_ACCESS_KEY = "foobar";

describe("config", () => {
  const config = {
    region: "eu-west-1",
    bucket: "deploy-bucket",
    endpoint: "http://localhost:9090",
  };

  test("it should list s3 files", async () => {
    const files = await listS3Files(config);
  });


});
