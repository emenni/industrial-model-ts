import type { BinaryOp, BoolOpKind, CompareOp, ExprNode, UnaryOp } from "./ast";
import { isConditionalNode } from "./ast";
import { InvalidFormulaError } from "./exceptions";

const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const UNRESOLVED_BRACE_RE = /[{}]/;
const SAFE_NAME_PREFIX = "__formula_expression_param_";
const CACHE_MAX_SIZE = 1024;

/** A parsed, validated formula ready to be evaluated over parameter series. */
export type CompiledFormula = {
  /** The whitespace-normalized formula text. */
  readonly raw: string;
  /** The formula text after placeholders were replaced with safe identifiers. */
  readonly expression: string;
  /** The validated expression tree. */
  readonly tree: ExprNode;
  /** Original parameter names in first-appearance order. */
  readonly variables: readonly string[];
  /** Mapping of original parameter name to its safe identifier. */
  readonly nameMap: ReadonlyMap<string, string>;
  /** Whether the formula needs element-by-element (short-circuiting) evaluation. */
  readonly hasConditional: boolean;
};

const cache = new Map<string, CompiledFormula>();

/**
 * Normalize the formula text, then compile it (memoized by normalized text).
 *
 * The public entry point mirrors the Python ``compile_formula`` helper: it
 * exposes {@link clearCache} so callers can inspect or reset the compilation
 * cache.
 */
export function compileFormula(formula: string): CompiledFormula {
  const normalized = normalizeFormulaText(formula);

  const cached = cache.get(normalized);
  if (cached !== undefined) {
    return cached;
  }

  const compiled = compileNormalized(normalized);

  if (cache.size >= CACHE_MAX_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(normalized, compiled);
  return compiled;
}

/** Clear the memoized formula compilation cache. */
export function clearCache(): void {
  cache.clear();
}

function normalizeFormulaText(formula: string): string {
  if (typeof formula !== "string") {
    throw new TypeError("formula must be a string");
  }
  const trimmed = formula.trim();
  if (trimmed === "") {
    return "";
  }
  return trimmed.split(/\s+/).join(" ");
}

function compileNormalized(raw: string): CompiledFormula {
  if (raw === "") {
    throw new InvalidFormulaError("formula must not be empty");
  }

  const variables: string[] = [];
  const nameMap = new Map<string, string>();
  const expression = replacePlaceholders(raw, variables, nameMap);

  if (variables.length === 0) {
    throw new InvalidFormulaError("formula must reference at least one parameter");
  }

  if (UNRESOLVED_BRACE_RE.test(expression)) {
    throw new InvalidFormulaError("formula contains invalid placeholder syntax");
  }

  const tree = parse(expression);
  validateTree(tree, new Set(nameMap.values()));
  const hasConditional = treeHasConditional(tree);

  return { raw, expression, tree, variables, nameMap, hasConditional };
}

function replacePlaceholders(
  formula: string,
  variables: string[],
  nameMap: Map<string, string>,
): string {
  return formula.replace(PLACEHOLDER_RE, (_match, name: string) => {
    let safe = nameMap.get(name);
    if (safe === undefined) {
      safe = `${SAFE_NAME_PREFIX}${nameMap.size}`;
      nameMap.set(name, safe);
      variables.push(name);
    }
    return safe;
  });
}

function validateTree(tree: ExprNode, allowedNames: ReadonlySet<string>): void {
  walk(tree, (node) => {
    if (node.kind === "name" && !allowedNames.has(node.id)) {
      throw new InvalidFormulaError(`unknown formula identifier: ${node.id}`);
    }
  });
}

function treeHasConditional(tree: ExprNode): boolean {
  let found = false;
  walk(tree, (node) => {
    if (isConditionalNode(node)) {
      found = true;
    }
  });
  return found;
}

function walk(node: ExprNode, visit: (node: ExprNode) => void): void {
  visit(node);
  switch (node.kind) {
    case "binop":
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    case "unaryop":
      walk(node.operand, visit);
      break;
    case "compare":
      walk(node.left, visit);
      for (const comparator of node.comparators) {
        walk(comparator, visit);
      }
      break;
    case "boolop":
      for (const value of node.values) {
        walk(value, visit);
      }
      break;
    case "ifexp":
      walk(node.test, visit);
      walk(node.body, visit);
      walk(node.orelse, visit);
      break;
    default:
      break;
  }
}

// ─── Tokenizer ─────────────────────────────────────────────────────────────

type Token =
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "name"; readonly value: string }
  | { readonly type: "op"; readonly value: string };

const NUMBER_RE = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
const TWO_CHAR_OPS = new Set(["**", "==", "!=", "<=", ">="]);
const ONE_CHAR_OPS = new Set(["+", "-", "*", "/", "%", "(", ")", "<", ">"]);

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];

    if (char === " ") {
      index += 1;
      continue;
    }

    if (isDigit(char) || (char === "." && isDigit(expression[index + 1]))) {
      NUMBER_RE.lastIndex = index;
      const match = NUMBER_RE.exec(expression);
      if (match === null) {
        throw new InvalidFormulaError("invalid formula syntax: malformed number");
      }
      tokens.push({ type: "number", value: Number(match[0]) });
      index = NUMBER_RE.lastIndex;
      continue;
    }

    if (isIdentStart(char)) {
      IDENT_RE.lastIndex = index;
      const match = IDENT_RE.exec(expression);
      // isIdentStart guarantees a match here.
      const value = (match as RegExpExecArray)[0];
      tokens.push({ type: "name", value });
      index = IDENT_RE.lastIndex;
      continue;
    }

    const twoChar = expression.slice(index, index + 2);
    if (TWO_CHAR_OPS.has(twoChar)) {
      tokens.push({ type: "op", value: twoChar });
      index += 2;
      continue;
    }

    if (char !== undefined && ONE_CHAR_OPS.has(char)) {
      tokens.push({ type: "op", value: char });
      index += 1;
      continue;
    }

    throw new InvalidFormulaError(`invalid formula syntax: unexpected character '${char}'`);
  }

  return tokens;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isIdentStart(char: string | undefined): boolean {
  if (char === undefined) {
    return false;
  }
  return char === "_" || (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}

// ─── Parser ────────────────────────────────────────────────────────────────

const KEYWORDS = new Set(["and", "or", "if", "else"]);
const CONSTANT_KEYWORDS = new Set(["True", "False", "None"]);

const COMPARE_OPS: Record<string, CompareOp> = {
  "==": "eq",
  "!=": "ne",
  "<": "lt",
  "<=": "le",
  ">": "gt",
  ">=": "ge",
};

/** Parse a placeholder-substituted expression into a validated tree. */
function parse(expression: string): ExprNode {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  const tree = parser.parseExpression();
  parser.expectEnd();
  return tree;
}

class Parser {
  private position = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parseExpression(): ExprNode {
    return this.parseConditional();
  }

  expectEnd(): void {
    if (this.position < this.tokens.length) {
      throw new InvalidFormulaError("invalid formula syntax: unexpected trailing tokens");
    }
  }

  private parseConditional(): ExprNode {
    const body = this.parseOr();
    if (this.matchKeyword("if")) {
      const test = this.parseOr();
      this.expectKeyword("else");
      const orelse = this.parseConditional();
      return { kind: "ifexp", test, body, orelse };
    }
    return body;
  }

  private parseOr(): ExprNode {
    const values = [this.parseAnd()];
    while (this.matchKeyword("or")) {
      values.push(this.parseAnd());
    }
    return values.length === 1 ? (values[0] as ExprNode) : { kind: "boolop", op: "or", values };
  }

  private parseAnd(): ExprNode {
    const values = [this.parseComparison()];
    while (this.matchKeyword("and")) {
      values.push(this.parseComparison());
    }
    const op: BoolOpKind = "and";
    return values.length === 1 ? (values[0] as ExprNode) : { kind: "boolop", op, values };
  }

  private parseComparison(): ExprNode {
    const left = this.parseAdditive();
    const ops: CompareOp[] = [];
    const comparators: ExprNode[] = [];
    while (true) {
      const op = this.peekCompareOp();
      if (op === undefined) {
        break;
      }
      this.position += 1;
      ops.push(op);
      comparators.push(this.parseAdditive());
    }
    return ops.length === 0 ? left : { kind: "compare", left, ops, comparators };
  }

  private parseAdditive(): ExprNode {
    let node = this.parseMultiplicative();
    while (true) {
      const op = this.peekOp();
      if (op === "+" || op === "-") {
        this.position += 1;
        const right = this.parseMultiplicative();
        node = { kind: "binop", op: op === "+" ? "add" : "sub", left: node, right };
        continue;
      }
      break;
    }
    return node;
  }

  private parseMultiplicative(): ExprNode {
    let node = this.parseUnary();
    while (true) {
      const op = this.peekOp();
      if (op === "*" || op === "/" || op === "%") {
        this.position += 1;
        const right = this.parseUnary();
        const kind: BinaryOp = op === "*" ? "mul" : op === "/" ? "div" : "mod";
        node = { kind: "binop", op: kind, left: node, right };
        continue;
      }
      break;
    }
    return node;
  }

  private parseUnary(): ExprNode {
    const op = this.peekOp();
    if (op === "+" || op === "-") {
      this.position += 1;
      const operand = this.parseUnary();
      const kind: UnaryOp = op === "+" ? "pos" : "neg";
      return { kind: "unaryop", op: kind, operand };
    }
    return this.parsePower();
  }

  private parsePower(): ExprNode {
    const base = this.parseAtom();
    if (this.peekOp() === "**") {
      this.position += 1;
      // Right operand is a unary expression so ``2 ** -1`` is accepted and
      // ``**`` remains right-associative.
      const exponent = this.parseUnary();
      return { kind: "binop", op: "pow", left: base, right: exponent };
    }
    return base;
  }

  private parseAtom(): ExprNode {
    const token = this.tokens[this.position];
    if (token === undefined) {
      throw new InvalidFormulaError("invalid formula syntax: unexpected end of expression");
    }

    if (token.type === "number") {
      this.position += 1;
      return { kind: "constant", value: token.value };
    }

    if (token.type === "name") {
      if (CONSTANT_KEYWORDS.has(token.value)) {
        throw new InvalidFormulaError("only numeric constants are supported");
      }
      if (KEYWORDS.has(token.value)) {
        throw new InvalidFormulaError(
          `invalid formula syntax: unexpected keyword '${token.value}'`,
        );
      }
      this.position += 1;
      return { kind: "name", id: token.value };
    }

    if (token.value === "(") {
      this.position += 1;
      const inner = this.parseExpression();
      this.expectOp(")");
      return inner;
    }

    throw new InvalidFormulaError(`invalid formula syntax: unexpected token '${token.value}'`);
  }

  private peekOp(): string | undefined {
    const token = this.tokens[this.position];
    return token !== undefined && token.type === "op" ? token.value : undefined;
  }

  private peekCompareOp(): CompareOp | undefined {
    const op = this.peekOp();
    return op !== undefined ? COMPARE_OPS[op] : undefined;
  }

  private matchKeyword(keyword: string): boolean {
    const token = this.tokens[this.position];
    if (token !== undefined && token.type === "name" && token.value === keyword) {
      this.position += 1;
      return true;
    }
    return false;
  }

  private expectKeyword(keyword: string): void {
    if (!this.matchKeyword(keyword)) {
      throw new InvalidFormulaError(`invalid formula syntax: expected '${keyword}'`);
    }
  }

  private expectOp(op: string): void {
    if (this.peekOp() !== op) {
      throw new InvalidFormulaError(`invalid formula syntax: expected '${op}'`);
    }
    this.position += 1;
  }
}
