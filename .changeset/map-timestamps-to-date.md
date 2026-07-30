---
"industrial-model": minor
---

Map Cognite `timestamp` and `date` view properties to TypeScript `Date` (generator + Cognite Core types), and always coerce those fields to `Date` on query results. Upsert and filters continue to serialize `Date` values to ISO strings for Cognite.
