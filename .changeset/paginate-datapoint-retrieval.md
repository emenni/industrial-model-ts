---
"industrial-model": patch
---

Paginate calculator datapoint retrieval in chunks of 100 time series. Cognite's datapoints retrieve endpoint rejects requests with more than 100 items, so calculators referencing over 100 distinct series (or series/granularity combinations) previously failed. Requests are now split into chunks of 100, fetched in parallel, and stitched back together in request order.
