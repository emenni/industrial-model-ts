---
"industrial-model": minor
---

Extend the calculator with constants, multi-series reducers, and timestamp alignment.

**BREAKING:** every `CalculatorParameter` now requires a `type` tag (`"constant"`, `"single_timeseries"`, or `"multi_timeseries"`), matching the Python package's JSON contract. Existing `{ timeSeries, alias }` callers must become `{ type: "single_timeseries", timeSeries, alias }`.

The result's time axis is now the intersection of **all** time-series parameters in the query (or an exact match under `alignment: "strict"`), not the first parameter the formula happens to reference. Constants are broadcast onto that axis and never fetched from Cognite. A `MultiTimeSeriesParameter` combines two or more series with `min`/`max`/`sum`/`average` by intersecting on timestamp.
