export const NESTED_SEP = "|" as const;
export const EDGE_MARKER = "<EdgeMarker>" as const;
export const MAX_LIMIT = 10_000;
export const DEFAULT_LIMIT = 1_000;
export const MAX_DEPENDENCY_DEPTH = 3;
export const AGGREGATE_LIMIT = 1_000;
export const MAX_GROUP_BY = 5;
/** Max independent roots in one `queryMany` call (matches common consumer chunk size). */
export const MAX_QUERY_ROOTS = 50;
