import { describe, expect, it } from "vitest";
import {
  createResultMapper,
  makeCogniteAssetQueryResult,
  makeCogniteAssetQueryResultWithProperties,
} from "./fixtures/index.js";

describe("QueryResultMapper", () => {
  const mapper = createResultMapper();

  it("maps root nodes and nested direct relations from in-memory query data", async () => {
    const result = await mapper.mapNodes("CogniteAsset", makeCogniteAssetQueryResult());

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      instanceType: "node",
      space: "test-space",
      externalId: "root-asset",
      name: "Root Asset",
      parent: {
        instanceType: "node",
        space: "test-space",
        externalId: "parent-asset",
        name: "Parent Asset",
      },
    });
  });

  it("coerces Cognite timestamp properties to Date", async () => {
    const result = await mapper.mapNodes(
      "CogniteAsset",
      makeCogniteAssetQueryResultWithProperties({
        sourceCreatedTime: "2024-01-02T03:04:05.000Z",
        pathLastUpdatedTime: "2024-06-01T12:00:00.000Z",
      }),
    );

    expect(result[0]?.sourceCreatedTime).toBeInstanceOf(Date);
    expect((result[0]?.sourceCreatedTime as Date).toISOString()).toBe("2024-01-02T03:04:05.000Z");
    expect(result[0]?.pathLastUpdatedTime).toBeInstanceOf(Date);
    expect((result[0]?.pathLastUpdatedTime as Date).toISOString()).toBe("2024-06-01T12:00:00.000Z");
  });

  it("leaves invalid Cognite timestamp strings unchanged", async () => {
    const result = await mapper.mapNodes(
      "CogniteAsset",
      makeCogniteAssetQueryResultWithProperties({
        sourceCreatedTime: "not-a-date",
      }),
    );

    expect(result[0]?.sourceCreatedTime).toBe("not-a-date");
  });

  it("throws when the root key is missing from the query result", async () => {
    await expect(mapper.mapNodes("CogniteAsset", {})).rejects.toThrow(
      /not available in the query result/,
    );
  });
});
