import { describe, expect, it, vi } from "vitest";
import { DatapointsRetriever } from "../../src/calculator/datapoints-retrieval";
import type { CalculatorParameter } from "../../src/calculator/models";
import type { CognitePort } from "../../src/cognite";
import { makeCogniteMock } from "../fixtures/index.js";

const TS_A = { space: "ts-space", externalId: "temperature" };
const TS_B = { space: "ts-space", externalId: "pressure" };
const START = new Date("2024-01-01T00:00:00.000Z");
const END = new Date("2024-01-02T00:00:00.000Z");
const T0 = new Date("2024-01-01T00:00:00.000Z");
const T1 = new Date("2024-01-01T01:00:00.000Z");

function makeResultItem(overrides: { isString?: boolean; datapoints?: unknown[] }) {
  return {
    isString: overrides.isString ?? false,
    datapoints: overrides.datapoints ?? [],
  };
}

function makeRetriever(resultItems: unknown[]): {
  retriever: DatapointsRetriever;
  cognite: CognitePort;
} {
  const cognite = makeCogniteMock();
  cognite.retrieveDatapoints = vi.fn().mockResolvedValue({ items: resultItems });
  return { retriever: new DatapointsRetriever(cognite), cognite };
}

function rawParam(
  timeSeries: { space: string; externalId: string },
  alias: string,
): CalculatorParameter {
  return { timeSeries, alias };
}

// A Cognite mock that echoes each request item back as a result item whose
// single datapoint value is the numeric externalId. This lets tests assert
// that pagination stitches responses back together in the right order.
function makePaginatingRetriever(): {
  retriever: DatapointsRetriever;
  cognite: CognitePort;
} {
  const cognite = makeCogniteMock();
  cognite.retrieveDatapoints = vi.fn().mockImplementation(({ items }) =>
    Promise.resolve({
      items: items.map((item: { externalId: string }) =>
        makeResultItem({ datapoints: [{ timestamp: T0, value: Number(item.externalId) }] }),
      ),
    }),
  );
  return { retriever: new DatapointsRetriever(cognite), cognite };
}

describe("DatapointsRetriever.retrieveDatapoints", () => {
  it("returns an empty result per parameter without calling Cognite when there are no parameters", async () => {
    const { retriever, cognite } = makeRetriever([]);

    const result = await retriever.retrieveDatapoints([], START, END);

    expect(result).toEqual([]);
    expect(cognite.retrieveDatapoints).not.toHaveBeenCalled();
  });

  it("retrieves a single raw series and parses its datapoints", async () => {
    const { retriever, cognite } = makeRetriever([
      makeResultItem({
        datapoints: [
          { timestamp: T0, value: 10 },
          { timestamp: T1, value: 20 },
        ],
      }),
    ]);

    const result = await retriever.retrieveDatapoints([rawParam(TS_A, "A")], START, END);

    expect(result).toEqual([
      [
        { timestamp: T0, value: 10 },
        { timestamp: T1, value: 20 },
      ],
    ]);
    expect(cognite.retrieveDatapoints).toHaveBeenCalledWith({
      items: [{ space: TS_A.space, externalId: TS_A.externalId }],
      start: START,
      end: END,
    });
  });

  it("de-duplicates raw requests that share a time series", async () => {
    const { retriever, cognite } = makeRetriever([
      makeResultItem({ datapoints: [{ timestamp: T0, value: 42 }] }),
    ]);

    const result = await retriever.retrieveDatapoints(
      [rawParam(TS_A, "A"), rawParam(TS_A, "B")],
      START,
      END,
    );

    // Only one request is issued...
    const call = vi.mocked(cognite.retrieveDatapoints).mock.calls[0]?.[0];
    expect(call?.items).toHaveLength(1);
    // ...but both parameters resolve to the same parsed series.
    expect(result).toEqual([[{ timestamp: T0, value: 42 }], [{ timestamp: T0, value: 42 }]]);
  });

  it("preserves per-parameter order across multiple time series", async () => {
    const { retriever } = makeRetriever([
      makeResultItem({ datapoints: [{ timestamp: T0, value: 1 }] }),
      makeResultItem({ datapoints: [{ timestamp: T0, value: 2 }] }),
    ]);

    const result = await retriever.retrieveDatapoints(
      [rawParam(TS_A, "A"), rawParam(TS_B, "B")],
      START,
      END,
    );

    expect(result[0]?.[0]?.value).toBe(1);
    expect(result[1]?.[0]?.value).toBe(2);
  });

  it("accumulates aggregates for parameters sharing a time series and granularity", async () => {
    const { retriever, cognite } = makeRetriever([
      makeResultItem({
        datapoints: [{ timestamp: T0, average: 5, max: 9 }],
      }),
    ]);

    const params: CalculatorParameter[] = [
      { timeSeries: TS_A, aggregateType: "average", granularity: "1h", alias: "A" },
      { timeSeries: TS_A, aggregateType: "max", granularity: "1h", alias: "B" },
    ];
    const result = await retriever.retrieveDatapoints(params, START, END);

    const call = vi.mocked(cognite.retrieveDatapoints).mock.calls[0]?.[0];
    expect(call?.items).toHaveLength(1);
    expect(call?.items[0]).toMatchObject({
      space: TS_A.space,
      externalId: TS_A.externalId,
      aggregates: ["average", "max"],
      granularity: "1h",
    });
    expect(result).toEqual([[{ timestamp: T0, value: 5 }], [{ timestamp: T0, value: 9 }]]);
  });

  it("issues separate requests for the same series with different granularities", async () => {
    const { retriever, cognite } = makeRetriever([
      makeResultItem({ datapoints: [{ timestamp: T0, average: 1 }] }),
      makeResultItem({ datapoints: [{ timestamp: T0, average: 2 }] }),
    ]);

    const params: CalculatorParameter[] = [
      { timeSeries: TS_A, aggregateType: "average", granularity: "1h", alias: "A" },
      { timeSeries: TS_A, aggregateType: "average", granularity: "1d", alias: "B" },
    ];
    const result = await retriever.retrieveDatapoints(params, START, END);

    const call = vi.mocked(cognite.retrieveDatapoints).mock.calls[0]?.[0];
    expect(call?.items).toHaveLength(2);
    expect(result[0]?.[0]?.value).toBe(1);
    expect(result[1]?.[0]?.value).toBe(2);
  });

  it("keeps raw and aggregate requests for the same series separate", async () => {
    const { retriever, cognite } = makeRetriever([
      makeResultItem({ datapoints: [{ timestamp: T0, value: 100 }] }),
      makeResultItem({ datapoints: [{ timestamp: T0, average: 50 }] }),
    ]);

    const params: CalculatorParameter[] = [
      { timeSeries: TS_A, alias: "raw" },
      { timeSeries: TS_A, aggregateType: "average", granularity: "1h", alias: "agg" },
    ];
    const result = await retriever.retrieveDatapoints(params, START, END);

    const call = vi.mocked(cognite.retrieveDatapoints).mock.calls[0]?.[0];
    expect(call?.items).toHaveLength(2);
    expect(result[0]?.[0]?.value).toBe(100);
    expect(result[1]?.[0]?.value).toBe(50);
  });

  it("skips datapoints whose value is null or missing", async () => {
    const { retriever } = makeRetriever([
      makeResultItem({
        datapoints: [
          { timestamp: T0, value: 1 },
          { timestamp: T1, value: null },
          { timestamp: new Date("2024-01-01T02:00:00.000Z") },
        ],
      }),
    ]);

    const result = await retriever.retrieveDatapoints([rawParam(TS_A, "A")], START, END);

    expect(result[0]).toEqual([{ timestamp: T0, value: 1 }]);
  });

  it("throws when an aggregate parameter is missing granularity", async () => {
    const { retriever } = makeRetriever([]);

    await expect(
      retriever.retrieveDatapoints(
        [{ timeSeries: TS_A, aggregateType: "average", alias: "A" }],
        START,
        END,
      ),
    ).rejects.toThrow(/Missing granularity for 'A' with aggregate 'average'/);
  });

  it("throws when a returned series is a string time series", async () => {
    const { retriever } = makeRetriever([makeResultItem({ isString: true })]);

    await expect(retriever.retrieveDatapoints([rawParam(TS_A, "A")], START, END)).rejects.toThrow(
      /expected numeric datapoints/,
    );
  });

  it("throws when Cognite returns fewer result items than requested", async () => {
    const { retriever } = makeRetriever([]);

    await expect(retriever.retrieveDatapoints([rawParam(TS_A, "A")], START, END)).rejects.toThrow(
      /missing datapoints response for parameter 'A'/,
    );
  });

  it("reads the raw 'value' field, ignoring same-named aggregate keys", async () => {
    const { retriever } = makeRetriever([
      makeResultItem({ datapoints: [{ timestamp: T0, value: 1, average: 999 }] }),
    ]);

    const result = await retriever.retrieveDatapoints([rawParam(TS_A, "A")], START, END);

    expect(result[0]).toEqual([{ timestamp: T0, value: 1 }]);
  });

  it("paginates requests for more than 100 unique time series", async () => {
    const { retriever, cognite } = makePaginatingRetriever();

    const params = Array.from({ length: 150 }, (_, index) =>
      rawParam({ space: "ts-space", externalId: String(index) }, `p${index}`),
    );
    const result = await retriever.retrieveDatapoints(params, START, END);

    expect(cognite.retrieveDatapoints).toHaveBeenCalledTimes(2);
    expect(vi.mocked(cognite.retrieveDatapoints).mock.calls[0]?.[0]?.items).toHaveLength(100);
    expect(vi.mocked(cognite.retrieveDatapoints).mock.calls[1]?.[0]?.items).toHaveLength(50);
    expect(result[0]?.[0]?.value).toBe(0);
    expect(result[99]?.[0]?.value).toBe(99);
    expect(result[149]?.[0]?.value).toBe(149);
  });

  it("issues a single request for exactly 100 unique time series", async () => {
    const { retriever, cognite } = makePaginatingRetriever();

    const params = Array.from({ length: 100 }, (_, index) =>
      rawParam({ space: "ts-space", externalId: String(index) }, `p${index}`),
    );
    const result = await retriever.retrieveDatapoints(params, START, END);

    expect(cognite.retrieveDatapoints).toHaveBeenCalledTimes(1);
    expect(vi.mocked(cognite.retrieveDatapoints).mock.calls[0]?.[0]?.items).toHaveLength(100);
    expect(result[0]?.[0]?.value).toBe(0);
    expect(result[99]?.[0]?.value).toBe(99);
  });

  it("de-duplicates before paginating so shared series stay in one request", async () => {
    const { retriever, cognite } = makePaginatingRetriever();

    // 150 parameters, but all point at the same series: only one unique request.
    const params = Array.from({ length: 150 }, (_, index) =>
      rawParam({ space: "ts-space", externalId: "7" }, `p${index}`),
    );
    const result = await retriever.retrieveDatapoints(params, START, END);

    expect(cognite.retrieveDatapoints).toHaveBeenCalledTimes(1);
    expect(vi.mocked(cognite.retrieveDatapoints).mock.calls[0]?.[0]?.items).toHaveLength(1);
    // Every parameter resolves to the same de-duplicated series.
    expect(result).toHaveLength(150);
    expect(result.every((series) => series[0]?.value === 7)).toBe(true);
  });

  it("forwards the shared start and end window to every paginated request", async () => {
    const { retriever, cognite } = makePaginatingRetriever();

    const params = Array.from({ length: 150 }, (_, index) =>
      rawParam({ space: "ts-space", externalId: String(index) }, `p${index}`),
    );
    await retriever.retrieveDatapoints(params, START, END);

    for (const call of vi.mocked(cognite.retrieveDatapoints).mock.calls) {
      expect(call[0]?.start).toBe(START);
      expect(call[0]?.end).toBe(END);
    }
  });
});
