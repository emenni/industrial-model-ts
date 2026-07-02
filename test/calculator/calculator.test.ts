import { describe, expect, it, vi } from "vitest";
import { Calculator } from "../../src/calculator/calculator";
import type { CalculatorQuery } from "../../src/calculator/models";
import type { CognitePort } from "../../src/cognite";
import { makeCogniteClientMock, makeCogniteMock } from "../fixtures/index.js";

const TS_A = { space: "ts-space", externalId: "temperature" };
const TS_B = { space: "ts-space", externalId: "pressure" };
const START = new Date("2024-01-01T00:00:00.000Z");
const END = new Date("2024-01-02T00:00:00.000Z");
const T0 = new Date("2024-01-01T00:00:00.000Z");
const T1 = new Date("2024-01-01T01:00:00.000Z");

function makeSeries(values: Array<{ timestamp: Date; value: number }>) {
  return { isString: false, datapoints: values };
}

function makeCalculator(resultItems: unknown[]): {
  calculator: Calculator;
  cognite: CognitePort;
} {
  const cognite = makeCogniteMock();
  cognite.retrieveDatapoints = vi.fn().mockResolvedValue({ items: resultItems });
  return { calculator: new Calculator(cognite), cognite };
}

describe("Calculator.calculate", () => {
  it("evaluates a formula over the retrieved datapoints", async () => {
    const { calculator } = makeCalculator([
      makeSeries([
        { timestamp: T0, value: 10 },
        { timestamp: T1, value: 20 },
      ]),
      makeSeries([
        { timestamp: T0, value: 1 },
        { timestamp: T1, value: 2 },
      ]),
    ]);

    const query: CalculatorQuery = {
      formula: "{A} + {B}",
      parameters: [
        { timeSeries: TS_A, alias: "A" },
        { timeSeries: TS_B, alias: "B" },
      ],
    };

    const result = await calculator.calculate(query, START, END);

    expect(result.query).toBe(query);
    expect(result.datapoints).toEqual([
      { timestamp: T0, value: 11 },
      { timestamp: T1, value: 22 },
    ]);
  });

  it("takes timestamps from the first parameter's series", async () => {
    const { calculator } = makeCalculator([
      makeSeries([
        { timestamp: T0, value: 4 },
        { timestamp: T1, value: 8 },
      ]),
      makeSeries([
        { timestamp: T0, value: 2 },
        { timestamp: T1, value: 2 },
      ]),
    ]);

    const query: CalculatorQuery = {
      formula: "{A} / {B}",
      parameters: [
        { timeSeries: TS_A, alias: "A" },
        { timeSeries: TS_B, alias: "B" },
      ],
    };

    const result = await calculator.calculate(query, START, END);

    expect(result.datapoints.map((d) => d.timestamp)).toEqual([T0, T1]);
    expect(result.datapoints.map((d) => d.value)).toEqual([2, 4]);
  });

  it("supports conditional formulas end-to-end", async () => {
    const { calculator } = makeCalculator([
      makeSeries([
        { timestamp: T0, value: 10 },
        { timestamp: T1, value: 5 },
      ]),
      makeSeries([
        { timestamp: T0, value: 2 },
        { timestamp: T1, value: 0 },
      ]),
    ]);

    const query: CalculatorQuery = {
      formula: "{A} / {B} if {B} != 0 else 0",
      parameters: [
        { timeSeries: TS_A, alias: "A" },
        { timeSeries: TS_B, alias: "B" },
      ],
    };

    const result = await calculator.calculate(query, START, END);

    expect(result.datapoints.map((d) => d.value)).toEqual([5, 0]);
  });

  it("returns an empty datapoints list when the series are empty", async () => {
    const { calculator } = makeCalculator([makeSeries([]), makeSeries([])]);

    const query: CalculatorQuery = {
      formula: "{A} + {B}",
      parameters: [
        { timeSeries: TS_A, alias: "A" },
        { timeSeries: TS_B, alias: "B" },
      ],
    };

    const result = await calculator.calculate(query, START, END);

    expect(result.datapoints).toEqual([]);
  });

  it("takes timestamps from a referenced parameter, not an unused longer one", async () => {
    // Regression test: A is not referenced by the formula and has more
    // points than B (e.g. it has data gaps or a different granularity).
    // Timestamps and values must come from B, the only referenced series.
    const { calculator } = makeCalculator([
      makeSeries([
        { timestamp: T0, value: 100 },
        { timestamp: T1, value: 100 },
        { timestamp: new Date("2024-01-01T02:00:00.000Z"), value: 100 },
      ]),
      makeSeries([
        { timestamp: T0, value: 7 },
        { timestamp: T1, value: 7 },
      ]),
    ]);

    const query: CalculatorQuery = {
      formula: "{B} + 1",
      parameters: [
        { timeSeries: TS_A, alias: "A" },
        { timeSeries: TS_B, alias: "B" },
      ],
    };

    const result = await calculator.calculate(query, START, END);

    expect(result.datapoints).toEqual([
      { timestamp: T0, value: 8 },
      { timestamp: T1, value: 8 },
    ]);
  });

  it("takes timestamps from a referenced parameter, not an unused shorter one", async () => {
    const { calculator } = makeCalculator([
      makeSeries([{ timestamp: T0, value: 100 }]),
      makeSeries([
        { timestamp: T0, value: 3 },
        { timestamp: T1, value: 4 },
      ]),
    ]);

    const query: CalculatorQuery = {
      formula: "{B} * 2",
      parameters: [
        { timeSeries: TS_A, alias: "A" },
        { timeSeries: TS_B, alias: "B" },
      ],
    };

    const result = await calculator.calculate(query, START, END);

    expect(result.datapoints).toEqual([
      { timestamp: T0, value: 6 },
      { timestamp: T1, value: 8 },
    ]);
  });

  it("propagates arithmetic errors from the formula", async () => {
    const { calculator } = makeCalculator([
      makeSeries([{ timestamp: T0, value: 10 }]),
      makeSeries([{ timestamp: T0, value: 0 }]),
    ]);

    const query: CalculatorQuery = {
      formula: "{A} / {B}",
      parameters: [
        { timeSeries: TS_A, alias: "A" },
        { timeSeries: TS_B, alias: "B" },
      ],
    };

    await expect(calculator.calculate(query, START, END)).rejects.toThrow(/division by zero/);
  });

  it("accepts a raw CogniteClient and adapts it internally", async () => {
    const client = makeCogniteClientMock({
      datapointsRetrieveResponse: [
        {
          instanceId: { space: TS_A.space, externalId: TS_A.externalId },
          isString: false,
          datapoints: [{ timestamp: T0, value: 5 }],
        },
      ],
    });

    const calculator = new Calculator(client);
    const query: CalculatorQuery = {
      formula: "{A} + 1",
      parameters: [{ timeSeries: TS_A, alias: "A" }],
    };

    const result = await calculator.calculate(query, START, END);

    expect(client.datapoints.retrieve).toHaveBeenCalledOnce();
    expect(result.datapoints).toEqual([{ timestamp: T0, value: 6 }]);
  });
});

describe("Calculator.calculateMultiples", () => {
  it("retrieves all parameters in a single round trip and slices results per query", async () => {
    const { calculator, cognite } = makeCalculator([
      makeSeries([{ timestamp: T0, value: 10 }]),
      makeSeries([{ timestamp: T0, value: 20 }]),
      makeSeries([{ timestamp: T0, value: 3 }]),
    ]);

    const queryOne: CalculatorQuery = {
      formula: "{A} + {B}",
      parameters: [
        { timeSeries: TS_A, alias: "A" },
        { timeSeries: TS_B, alias: "B" },
      ],
    };
    const queryTwo: CalculatorQuery = {
      formula: "{C} * 2",
      parameters: [{ timeSeries: { space: "ts-space", externalId: "flow" }, alias: "C" }],
    };

    const results = await calculator.calculateMultiples([queryOne, queryTwo], START, END);

    expect(cognite.retrieveDatapoints).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results[0]?.datapoints).toEqual([{ timestamp: T0, value: 30 }]);
    expect(results[1]?.datapoints).toEqual([{ timestamp: T0, value: 6 }]);
    expect(results[0]?.query).toBe(queryOne);
    expect(results[1]?.query).toBe(queryTwo);
  });

  it("de-duplicates shared time series across queries", async () => {
    const { calculator, cognite } = makeCalculator([makeSeries([{ timestamp: T0, value: 10 }])]);

    const queryOne: CalculatorQuery = {
      formula: "{A} * 2",
      parameters: [{ timeSeries: TS_A, alias: "A" }],
    };
    const queryTwo: CalculatorQuery = {
      formula: "{A} + 1",
      parameters: [{ timeSeries: TS_A, alias: "A" }],
    };

    const results = await calculator.calculateMultiples([queryOne, queryTwo], START, END);

    const call = vi.mocked(cognite.retrieveDatapoints).mock.calls[0]?.[0];
    expect(call?.items).toHaveLength(1);
    expect(results[0]?.datapoints).toEqual([{ timestamp: T0, value: 20 }]);
    expect(results[1]?.datapoints).toEqual([{ timestamp: T0, value: 11 }]);
  });
});
