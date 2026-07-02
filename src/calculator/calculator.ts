import type { CogniteClient } from "@cognite/sdk";
import { type CognitePort, createCogniteAdapter } from "../cognite";
import { DatapointsRetriever } from "./datapoints-retrieval";
import { compileFormula, evaluate } from "./formula-expression";
import type { CalculationResult, CalculatorQuery, DataPoint } from "./models";

/**
 * Evaluates formula-based calculations over Cognite time series datapoints.
 *
 * Each {@link CalculatorQuery} pairs a formula with the parameters its
 * placeholders resolve to. The calculator fetches the required datapoints
 * (de-duplicating shared time series), aligns them by position and evaluates
 * the formula element-by-element.
 */
export class Calculator {
  private readonly retriever: DatapointsRetriever;

  constructor(cognite: CogniteClient | CognitePort) {
    const port = isCognitePort(cognite) ? cognite : createCogniteAdapter(cognite);
    this.retriever = new DatapointsRetriever(port);
  }

  /** Evaluate a single query over the given time range. */
  async calculate(query: CalculatorQuery, start: Date, end: Date): Promise<CalculationResult> {
    const [result] = await this.calculateMultiples([query], start, end);
    // calculateMultiples returns one result per query, so this is always set.
    return result as CalculationResult;
  }

  /**
   * Evaluate several queries over the given time range, retrieving every
   * parameter's datapoints in a single de-duplicated round trip.
   */
  async calculateMultiples(
    queries: CalculatorQuery[],
    start: Date,
    end: Date,
  ): Promise<CalculationResult[]> {
    const parameters = queries.flatMap((query) => query.parameters);
    const datapoints = await this.retriever.retrieveDatapoints(parameters, start, end);

    const results: CalculationResult[] = [];
    let offset = 0;
    for (const query of queries) {
      const slice = datapoints.slice(offset, offset + query.parameters.length);
      offset += query.parameters.length;
      results.push(calculate(query, slice));
    }
    return results;
  }
}

function calculate(query: CalculatorQuery, datapoints: DataPoint[][]): CalculationResult {
  const valuesMap: Record<string, number[]> = {};
  const seriesByAlias = new Map<string, DataPoint[]>();
  query.parameters.forEach((parameter, index) => {
    const series = datapoints[index] ?? [];
    valuesMap[parameter.alias] = series.map((point) => point.value);
    seriesByAlias.set(parameter.alias, series);
  });

  const values = evaluate(query.formula, valuesMap);

  // Timestamps must come from a parameter the formula actually references:
  // `evaluate` only guarantees equal lengths across referenced parameters, so
  // an unreferenced parameter's series (e.g. a different granularity or one
  // with data gaps) can have a different length and would misalign results.
  const [firstVariable] = compileFormula(query.formula).variables;
  const timestampSeries = seriesByAlias.get(firstVariable as string) ?? [];

  return {
    query,
    datapoints: timestampSeries.map((point, index) => ({
      timestamp: point.timestamp,
      value: values[index] as number,
    })),
  };
}

function isCognitePort(value: CogniteClient | CognitePort): value is CognitePort {
  return typeof (value as CognitePort).retrieveDatapoints === "function";
}
