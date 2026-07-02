/** Binary arithmetic operators supported by the formula grammar. */
export type BinaryOp = "add" | "sub" | "mul" | "div" | "pow" | "mod";

/** Unary arithmetic operators supported by the formula grammar. */
export type UnaryOp = "pos" | "neg";

/** Comparison operators supported by the formula grammar. */
export type CompareOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

/** Boolean operators supported by the formula grammar. */
export type BoolOpKind = "and" | "or";

export type NameNode = { readonly kind: "name"; readonly id: string };
export type ConstantNode = { readonly kind: "constant"; readonly value: number };
export type BinOpNode = {
  readonly kind: "binop";
  readonly op: BinaryOp;
  readonly left: ExprNode;
  readonly right: ExprNode;
};
export type UnaryOpNode = {
  readonly kind: "unaryop";
  readonly op: UnaryOp;
  readonly operand: ExprNode;
};
export type CompareNode = {
  readonly kind: "compare";
  readonly left: ExprNode;
  readonly ops: readonly CompareOp[];
  readonly comparators: readonly ExprNode[];
};
export type BoolOpNode = {
  readonly kind: "boolop";
  readonly op: BoolOpKind;
  readonly values: readonly ExprNode[];
};
export type IfExpNode = {
  readonly kind: "ifexp";
  readonly test: ExprNode;
  readonly body: ExprNode;
  readonly orelse: ExprNode;
};

/** Any node of a compiled formula expression tree. */
export type ExprNode =
  | NameNode
  | ConstantNode
  | BinOpNode
  | UnaryOpNode
  | CompareNode
  | BoolOpNode
  | IfExpNode;

/** Nodes that make an expression require element-by-element evaluation. */
export type ConditionalNode = CompareNode | BoolOpNode | IfExpNode;

export function isConditionalNode(node: ExprNode): node is ConditionalNode {
  return node.kind === "compare" || node.kind === "boolop" || node.kind === "ifexp";
}
