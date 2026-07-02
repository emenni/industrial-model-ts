import type { CompiledFormula } from "./compiler";
import type { Environment } from "./evaluator";
import { evaluateTree } from "./evaluator";
import { MissingParameterError, ParameterError, ParameterLengthError } from "./exceptions";
import type { EvaluationResult, Parameters } from "./types";

export function evaluateCompiled(
  formula: CompiledFormula,
  parameters: Parameters,
): EvaluationResult {
  const missing = formula.variables.filter((name) => !Object.hasOwn(parameters, name));
  if (missing.length > 0) {
    throw new MissingParameterError(missing);
  }

  const environment: Environment = {};
  const lengthsByName: Record<string, number> = {};
  for (const [originalName, safeName] of formula.nameMap) {
    const series = normalizeParameter(originalName, parameters[originalName]);
    environment[safeName] = series;
    lengthsByName[originalName] = series.length;
  }

  const lengths = Object.values(lengthsByName);
  if (new Set(lengths).size !== 1) {
    throw new ParameterLengthError(lengthsByName);
  }

  const length = lengths[0] as number;
  if (length === 0) {
    // Every referenced parameter resolved to an empty series, so there is
    // nothing to compute over: return an empty result rather than erroring.
    return [];
  }

  return evaluateTree(formula.tree, environment, length, formula.hasConditional);
}

function normalizeParameter(name: string, value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new ParameterError(`parameter '${name}' must be a numeric sequence`);
  }

  const normalized: number[] = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "number") {
      throw new ParameterError(`parameter '${name}' must be a numeric sequence`);
    }
    normalized[index] = item;
  }
  return normalized;
}
