import { describe, expect, it } from "vitest";
import { MAX_QUERY_ROOTS } from "../src/constants.js";
import { createQueryMapper } from "./fixtures/index.js";

describe("QueryMapper.mapMany", () => {
  const mapper = createQueryMapper();

  it("maps multiple independent roots with distinct filters, limits, and sorts", async () => {
    const query = await mapper.mapMany({
      roots: [
        {
          key: "asset-a",
          viewExternalId: "CogniteAsset",
          select: { name: true },
          filters: { name: { eq: "Pump A" } },
          sort: { name: "ascending" },
          limit: 1,
        },
        {
          key: "asset-b",
          viewExternalId: "CogniteAsset",
          select: { name: true, description: true },
          filters: { name: { eq: "Pump B" } },
          sort: { name: "descending" },
          limit: 5,
        },
      ],
    });

    expect(Object.keys(query.with).sort()).toEqual(["asset-a", "asset-b"]);
    expect(Object.keys(query.select).sort()).toEqual(["asset-a", "asset-b"]);

    expect(query.with["asset-a"]).toMatchObject({
      limit: 1,
      sort: [{ property: ["cdf_cdm", "CogniteAsset/v1", "name"], direction: "ascending" }],
    });
    expect(query.with["asset-b"]).toMatchObject({
      limit: 5,
      sort: [{ property: ["cdf_cdm", "CogniteAsset/v1", "name"], direction: "descending" }],
    });

    const rootA = query.with["asset-a"] as { nodes: { filter: { and: unknown[] } } };
    const rootB = query.with["asset-b"] as { nodes: { filter: { and: unknown[] } } };
    expect(rootA.nodes.filter.and).toContainEqual({
      equals: { property: ["cdf_cdm", "CogniteAsset/v1", "name"], value: "Pump A" },
    });
    expect(rootB.nodes.filter.and).toContainEqual({
      equals: { property: ["cdf_cdm", "CogniteAsset/v1", "name"], value: "Pump B" },
    });

    expect(query.select["asset-a"]).toEqual({
      sources: [
        {
          source: { type: "view", space: "cdf_cdm", externalId: "CogniteAsset", version: "v1" },
          properties: ["name"],
        },
      ],
    });
    expect(query.select["asset-b"]).toEqual({
      sources: [
        {
          source: { type: "view", space: "cdf_cdm", externalId: "CogniteAsset", version: "v1" },
          properties: expect.arrayContaining(["name", "description"]),
        },
      ],
    });
  });

  it("scopes relation includes under each root key", async () => {
    const query = await mapper.mapMany({
      roots: [
        {
          key: "root-1",
          viewExternalId: "CogniteAsset",
          select: { name: true, parent: { name: true } },
          limit: 1,
        },
        {
          key: "root-2",
          viewExternalId: "CogniteAsset",
          select: { name: true, parent: { name: true } },
          limit: 1,
        },
      ],
    });

    expect(query.with["root-1|parent"]).toMatchObject({
      nodes: {
        from: "root-1",
        direction: "outwards",
        through: {
          view: { type: "view", space: "cdf_cdm", externalId: "CogniteAsset", version: "v1" },
          identifier: "parent",
        },
      },
    });
    expect(query.with["root-2|parent"]).toMatchObject({
      nodes: { from: "root-2" },
    });
    expect(query.select["root-1|parent"]).toBeDefined();
    expect(query.select["root-2|parent"]).toBeDefined();
  });

  it("passes per-root cursors through to the Cognite request", async () => {
    const query = await mapper.mapMany({
      roots: [
        {
          key: "page-a",
          viewExternalId: "CogniteAsset",
          select: { name: true },
          cursor: "cursor-a",
        },
        {
          key: "page-b",
          viewExternalId: "CogniteAsset",
          select: { name: true },
          cursor: null,
        },
      ],
    });

    expect(query.cursors).toEqual({ "page-a": "cursor-a" });
  });

  it("rejects empty roots", async () => {
    await expect(mapper.mapMany({ roots: [] })).rejects.toThrow(/at least one root/);
  });

  it("rejects duplicate root keys", async () => {
    await expect(
      mapper.mapMany({
        roots: [
          { key: "same", viewExternalId: "CogniteAsset", select: { name: true } },
          { key: "same", viewExternalId: "CogniteAsset", select: { name: true } },
        ],
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it("rejects keys that contain the nested separator", async () => {
    await expect(
      mapper.mapMany({
        roots: [{ key: "bad|key", viewExternalId: "CogniteAsset", select: { name: true } }],
      }),
    ).rejects.toThrow(/must not contain/);
  });

  it("rejects more than MAX_QUERY_ROOTS roots", async () => {
    const roots = Array.from({ length: MAX_QUERY_ROOTS + 1 }, (_, i) => ({
      key: `root-${i}`,
      viewExternalId: "CogniteAsset" as const,
      select: { name: true },
    }));

    await expect(mapper.mapMany({ roots })).rejects.toThrow(
      new RegExp(`at most ${MAX_QUERY_ROOTS}`),
    );
  });

  it("keeps single-root map() keyed by viewExternalId", async () => {
    const query = await mapper.map<{ name: string }>({
      viewExternalId: "CogniteAsset",
      select: { name: true },
      limit: 10,
    });

    expect(query.with.CogniteAsset).toBeDefined();
    expect(query.select.CogniteAsset).toBeDefined();
  });
});
