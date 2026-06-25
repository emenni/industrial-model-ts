import { describe, expect, it } from "vitest";
import { createIntegrationCoreClient, hasIntegrationCredentials } from "./setup.js";

const describeIntegration = describe.skipIf(!hasIntegrationCredentials());

describeIntegration("integration search", () => {
  const core = () => createIntegrationCoreClient();

  it("searches CogniteDescribable instances", async () => {
    const queries = [
      core().query("CogniteDescribable")({ limit: 10 }),
      core().query("CogniteDescribable")({
        filters: { name: { search: { query: "test" } } },
        limit: 10,
      }),
    ];

    for (const query of queries) {
      const result = await query;
      expect(Array.isArray(result.items)).toBe(true);
    }
  });

  it("searches CogniteAssetType instances", async () => {
    const result = await core().query("CogniteAssetType")({
      filters: {
        AND: [{ code: { eq: "TESTING_123" } }, { name: { search: { query: "test" } } }],
      },
      limit: 10,
    });

    expect(Array.isArray(result.items)).toBe(true);
  });

  it("searches CogniteEquipment instances", async () => {
    const result = await core().query("CogniteEquipment")({
      filters: {
        AND: [{ asset: { exists: true } }, { name: { search: { query: "test" } } }],
      },
      limit: 10,
    });

    expect(Array.isArray(result.items)).toBe(true);
  });

  it("searches CogniteAsset instances by path membership", async () => {
    const result = await core().query("CogniteAsset")({
      filters: {
        path: {
          containsAny: [{ externalId: "CHILD-456", space: "cdf_cdm" }],
        },
      },
      limit: 10,
    });

    expect(Array.isArray(result.items)).toBe(true);
  });
});
