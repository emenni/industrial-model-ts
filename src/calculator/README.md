# Calculator

The `industrial-model/calculator` subpath computes derived time series from formulas that combine one or more source time series in Cognite Data Fusion. Each query pairs a `formula` with the `parameters` its `{alias}` placeholders resolve to. The calculator fetches every parameter's datapoints in a single de-duplicated round trip, aligns them by position, and evaluates the formula element-by-element.

The formula engine that powers it (`evaluate`) is also exported on its own, so you can evaluate formulas over in-memory numeric series without touching Cognite at all.

## Table of contents

- [Quick start](#quick-start)
- [Aggregated parameters](#aggregated-parameters)
- [Evaluating several queries at once](#evaluating-several-queries-at-once)
- [Real-world example: OEE](#real-world-example-oee)
- [The standalone formula engine](#the-standalone-formula-engine)
- [Supported operators](#supported-operators)
- [Error handling](#error-handling)
- [API reference](#api-reference)

## Quick start

```ts
import { CogniteClient } from "@cognite/sdk";
import { Calculator } from "industrial-model/calculator";

const cognite = new CogniteClient({ appId: "my-app", project: "my-project", /* ... */ });
const calculator = new Calculator(cognite);

const result = await calculator.calculate(
  {
    formula: "{power} / {flow} if {flow} != 0 else 0",
    parameters: [
      { timeSeries: { space: "ts-space", externalId: "power" }, alias: "power" },
      { timeSeries: { space: "ts-space", externalId: "flow" }, alias: "flow" },
    ],
  },
  new Date("2024-01-01T00:00:00.000Z"),
  new Date("2024-01-02T00:00:00.000Z"),
);

result.datapoints;
// [{ timestamp: Date, value: number }, …]
```

Timestamps in the result come from the **first parameter the formula actually references** — here, `power`. Parameters that share a time series (and granularity, for aggregates) are folded into a single request, so adding more parameters never triggers a duplicate fetch of the same series.

## Aggregated parameters

Set `aggregateType` and `granularity` on a parameter to fetch aggregates instead of raw datapoints:

```ts
const result = await calculator.calculate(
  {
    formula: "{maxTemp} - {avgTemp}",
    parameters: [
      { timeSeries: tempTs, aggregateType: "max", granularity: "1h", alias: "maxTemp" },
      { timeSeries: tempTs, aggregateType: "average", granularity: "1h", alias: "avgTemp" },
    ],
  },
  start,
  end,
);
```

Both parameters read the same time series at the same granularity, so the calculator issues one aggregate request that accumulates every aggregate its parameters ask for (`max` and `average`), rather than two separate requests.

Supported `aggregateType` values: `"average"`, `"max"`, `"min"`, `"count"`, `"sum"`, `"interpolation"`, `"stepInterpolation"`, `"totalVariation"`, `"continuousVariance"`, `"discreteVariance"`.

## Evaluating several queries at once

`calculateMultiples` batches the datapoint retrieval for several queries into one de-duplicated round trip, returning one `CalculationResult` per query, in order:

```ts
const [efficiency, downtime] = await calculator.calculateMultiples(
  [
    {
      formula: "{good} / {total} * 100",
      parameters: [
        { timeSeries: goodUnitsTs, alias: "good" },
        { timeSeries: totalUnitsTs, alias: "total" },
      ],
    },
    {
      formula: "{plannedMinutes} - {runMinutes}",
      parameters: [
        { timeSeries: plannedMinutesTs, alias: "plannedMinutes" },
        { timeSeries: runMinutesTs, alias: "runMinutes" },
      ],
    },
  ],
  start,
  end,
);
```

If both queries happen to reference the same time series, it is still only fetched once — batching several KPI formulas for a shift report is a single network round trip regardless of how much overlap they have.

## Real-world example: OEE

Overall Equipment Effectiveness (`Availability × Performance × Quality`) is a good illustration of composing several formulas from a small set of shared inputs:

```ts
const line = { space: "ts-space", externalId: "line-42" };

const [availability, performance, quality, oee] = await calculator.calculateMultiples(
  [
    {
      // Availability = run time / planned production time
      formula: "{runTime} / {plannedTime}",
      parameters: [
        { timeSeries: { ...line, externalId: `${line.externalId}-run-time` }, alias: "runTime" },
        { timeSeries: { ...line, externalId: `${line.externalId}-planned-time` }, alias: "plannedTime" },
      ],
    },
    {
      // Performance = (total count * ideal cycle time) / run time
      formula: "({count} * {idealCycleTime}) / {runTime} if {runTime} != 0 else 0",
      parameters: [
        { timeSeries: { ...line, externalId: `${line.externalId}-count` }, alias: "count" },
        { timeSeries: { ...line, externalId: `${line.externalId}-ideal-cycle-time` }, alias: "idealCycleTime" },
        { timeSeries: { ...line, externalId: `${line.externalId}-run-time` }, alias: "runTime" },
      ],
    },
    {
      // Quality = good count / total count
      formula: "{good} / {count} if {count} != 0 else 0",
      parameters: [
        { timeSeries: { ...line, externalId: `${line.externalId}-good-count` }, alias: "good" },
        { timeSeries: { ...line, externalId: `${line.externalId}-count` }, alias: "count" },
      ],
    },
    {
      // OEE combines the three factors directly from their source series
      formula:
        "(({runTime} / {plannedTime}) * (({count} * {idealCycleTime}) / {runTime}) * ({good} / {count})) if ({runTime} != 0 and {count} != 0) else 0",
      parameters: [
        { timeSeries: { ...line, externalId: `${line.externalId}-run-time` }, alias: "runTime" },
        { timeSeries: { ...line, externalId: `${line.externalId}-planned-time` }, alias: "plannedTime" },
        { timeSeries: { ...line, externalId: `${line.externalId}-count` }, alias: "count" },
        { timeSeries: { ...line, externalId: `${line.externalId}-ideal-cycle-time` }, alias: "idealCycleTime" },
        { timeSeries: { ...line, externalId: `${line.externalId}-good-count` }, alias: "good" },
      ],
    },
  ],
  shiftStart,
  shiftEnd,
);
```

The four queries share `runTime`, `count`, `plannedTime`, `idealCycleTime`, and `good` across formulas, so `calculateMultiples` still fetches each underlying time series exactly once for the whole batch.

## The standalone formula engine

`evaluate` runs the same formula engine over plain in-memory arrays, with no Cognite dependency:

```ts
import { evaluate } from "industrial-model/calculator";

evaluate("{A} + {B} * 2", { A: [1, 2, 3], B: [10, 20, 30] });
// [21, 42, 63]
```

This is useful for unit-testing a formula in isolation, or for evaluating a formula over data that didn't come from Cognite at all (e.g. values computed elsewhere in your pipeline):

```ts
const shiftGoodUnits = [980, 1010, 940];
const shiftTotalUnits = [1000, 1000, 1000];

const yieldPct = evaluate("{good} / {total} * 100", {
  good: shiftGoodUnits,
  total: shiftTotalUnits,
});
// [98, 101, 94]
```

`evaluate` compiles the formula text into an expression tree and caches it (up to 1024 entries) by its normalized text, so calling `evaluate` repeatedly with the same formula string — e.g. once per row or per incoming batch — does not re-parse it. Use `compileFormula` directly when you need the parsed formula's metadata, such as the list of parameters it references, without evaluating it yet:

```ts
import { compileFormula, clearCache } from "industrial-model/calculator";

const compiled = compileFormula("{setpoint} - {reading}");
compiled.variables; // ["setpoint", "reading"]

// Reset the compilation cache, e.g. between test cases
clearCache();
```

## Supported operators

- **Arithmetic:** `+` `-` `*` `/` `**` `%` (binary) and `+` `-` (unary)
- **Comparisons:** `==` `!=` `<` `<=` `>` `>=` (chained comparisons are supported, e.g. `0 <= {x} < 100`)
- **Boolean:** `and` `or`
- **Conditional:** `{A} / {B} if {B} != 0 else 0`

Comparisons, boolean operators, and conditionals are evaluated element-by-element, and only the selected branch runs for a given element — so a value-dependent failure (like division by zero) in an unselected branch never throws:

```ts
evaluate("{A} / {B} if {B} != 0 else -1", { A: [10, 20], B: [2, 0] });
// [5, -1]  — the {A} / {B} branch never runs for the second element
```

Modulo follows Python semantics: the result takes the sign of the divisor.

```ts
evaluate("{A} % {B}", { A: [-7], B: [3] }); // [2], not [-1]
```

## Error handling

Structural problems throw a subclass of `FormulaError`:

| Error | Raised when |
|---|---|
| `InvalidFormulaError` | The formula has invalid syntax or uses an unsupported operation |
| `MissingParameterError` | The formula references a `{alias}` that wasn't provided in `parameters` |
| `ParameterError` | A parameter value is not a valid numeric sequence |
| `ParameterLengthError` | Referenced parameters don't all share the same length |

Value-dependent arithmetic failures throw a subclass of `ArithmeticError` instead, deliberately kept separate from `FormulaError` because they depend on the data, not the formula:

| Error | Raised when |
|---|---|
| `ZeroDivisionError` | Division or modulo by zero |
| `OverflowError` | Exponentiation overflows the floating-point range |

```ts
import { evaluate, MissingParameterError, ZeroDivisionError } from "industrial-model/calculator";

try {
  evaluate("{A} / {B}", { A: [1, 2, 3], B: [1, 0, 3] });
} catch (error) {
  if (error instanceof ZeroDivisionError) {
    // handle the zero division — note {A} / {B} has no `if` guard here,
    // so the zero at index 1 is not skipped
  }
}

try {
  evaluate("{A} + {C}", { A: [1, 2], B: [3, 4] });
} catch (error) {
  if (error instanceof MissingParameterError) {
    error.missing; // ["C"]
  }
}
```

When every referenced parameter is an empty series, the result is an empty array; a mix of empty and non-empty parameters is a length mismatch (`ParameterLengthError`).

## API reference

### `Calculator`

| Member | Description |
|---|---|
| `new Calculator(cognite: CogniteClient)` | Create a calculator backed by a Cognite client |
| `calculate(query, start, end): Promise<CalculationResult>` | Evaluate a single query over a time range |
| `calculateMultiples(queries, start, end): Promise<CalculationResult[]>` | Evaluate several queries in one de-duplicated round trip |

### Types

| Type | Description |
|---|---|
| `CalculatorQuery` | `{ formula: string; parameters: CalculatorParameter[] }` |
| `CalculatorParameter` | `{ timeSeries: NodeId; alias: string; aggregateType?: DatapointAggregate; granularity?: string }` |
| `CalculationResult` | `{ query: CalculatorQuery; datapoints: DataPoint[] }` |
| `DataPoint` | `{ timestamp: Date; value: number }` |

### Formula engine

| Export | Description |
|---|---|
| `evaluate(formula, parameters): number[]` | Compile and evaluate a formula in one call |
| `compileFormula(formula): CompiledFormula` | Compile once, evaluate many times; exposes `.variables` and `.evaluate(parameters)` |
| `clearCache()` | Clear the internal compiled-formula cache |
