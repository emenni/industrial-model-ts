import { afterEach, describe, expect, it } from "vitest";
import { IntegrationTestEnv } from "./integration/env.js";

const baseEnv = {
  CDF_PROJECT: "my-project",
  CDF_CLUSTER: "az-phx-001",
  CDF_CLIENT_ID: "client-id",
  CDF_CLIENT_SECRET: "client-secret",
  CDF_TOKEN_URL: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
};

describe("IntegrationTestEnv", () => {
  const previousEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  it("parses cluster-based configuration", () => {
    Object.assign(process.env, baseEnv);

    const parsed = IntegrationTestEnv.fromProcessEnv();
    expect(parsed.project).toBe("my-project");
    expect(parsed.baseUrl).toBe("https://az-phx-001.cognitedata.com");
    expect(parsed.oauthScope).toBe("https://az-phx-001.cognitedata.com/.default");
    expect(parsed.clientName).toBe("industrial-model-integration-tests");
    expect(parsed.dataModelId).toEqual({
      space: "cdf_cdm",
      externalId: "CogniteCore",
      version: "v1",
    });
  });

  it("parses base URL configuration and strips trailing slash", () => {
    Object.assign(process.env, {
      ...baseEnv,
      CDF_BASE_URL: "https://custom.cognitedata.com/",
    });
    delete process.env.CDF_CLUSTER;

    const parsed = IntegrationTestEnv.fromProcessEnv();
    expect(parsed.baseUrl).toBe("https://custom.cognitedata.com");
    expect(parsed.oauthScope).toBe("https://custom.cognitedata.com/.default");
  });

  it("reports availability from process.env", () => {
    Object.assign(process.env, baseEnv);
    expect(IntegrationTestEnv.isAvailable()).toBe(true);

    for (const key of Object.keys(baseEnv)) {
      delete process.env[key];
    }
    expect(IntegrationTestEnv.isAvailable()).toBe(false);
  });

  it("throws a readable error when required variables are missing", () => {
    for (const key of Object.keys(baseEnv)) {
      delete process.env[key];
    }

    expect(() => IntegrationTestEnv.fromProcessEnv()).toThrow(
      /Invalid integration test environment/,
    );
  });
});
