import type {
  CogniteAggregateDatapoint,
  CogniteDatapointResultItem,
  CogniteDatapointRetrieveItem,
  CogniteDatapointRetrieveOptions,
  CogniteNumericDatapoint,
  CognitePort,
} from "../cognite";
import type { DatapointAggregate } from "../types";
import { chunks } from "../utils/array";
import type { CalculatorParameter, DataPoint } from "./models";

// Cognite's datapoints retrieve endpoint accepts at most 100 items per request.
const MAX_ITEMS_PER_REQUEST = 100;

type BuiltRequests = {
  requests: CogniteDatapointRetrieveItem[];
  /** For each parameter (by index), the index of the request that serves it. */
  indexMapping: number[];
};

/**
 * Retrieves and de-duplicates the datapoints needed by a set of calculator
 * parameters. Parameters that share a time series (and granularity, for
 * aggregates) are folded into a single Cognite request; aggregate requests
 * accumulate every aggregate their parameters ask for.
 */
export class DatapointsRetriever {
  constructor(private readonly cognite: CognitePort) {}

  async retrieveDatapoints(
    parameters: CalculatorParameter[],
    start: Date,
    end: Date,
  ): Promise<DataPoint[][]> {
    const { requests, indexMapping } = this.buildRequests(parameters);

    if (requests.length === 0) {
      return parameters.map(() => []);
    }

    const responses = await Promise.all(
      chunks(requests, MAX_ITEMS_PER_REQUEST).map((items) => {
        const options: CogniteDatapointRetrieveOptions = { items, start, end };
        return this.cognite.retrieveDatapoints(options);
      }),
    );
    const items = responses.flatMap((response) => response.items);

    return parameters.map((parameter, index) => {
      const requestIndex = indexMapping[index] as number;
      const item = items[requestIndex];
      if (item === undefined) {
        throw new Error(`missing datapoints response for parameter '${parameter.alias}'`);
      }
      return parseDatapoints(item, parameter);
    });
  }

  private buildRequests(parameters: CalculatorParameter[]): BuiltRequests {
    const rawRequestIndex = new Map<string, number>();
    const aggregateRequestIndex = new Map<string, number>();
    const requests: CogniteDatapointRetrieveItem[] = [];
    const indexMapping: number[] = new Array(parameters.length);

    parameters.forEach((parameter, index) => {
      const { space, externalId } = parameter.timeSeries;
      const tsKey = `${space}:${externalId}`;

      if (parameter.aggregateType === undefined) {
        let requestIndex = rawRequestIndex.get(tsKey);
        if (requestIndex === undefined) {
          requestIndex = requests.length;
          rawRequestIndex.set(tsKey, requestIndex);
          requests.push({ space, externalId });
        }
        indexMapping[index] = requestIndex;
        return;
      }

      if (parameter.granularity === undefined) {
        throw new Error(
          `Missing granularity for '${parameter.alias}' with aggregate '${parameter.aggregateType}'`,
        );
      }

      const aggregateKey = `${tsKey}|${parameter.granularity}`;
      let requestIndex = aggregateRequestIndex.get(aggregateKey);
      if (requestIndex === undefined) {
        requestIndex = requests.length;
        aggregateRequestIndex.set(aggregateKey, requestIndex);
        requests.push({
          space,
          externalId,
          aggregates: [parameter.aggregateType],
          granularity: parameter.granularity,
        });
      } else {
        const entry = requests[requestIndex] as CogniteDatapointRetrieveItem;
        const aggregates = entry.aggregates as DatapointAggregate[];
        if (!aggregates.includes(parameter.aggregateType)) {
          aggregates.push(parameter.aggregateType);
        }
      }
      indexMapping[index] = requestIndex;
    });

    return { requests, indexMapping };
  }
}

function parseDatapoints(
  item: CogniteDatapointResultItem,
  parameter: CalculatorParameter,
): DataPoint[] {
  if (item.isString) {
    throw new Error("expected numeric datapoints, got string");
  }

  const result: DataPoint[] = [];
  for (const datapoint of item.datapoints) {
    const value = readValue(datapoint, parameter.aggregateType);
    if (value === undefined || value === null) {
      continue;
    }
    result.push({ timestamp: datapoint.timestamp, value });
  }
  return result;
}

function readValue(
  datapoint: CogniteNumericDatapoint,
  aggregateType: DatapointAggregate | undefined,
): number | undefined {
  if (aggregateType === undefined) {
    return (datapoint as { value?: number }).value;
  }
  return (datapoint as CogniteAggregateDatapoint)[aggregateType];
}
