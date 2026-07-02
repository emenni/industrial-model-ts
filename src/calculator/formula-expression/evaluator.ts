import type { BinaryOp, CompareOp, ExprNode, UnaryOp } from "./ast";
import { OverflowError, ZeroDivisionError } from "./exceptions";

/** Environment mapping safe identifiers to their aligned numeric series. */
export type Environment = Record<string, readonly number[]>;

/**
 * A value is either a scalar (broadcast across the whole series) or an
 * already-materialized per-element sequence. Keeping constants as scalars
 * avoids allocating length-N arrays for them and skips the element-wise zip
 * whenever one side of an operation is constant.
 */
type Value = number | readonly number[];

const UNARY_OPS: Record<UnaryOp, (value: number) => number> = {
  pos: (value) => value,
  neg: (value) => -value,
};

const BINARY_OPS: Record<BinaryOp, (left: number, right: number) => number> = {
  add: (left, right) => left + right,
  sub: (left, right) => left - right,
  mul: (left, right) => left * right,
  div: (left, right) => {
    if (right === 0) {
      throw new ZeroDivisionError("float division by zero");
    }
    return left / right;
  },
  mod: pythonMod,
  pow: safePow,
};

const COMPARE_OPS: Record<CompareOp, (left: number, right: number) => boolean> = {
  eq: (left, right) => left === right,
  ne: (left, right) => left !== right,
  lt: (left, right) => left < right,
  le: (left, right) => left <= right,
  gt: (left, right) => left > right,
  ge: (left, right) => left >= right,
};

/** Python's ``%`` follows the sign of the divisor, unlike JavaScript's ``%``. */
function pythonMod(left: number, right: number): number {
  if (right === 0) {
    throw new ZeroDivisionError("float modulo");
  }
  return left - Math.floor(left / right) * right;
}

/**
 * Exponentiate in float space. Mirrors the Python implementation's error
 * semantics: raising ``0`` to a negative power and overflowing results are
 * surfaced as arithmetic errors rather than silently producing infinities.
 */
function safePow(base: number, exponent: number): number {
  if (base === 0 && exponent < 0) {
    throw new ZeroDivisionError("0.0 cannot be raised to a negative power");
  }
  const result = base ** exponent;
  if (!Number.isFinite(result) && Number.isFinite(base) && Number.isFinite(exponent)) {
    throw new OverflowError("(34, 'Numerical result out of range')");
  }
  return result;
}

/** Python truthiness for floats: only exactly ``0`` is falsy (``NaN`` is truthy). */
function isTruthy(value: number): boolean {
  return value !== 0;
}

export function evaluateTree(
  tree: ExprNode,
  environment: Environment,
  length: number,
  hasConditional: boolean,
): number[] {
  if (hasConditional) {
    // ``if``/``else`` branches (and their guards) must only run for the
    // elements that select them, so evaluate index-by-index.
    const result: number[] = new Array(length);
    for (let index = 0; index < length; index += 1) {
      result[index] = evaluateNodeAt(tree, environment, index);
    }
    return result;
  }

  const value = evaluateNode(tree, environment);
  if (Array.isArray(value)) {
    return value as number[];
  }
  // The compiler guarantees at least one parameter, so a scalar result only
  // happens for degenerate trees; broadcast it to the series length.
  return new Array(length).fill(value as number);
}

function evaluateNode(node: ExprNode, environment: Environment): Value {
  switch (node.kind) {
    case "name": {
      const series = environment[node.id];
      // The runtime guarantees every referenced name is present.
      return series as readonly number[];
    }
    case "constant":
      return node.value;
    case "binop": {
      const left = evaluateNode(node.left, environment);
      const right = evaluateNode(node.right, environment);
      return applyBinary(BINARY_OPS[node.op], left, right);
    }
    case "unaryop": {
      const operand = evaluateNode(node.operand, environment);
      const op = UNARY_OPS[node.op];
      return Array.isArray(operand) ? operand.map(op) : op(operand as number);
    }
    default:
      // Conditional nodes never reach the vectorized path.
      throw new TypeError(`unsupported formula element: ${node.kind}`);
  }
}

function applyBinary(
  op: (left: number, right: number) => number,
  left: Value,
  right: Value,
): Value {
  if (Array.isArray(left)) {
    if (Array.isArray(right)) {
      const result: number[] = new Array(left.length);
      for (let index = 0; index < left.length; index += 1) {
        result[index] = op(left[index] as number, right[index] as number);
      }
      return result;
    }
    const scalar = right as number;
    return left.map((value) => op(value, scalar));
  }
  const scalarLeft = left as number;
  if (Array.isArray(right)) {
    return right.map((value) => op(scalarLeft, value));
  }
  return op(scalarLeft, right as number);
}

function evaluateNodeAt(node: ExprNode, environment: Environment, index: number): number {
  switch (node.kind) {
    case "name": {
      const series = environment[node.id] as readonly number[];
      return series[index] as number;
    }
    case "constant":
      return node.value;
    case "binop": {
      const left = evaluateNodeAt(node.left, environment, index);
      const right = evaluateNodeAt(node.right, environment, index);
      return BINARY_OPS[node.op](left, right);
    }
    case "unaryop":
      return UNARY_OPS[node.op](evaluateNodeAt(node.operand, environment, index));
    case "compare": {
      let left = evaluateNodeAt(node.left, environment, index);
      for (let i = 0; i < node.ops.length; i += 1) {
        const right = evaluateNodeAt(node.comparators[i] as ExprNode, environment, index);
        if (!COMPARE_OPS[node.ops[i] as CompareOp](left, right)) {
          return 0;
        }
        left = right;
      }
      return 1;
    }
    case "boolop": {
      if (node.op === "and") {
        for (const value of node.values) {
          if (!isTruthy(evaluateNodeAt(value, environment, index))) {
            return 0;
          }
        }
        return 1;
      }
      for (const value of node.values) {
        if (isTruthy(evaluateNodeAt(value, environment, index))) {
          return 1;
        }
      }
      return 0;
    }
    case "ifexp": {
      const test = evaluateNodeAt(node.test, environment, index);
      const branch = isTruthy(test) ? node.body : node.orelse;
      return evaluateNodeAt(branch, environment, index);
    }
    default:
      throw new TypeError("unsupported formula element");
  }
}
