---
"industrial-model": patch
---

Simplify `nullsFirst` in `SortMapper` to depend only on sort direction (`true` for descending, `false` for ascending), removing the special case that flipped it for direct-relation properties. Direct-relation sorts now behave the same as scalar sorts: ascending sorts nulls last, descending sorts nulls first.
