import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/calculator/formula-expression";

// Production-style formulas that exercise nested parentheses, mixed scales,
// and unit conversions.
const REPRESENTATIVE_FORMULAS = [
  "(({APD} + {AED}) / {AVD}) - (({FPD} + {FED}) / {FVD})",
  "{APV}/{HEADCOUNT}",
  "({VMCM} - {FDCM} - {OFCM} - {PPCM} - {ECCM}) / {SVCM}",
  "\t{APV} - {FPV}",
  "{APC} + {AEC} - {FPC} - {FEC}",
  "{VMCM} - {FDCM} - {OFCM} - {PPCM} - {ECCM}",
  "{PRD}",
  "{FLD}",
  "({FGBSGRM}/1000000)+({FGBSKGM}/1000)",
  "({RMBSGRM}/1000000)+({RMBSKGM}/1000)",
  "{RMYVALUE} / {RMYCOUNT}",
  "({GBSGRM}/1000000)+({GBSKGM}/1000)",
  "({CBSGRM}/1000000)+({CBSKGM}/1000)",
  "{COPQ}",
  "{MAF}",
  "{QN1PE}",
  "{QN1P1} + {QN1P3}",
  "{A1KG}+({A1LBS}*453592)",
  "100 * ({AEKG}+{A0KG}+(({AELBS}+{A0LBS})*0.453592))" +
    " / ({AEKG}+{A0KG}+{A1KG}+{R1KG}+{R2KG}+{R3KG}" +
    "+(({AELBS}+{A0LBS}+{A1LBS}+{R1LBS}+{R2LBS}+{R3LBS})*0.453592))",
  "{R1KG}+{R2KG}+{R3KG}+(({R1LBS}+{R2LBS}+{R3LBS})*0.453592)",
  "{PCST1} + {PCST2}",
  "(200000 * ({CPPST1} + {CPPST2}+{EPPST1} + {EPPST2})) / {TWH}",
  "{PPST1} + {PPST2}",
  "{ENVT1} + {ENVT2}",
  "{FIRT1} + {FIRT2}",
  "{HP}",
  "{PPST3}",
  "{NM}",
  "(200000 * ({CPPST1} + {CPPST2})) / {CWH}",
  "(200000 * ({EPPST1} + {EPPST2})) / {EWH}",
  "{APV}",
  "{AVLLINE} / {MSDP}",
  "{QATLINE} / {MSDP}",
  "{PFMLINE} / {MSDP}",
  "{OEELINE} / {MSDP}",
  "(24*3600) - {LLOEE} - {ALOEE} - {PLOEE} - {QLOEE}",
  "{TEEPLINE} / {MSDP}",
  "(24*3600) - {LLOEE}",
  "(24*3600) - {LLOEE} - {ALOEE}",
  "(24*3600) - {LLOEE} - {ALOEE} - {PLOEE}",
  "{FPV}",
  "{FPC} + {FEC}",
  "{APC} + {AEC}",
  "{FG}",
  "100*({SCP})/({FG}+{IP}+{SCP})",
  "{SCP}",
  "{IP}",
  "{BGEN}",
  "{LSHR}",
  "{PPN}",
  "{PNY}",
  "{TDAI}",
];

// Formulas that additionally exercise `**` and `%`.
const COMPLEX_FORMULAS = [
  "(({APD} + {AED}) / {AVD}) - (({FPD} + {FED}) / {FVD})",
  "100*({SCP})/({FG}+{IP}+{SCP})",
  "({VMCM} - {FDCM} - {OFCM} - {PPCM} - {ECCM}) / {SVCM}",
  "(24*3600) - {LLOEE} - {ALOEE} - {PLOEE} - {QLOEE}",
  "((({A} + {B}) * ({C} - {D})) / (({E} + 1) * ({F} + 1))) ** 2 + {G} % {H}",
];

const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function parameterNames(formula: string): string[] {
  const names = new Set<string>();
  for (const match of formula.matchAll(PLACEHOLDER_RE)) {
    names.add(match[1] as string);
  }
  return [...names];
}

/**
 * Independent oracle: evaluate the formula element-wise using the JavaScript
 * engine directly. This is a deliberately separate implementation from the
 * library's AST-walking interpreter, so a match between the two is strong
 * evidence of correctness. All test datasets use strictly positive values, so
 * JavaScript's `%` and `**` agree with the interpreter's remainder and power.
 */
function referenceEvaluate(formula: string, parameters: Record<string, number[]>): number[] {
  const names = parameterNames(formula);
  const expression = formula.replace(PLACEHOLDER_RE, (_match, name: string) => {
    return `p[${JSON.stringify(name)}][i]`;
  });
  const compiled = new Function("p", "i", `return (${expression});`) as (
    p: Record<string, number[]>,
    i: number,
  ) => number;

  const length = (parameters[names[0] as string] as number[]).length;
  const result: number[] = new Array(length);
  for (let i = 0; i < length; i += 1) {
    result[i] = compiled(parameters, i);
  }
  return result;
}

/** Deterministic seeded PRNG (mulberry32) for reproducible datasets. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDataset(
  names: string[],
  length: number,
  seed: number,
  low = 1,
  high = 1000,
): Record<string, number[]> {
  const rng = makeRng(seed);
  const dataset: Record<string, number[]> = {};
  for (const name of [...names].sort()) {
    dataset[name] = Array.from({ length }, () => low + rng() * (high - low));
  }
  return dataset;
}

function expectClose(actual: number[], expected: number[], tolerance = 1e-9): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    const a = actual[i] as number;
    const e = expected[i] as number;
    const scale = Math.max(1, Math.abs(a), Math.abs(e));
    expect(Math.abs(a - e)).toBeLessThanOrEqual(tolerance * scale);
  }
}

describe("representative formulas", () => {
  it("contains only unique formulas", () => {
    expect(REPRESENTATIVE_FORMULAS.length).toBe(new Set(REPRESENTATIVE_FORMULAS).size);
  });

  it.each(REPRESENTATIVE_FORMULAS)("evaluates without error: %s", (formula) => {
    const parameters: Record<string, number[]> = {};
    for (const name of parameterNames(formula)) {
      parameters[name] = [10, 20];
    }
    const result = evaluate(formula, parameters);
    expect(result).toHaveLength(2);
  });

  it.each(REPRESENTATIVE_FORMULAS)("matches the reference oracle: %s", (formula) => {
    const parameters = randomDataset(parameterNames(formula), 2000, 29);
    expectClose(evaluate(formula, parameters), referenceEvaluate(formula, parameters));
  });

  it.each([
    ["{APV}/{HEADCOUNT}", [1, 1]],
    ["{APC} + {AEC} - {FPC} - {FEC}", [0, 0]],
    ["{PCST1} + {PCST2}", [20, 40]],
    ["{AVLLINE} / {MSDP}", [1, 1]],
    ["(24*3600) - {LLOEE}", [86390, 86380]],
  ] as Array<[string, number[]]>)("produces expected values for %s", (formula, expected) => {
    const parameters: Record<string, number[]> = {};
    for (const name of parameterNames(formula)) {
      parameters[name] = [10, 20];
    }
    expectClose(evaluate(formula, parameters), expected);
  });
});

describe("complex formulas (with ** and %)", () => {
  it.each(COMPLEX_FORMULAS)("matches the reference oracle on a large dataset: %s", (formula) => {
    const parameters = randomDataset(parameterNames(formula), 10_000, 17);
    const result = evaluate(formula, parameters);
    expect(result).toHaveLength(10_000);
    expectClose(result, referenceEvaluate(formula, parameters));
  });
});

describe("algebraic properties on large datasets", () => {
  it("addition is commutative", () => {
    const parameters = randomDataset(["A", "B"], 5000, 31);
    expectClose(evaluate("{A} + {B}", parameters), evaluate("{B} + {A}", parameters), 1e-12);
  });

  it("multiplication distributes over addition", () => {
    const parameters = randomDataset(["A", "B", "C"], 5000, 37);
    expectClose(
      evaluate("{A} * ({B} + {C})", parameters),
      evaluate("{A} * {B} + {A} * {C}", parameters),
    );
  });

  it("additive and multiplicative identities hold", () => {
    const parameters = randomDataset(["A"], 5000, 41);
    expectClose(evaluate("{A} + 0", parameters), parameters.A as number[], 1e-12);
    expectClose(evaluate("{A} * 1", parameters), parameters.A as number[], 1e-12);
  });

  it("self subtraction is zero and self division is one", () => {
    const parameters = randomDataset(["A"], 5000, 47);
    expect(evaluate("{A} - {A}", parameters).every((value) => value === 0)).toBe(true);
    expectClose(evaluate("{A} / {A}", parameters), new Array(5000).fill(1), 1e-12);
  });

  it("is deterministic across runs", () => {
    const parameters = randomDataset(["A", "B"], 3000, 7);
    expect(evaluate("({A} * 2 + {B}) / 3", parameters)).toEqual(
      evaluate("({A} * 2 + {B}) / 3", parameters),
    );
  });
});
