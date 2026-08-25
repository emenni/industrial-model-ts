import type { DataPoint, ReducerType, Series } from "./models";

/** Returns a time-ordered series; duplicate timestamps keep the last value. */
function prepare(leaf: Series): Series {
  if (leaf.length < 2) {
    return leaf;
  }

  let sortedOk = true;
  let hasDuplicates = false;
  let previous = (leaf[0] as DataPoint).timestamp.getTime();
  for (let index = 1; index < leaf.length; index += 1) {
    const timestamp = (leaf[index] as DataPoint).timestamp.getTime();
    if (timestamp < previous) {
      sortedOk = false;
      break;
    }
    if (timestamp === previous) {
      hasDuplicates = true;
    }
    previous = timestamp;
  }

  if (sortedOk && !hasDuplicates) {
    return leaf;
  }

  const ordered = sortedOk
    ? leaf
    : [...leaf].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

  const collapsed: Series = [ordered[0] as DataPoint];
  for (let index = 1; index < ordered.length; index += 1) {
    const point = ordered[index] as DataPoint;
    const last = collapsed[collapsed.length - 1] as DataPoint;
    if (last.timestamp.getTime() === point.timestamp.getTime()) {
      collapsed[collapsed.length - 1] = point;
    } else {
      collapsed.push(point);
    }
  }
  return collapsed;
}

type AlignedRow = { timestamp: Date; values: number[] };

/**
 * Walks several prepared series in lockstep, yielding only the timestamps
 * present in every one of them, in ascending order.
 */
function* iterAlignedRows(prepared: Series[]): Generator<AlignedRow> {
  const count = prepared.length;
  const times = prepared.map((series) => series.map((point) => point.timestamp.getTime()));
  const cursors = new Array<number>(count).fill(0);

  while (true) {
    let latest = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < count; index += 1) {
      const time = (times[index] as number[])[cursors[index] as number];
      if (time === undefined) {
        return;
      }
      if (time > latest) {
        latest = time;
      }
    }

    // Advance every series to the latest head timestamp. A series that
    // overshoots it means no row exists there; the next pass then computes a
    // higher `latest`, which is what guarantees forward progress.
    let aligned = true;
    for (let index = 0; index < count; index += 1) {
      const seriesTimes = times[index] as number[];
      let cursor = cursors[index] as number;
      while (cursor < seriesTimes.length && (seriesTimes[cursor] as number) < latest) {
        cursor += 1;
      }
      cursors[index] = cursor;
      if (seriesTimes[cursor] !== latest) {
        aligned = false;
        break;
      }
    }
    if (!aligned) {
      continue;
    }

    const values = new Array<number>(count);
    let timestamp = new Date(latest);
    for (let index = 0; index < count; index += 1) {
      const point = (prepared[index] as Series)[cursors[index] as number] as DataPoint;
      values[index] = point.value;
      if (index === 0) {
        timestamp = point.timestamp;
      }
    }
    yield { timestamp, values };

    for (let index = 0; index < count; index += 1) {
      cursors[index] = (cursors[index] as number) + 1;
    }
  }
}

function reduceValues(values: number[], reducer: ReducerType): number {
  switch (reducer) {
    case "min": {
      let result = values[0] as number;
      for (const value of values) {
        if (value < result) {
          result = value;
        }
      }
      return result;
    }
    case "max": {
      let result = values[0] as number;
      for (const value of values) {
        if (value > result) {
          result = value;
        }
      }
      return result;
    }
    case "sum":
      return sum(values);
    case "average":
      return sum(values) / values.length;
  }
}

function sum(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

/**
 * Combines or aligns multiple time series by intersecting on timestamp.
 *
 * A timestamp survives only when every input series has a value for it.
 * This is stricter than a positional zip: it tolerates series with gaps or
 * misaligned points instead of silently pairing up unrelated values.
 *
 * Every input is normalized first (sorted by timestamp, duplicate timestamps
 * collapsed to their last value), including when a single series is passed, so
 * the output does not depend on how many series the caller happened to supply.
 */
export class SeriesReducer {
  reduce(series: Series[], reducer: ReducerType): Series {
    if (series.length === 0) {
      return [];
    }
    if (series.length === 1) {
      return prepare([...(series[0] as Series)]);
    }
    if (series.some((leaf) => leaf.length === 0)) {
      return [];
    }

    const result: Series = [];
    for (const row of iterAlignedRows(series.map(prepare))) {
      result.push({ timestamp: row.timestamp, value: reduceValues(row.values, reducer) });
    }
    return result;
  }

  /** Filters each series to the timestamps present in every series. */
  align(series: Series[]): Series[] {
    if (series.length === 0) {
      return [];
    }
    if (series.length === 1) {
      return [prepare([...(series[0] as Series)])];
    }
    if (series.some((leaf) => leaf.length === 0)) {
      return series.map(() => []);
    }

    const aligned: Series[] = series.map(() => []);
    for (const row of iterAlignedRows(series.map(prepare))) {
      for (let index = 0; index < row.values.length; index += 1) {
        (aligned[index] as Series).push({
          timestamp: row.timestamp,
          value: row.values[index] as number,
        });
      }
    }
    return aligned;
  }
}
