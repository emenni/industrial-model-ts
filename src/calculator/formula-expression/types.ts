/** A single formula parameter: an aligned sequence of numeric values. */
export type ParameterValue = readonly number[];

/** The result of evaluating a formula: one value per aligned series element. */
export type EvaluationResult = number[];

/** Mapping of parameter name to its numeric series. */
export type Parameters = Record<string, ParameterValue>;
