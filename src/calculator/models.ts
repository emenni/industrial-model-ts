import type { DatapointAggregate, NodeId } from "../types";

/** A single computed datapoint of a calculation result. */
export type DataPoint = {
  timestamp: Date;
  value: number;
};

/**
 * A time series input to a calculation.
 *
 * When `aggregateType` is set the datapoints are fetched as aggregates and a
 * `granularity` is required; otherwise raw datapoints are used.
 */
export type CalculatorParameter = {
  /** The time series instance to read datapoints from. */
  timeSeries: NodeId;
  /** Optional aggregate to apply; requires `granularity` when set. */
  aggregateType?: DatapointAggregate;
  /** Aggregate granularity (e.g. `"1h"`); required when `aggregateType` is set. */
  granularity?: string;
  /** The placeholder name used to reference this parameter in the formula. */
  alias: string;
};

/** A formula plus the parameters its placeholders resolve to. */
export type CalculatorQuery = {
  /** Formula referencing parameters by ``{alias}`` (see `evaluate`). */
  formula: string;
  parameters: CalculatorParameter[];
};

/** The datapoints produced by evaluating a `CalculatorQuery`. */
export type CalculationResult = {
  query: CalculatorQuery;
  datapoints: DataPoint[];
};
