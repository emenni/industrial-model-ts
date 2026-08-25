/**
 * Structural formula problems (bad syntax, unknown identifiers, missing
 * parameters, mismatched lengths or timestamps, non-numeric values) are
 * reported as a subclass of {@link FormulaError}.
 *
 * Value-dependent arithmetic failures (division/modulo by zero, overflowing
 * exponentiation) are intentionally *not* {@link FormulaError}s: they extend
 * {@link ArithmeticError} instead.
 */

import { CalculatorError } from "../exceptions";

/** Base error for every structural formula problem. */
export class FormulaError extends CalculatorError {
  constructor(message: string) {
    super(message);
    this.name = "FormulaError";
  }
}

/** Raised when formula syntax or operations are not supported. */
export class InvalidFormulaError extends FormulaError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFormulaError";
  }
}

/** Raised when a formula references parameters that were not provided. */
export class MissingParameterError extends FormulaError {
  readonly missing: readonly string[];

  constructor(missing: string[]) {
    super(`missing formula parameter(s): ${missing.join(", ")}`);
    this.name = "MissingParameterError";
    this.missing = [...missing];
  }
}

/** Raised when a parameter value is not a valid numeric sequence. */
export class ParameterError extends FormulaError {
  constructor(message: string) {
    super(message);
    this.name = "ParameterError";
  }
}

/** Raised when referenced parameters do not all share the same length. */
export class ParameterLengthError extends ParameterError {
  readonly lengths: Readonly<Record<string, number>>;

  constructor(lengths: Record<string, number>) {
    const detail = Object.entries(lengths)
      .map(([name, length]) => `'${name}' has ${length}`)
      .join(", ");
    super(`parameter length mismatch: ${detail}`);
    this.name = "ParameterLengthError";
    this.lengths = { ...lengths };
  }
}

/** Raised when a query has only constants and so has no time axis. */
export class MissingTimeAxisError extends ParameterError {
  readonly aliases: readonly string[];

  constructor(aliases: string[]) {
    super(
      "query has no time-series parameter to define a time axis; " +
        `only constant parameter(s): ${aliases.join(", ")}`,
    );
    this.name = "MissingTimeAxisError";
    this.aliases = [...aliases];
  }
}

/** Raised when time-series parameters do not share the same timestamps. */
export class ParameterTimestampError extends ParameterError {
  readonly aliases: readonly string[];

  constructor(aliases: string[]) {
    super(`parameter timestamp mismatch: ${aliases.join(", ")} do not share the same timestamps`);
    this.name = "ParameterTimestampError";
    this.aliases = [...aliases];
  }
}

/**
 * Base for value-dependent arithmetic failures. Deliberately separate from
 * {@link FormulaError} because these depend on the data, not the formula.
 */
export class ArithmeticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArithmeticError";
  }
}

/** Raised when a division or modulo has a zero divisor. */
export class ZeroDivisionError extends ArithmeticError {
  constructor(message: string) {
    super(message);
    this.name = "ZeroDivisionError";
  }
}

/** Raised when an exponentiation overflows the floating-point range. */
export class OverflowError extends ArithmeticError {
  constructor(message: string) {
    super(message);
    this.name = "OverflowError";
  }
}
